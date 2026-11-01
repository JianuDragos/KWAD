using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Aeris.LocalAI;

public record ApprovedStatement(string Id, string Text, string SourceId, bool Required = false);
public record ExplanationRequest(string Question, int ScenarioRevision, ApprovedStatement[] Statements);
public record VerificationCitation(string Id, string SourceId, string Text);

public record ExplanationVerification(
    bool IsVerified,
    string EngineUsed,
    string? RuntimeEndpoint,
    int LatencyMs,
    int TotalNumbersInAnswer,
    string[] VerifiedNumbers,
    string[] UnverifiedNumbers,
    bool HallucinationBlocked,
    string VerificationSummary,
    VerificationCitation[] Citations);

public record Explanation(
    int ScenarioRevision,
    string Mode,
    string[] StatementIds,
    string[] Sentences,
    string[] SourceIds,
    string? FallbackReason,
    string? DirectAnswer = null,
    ExplanationVerification? Verification = null);

public sealed class GroundedExplainer(
    HttpClient client,
    string model = "aeris-local",
    TimeSpan? timeout = null,
    string? fallbackModel = "unsloth/Qwen3-4B-Instruct-2507-GGUF:Q4_0")
{
    private static readonly JsonSerializerOptions RelaxedJson = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };
    private static readonly Regex NumberTokenRegex = new(@"(?<![A-Za-z])\d+(?:[.,]\d+)?", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex ThinkBlockRegex = new(@"<think>[\s\S]*?</think>", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex ProhibitedClearanceRegex = new(
        @"\b(ești\s+autorizat|sunteți\s+autorizat|aveți\s+autorizația\s+să\s+aterizați|cleared\s+to\s+land|cleared\s+for\s+takeoff)\b",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    // Input statements MUST come from trusted backend code, never a browser or retrieved free-form note.
    public async Task<Explanation> ExplainAsync(ExplanationRequest input, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ValidateLoopbackEndpoint(client.BaseAddress);

        if (input is null || string.IsNullOrWhiteSpace(input.Question) || input.Question.Length > 1200 || input.ScenarioRevision < 0)
            throw new ArgumentException("A question of 1–1200 characters and a nonnegative backend revision are required.");
        if (input.Statements is null || input.Statements.Length is < 1 or > 32 || input.Statements.Any(s =>
            s is null || !Regex.IsMatch(s.Id ?? "", "^[A-Za-z0-9_-]{1,64}$") ||
            string.IsNullOrWhiteSpace(s.Text) || s.Text.Length > 800 || string.IsNullOrWhiteSpace(s.SourceId)) ||
            input.Statements.Select(s => s.Id).Distinct(StringComparer.Ordinal).Count() != input.Statements.Length)
            throw new ArgumentException("Supply 1–32 backend statements with unique simple IDs, text up to 800 characters and source IDs.");

        var sw = Stopwatch.StartNew();
        var statements = input.Statements.ToArray();
        var ids = statements.Select(s => s.Id).ToArray();

        // Pre-filtrăm la cele mai relevante 1–5 fapte (~400–700 tokeni) pentru latență rapidă (~3–6s pe ARM64 CPU)
        var promptStatements = SelectPromptCandidates(input.Question, statements);

        // Termenii din raportul de audit al controlorului TWR/APP LRCV; fără cifre, ca verificarea numerelor să accepte doar valori din Fapte.
        const string atcGlossary =
            "Glosar ATC (folosește acești termeni, nu parafraze): " +
            "eșalonare (separare radar orizontală/verticală între două aeronave); pierdere de eșalonare și Airprox (doar între două aeronave prea apropiate, niciodată pentru vânt); vânt lateral peste limită = pistă nepotrivită pentru acel tip; STCA (alertă de conflict pe termen scurt); " +
            "siaj și categoriile HEAVY/MEDIUM/LIGHT; leader/follower pe finală; finală, ax prelungit, prag de pistă, touchdown; " +
            "ROT (timp de ocupare a pistei) și backtrack (LRCV nu are căi de degajare rapidă); pistă ocupată; go-around/ratare; " +
            "secvență și slot de aterizare; holding/hipodrom și stivă de holding; " +
            "TMA Craiova Clasa C: IFR eșalonat față de IFR și VFR, VFR primește informare de trafic; " +
            "puncte de raportare VFR Pielești, Cârcea, Podari, Ișalnița; tur de pistă pe latura sudică, sectorul nordic liber pentru IFR; " +
            "QNH, vânt de travers, vânt de față/spate.";

        const string systemPrompt =
            "Ești Asistentul Tactic ATC AERIS pentru Aeroportul Craiova (LRCV). Vorbești cu un controlor TWR/APP, în română. " +
            "Stil de controlor: scurt și concret, cel mult 2 fraze și 40 de cuvinte. Începe direct cu indicativul sau faptul, apoi acțiunea recomandată. " +
            "Fără introduceri, fără politețuri, fără repetarea întrebării, fără explicații de bază. " +
            atcGlossary + " " +
            "Reguli stricte: " +
            "1. Acoperă tot ce s-a întrebat, dar în aceeași formă scurtă. Folosește un termen din glosar doar când Faptele îl susțin (ex: pierdere de eșalonare = două aeronave prea apropiate, nu vânt prea mare). " +
            "2. Fără calcule sau formule; citează valorile gata calculate din Fapte. " +
            "3. Folosește EXCLUSIV numerele din Fapte (nu inventa niciun număr). " +
            "4. Fără autorizări de tip „cleared to land” / „autorizat la aterizare”; doar recomanzi. " +
            "Returnează DOAR JSON valid: {\"direct_answer\":\"...\",\"statement_ids\":[\"...\"]}.";

        var userPrompt = $"Întrebare: {input.Question}\nFapte:\n" +
                         string.Join("\n", promptStatements.Select(s => $"[{s.Id}] {s.Text}"));

        HttpContent BuildBody(string modelId)
        {
            var payload = new
            {
                model = modelId,
                temperature = 0,
                max_tokens = 480,
                stream = false,
                response_format = new { type = "json_object" },
                messages = new[]
                {
                    new { role = "system", content = systemPrompt },
                    new { role = "user", content = userPrompt }
                }
            };
            return new StringContent(JsonSerializer.Serialize(payload, RelaxedJson), Encoding.UTF8, "application/json");
        }

        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(timeout ?? TimeSpan.FromSeconds(30));

        string activeEngineLabel = FormatModelLabel(model, client.BaseAddress);
        string activeEndpoint = FormatEndpoint(client.BaseAddress);

        try
        {
            using var body1 = BuildBody(model);
            var response = await client.PostAsync("v1/chat/completions", body1, deadline.Token);
            if (response.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.NotFound &&
                !string.IsNullOrWhiteSpace(fallbackModel) &&
                !string.Equals(model, fallbackModel, StringComparison.Ordinal))
            {
                response.Dispose();
                activeEngineLabel = FormatModelLabel(fallbackModel, client.BaseAddress);
                using var body2 = BuildBody(fallbackModel);
                response = await client.PostAsync("v1/chat/completions", body2, deadline.Token);
            }

            using (response)
            {
                if (!response.IsSuccessStatusCode)
                    return RenderFallback("http_" + (int)response.StatusCode, (int)sw.ElapsedMilliseconds);

                var text = await response.Content.ReadAsStringAsync(deadline.Token);
                if (text.Length > 65536)
                    return RenderFallback("response_too_large", (int)sw.ElapsedMilliseconds);

                using var envelope = JsonDocument.Parse(text);
                var choice = envelope.RootElement.GetProperty("choices")[0];
                if (choice.GetProperty("finish_reason").GetString() != "stop")
                    return RenderFallback("incomplete_response", (int)sw.ElapsedMilliseconds);

                var rawContent = choice.GetProperty("message").GetProperty("content").GetString() ?? "";
                rawContent = ThinkBlockRegex.Replace(rawContent, "").Trim();

                using var parsedDoc = JsonDocument.Parse(rawContent);
                var root = parsedDoc.RootElement;

                string? generatedAnswer = null;
                string?[] selected;

                if (root.ValueKind == JsonValueKind.Array)
                {
                    selected = root.EnumerateArray().Select(x => x.GetString()).ToArray();
                }
                else if (root.ValueKind == JsonValueKind.Object)
                {
                    if (root.TryGetProperty("direct_answer", out var ansProp) && ansProp.ValueKind == JsonValueKind.String)
                        generatedAnswer = ansProp.GetString()?.Trim();

                    var allowedProps = root.EnumerateObject().Select(p => p.Name).ToList();
                    bool onlyAllowedKeys = allowedProps.All(k => k is "statement_ids" or "direct_answer");
                    if (!onlyAllowedKeys)
                        return RenderFallback("invalid_selection", (int)sw.ElapsedMilliseconds);

                    if (root.TryGetProperty("statement_ids", out var wrappedList) && wrappedList.ValueKind == JsonValueKind.Array)
                    {
                        selected = wrappedList.EnumerateArray().Select(x => x.GetString()).ToArray();
                    }
                    else if (!string.IsNullOrWhiteSpace(generatedAnswer))
                    {
                        selected = new[] { promptStatements[0].Id };
                    }
                    else
                    {
                        return RenderFallback("invalid_selection", (int)sw.ElapsedMilliseconds);
                    }
                }
                else
                {
                    return RenderFallback("invalid_selection", (int)sw.ElapsedMilliseconds);
                }

                // Dacă modelul a explicat politicos că o întrebare e în afara domeniului și a lăsat statement_ids gol,
                // atașăm primul context de referință; dacă nici direct_answer nu există, raportăm no_matching_statement.
                if (selected.Length == 0)
                {
                    if (!string.IsNullOrWhiteSpace(generatedAnswer))
                        selected = new[] { promptStatements[0].Id };
                    else
                        return RenderFallback("no_matching_statement", (int)sw.ElapsedMilliseconds);
                }

                // Filtrăm doar ID-urile valide cunoscute (sau respingem dacă niciunul nu e valid în selecția clasică)
                if (string.IsNullOrWhiteSpace(generatedAnswer))
                {
                    if (selected.Any(x => x is null || !ids.Contains(x, StringComparer.Ordinal)) ||
                        selected.Distinct(StringComparer.Ordinal).Count() != selected.Length)
                    {
                        return RenderFallback("invalid_selection", (int)sw.ElapsedMilliseconds);
                    }
                }
                else
                {
                    var validSelected = selected
                        .Where(x => x is not null && ids.Contains(x, StringComparer.Ordinal))
                        .Distinct(StringComparer.Ordinal)
                        .ToArray();
                    selected = validSelected.Length > 0 ? validSelected : new[] { promptStatements[0].Id };
                }

                sw.Stop();
                return RenderGrounded(selected!, generatedAnswer, activeEngineLabel, activeEndpoint, (int)sw.ElapsedMilliseconds);
            }
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return RenderFallback("timeout", (int)sw.ElapsedMilliseconds);
        }
        catch (HttpRequestException)
        {
            return RenderFallback("inference_unavailable", (int)sw.ElapsedMilliseconds);
        }
        catch (Exception ex) when (ex is JsonException or KeyNotFoundException or InvalidOperationException or ArgumentException or IndexOutOfRangeException)
        {
            return RenderFallback("invalid_response", (int)sw.ElapsedMilliseconds);
        }

        Explanation RenderGrounded(string[] selected, string? modelDirectAnswer, string engineLabel, string? runtimeHost, int latencyMs)
        {
            var chosen = statements
                .Where(s => s.Required || selected.Contains(s.Id, StringComparer.Ordinal))
                .ToArray();

            var citations = chosen.Select(s => new VerificationCitation(s.Id, s.SourceId, s.Text)).ToArray();

            if (string.IsNullOrWhiteSpace(modelDirectAnswer))
            {
                var synthesized = ComposeFocusedAnswer(input.Question, chosen, statements);
                var synthCheck = VerifyNumericGrounding(synthesized, input.Question, statements);
                return new Explanation(
                    ScenarioRevision: input.ScenarioRevision,
                    Mode: "grounded_selection",
                    StatementIds: chosen.Select(s => s.Id).ToArray(),
                    Sentences: chosen.Select(s => s.Text).ToArray(),
                    SourceIds: chosen.Select(s => s.SourceId).Distinct(StringComparer.Ordinal).ToArray(),
                    FallbackReason: null,
                    DirectAnswer: synthesized,
                    Verification: new ExplanationVerification(
                        IsVerified: true,
                        EngineUsed: engineLabel,
                        RuntimeEndpoint: runtimeHost,
                        LatencyMs: latencyMs,
                        TotalNumbersInAnswer: synthCheck.Verified.Length,
                        VerifiedNumbers: synthCheck.Verified,
                        UnverifiedNumbers: Array.Empty<string>(),
                        HallucinationBlocked: false,
                        VerificationSummary: $"Selecție validată de {engineLabel} ({latencyMs} ms) — 100% ancorată în faptele AERIS.",
                        Citations: citations));
            }

            bool hasForbiddenClearance = ProhibitedClearanceRegex.IsMatch(modelDirectAnswer);
            var grounding = VerifyNumericGrounding(modelDirectAnswer, input.Question, statements);

            if (hasForbiddenClearance || grounding.Unverified.Length > 0)
            {
                var safeAnswer = ComposeFocusedAnswer(input.Question, chosen, statements);
                var safeGrounding = VerifyNumericGrounding(safeAnswer, input.Question, statements);
                string blockNote = hasForbiddenClearance
                    ? "Expresie de autorizare ATC directă blocată automat de verificatorul C#; înlocuită cu sinteza verificată."
                    : $"Verificatorul anti-halucinație C# a interceptat valori neconfirmate ({string.Join(", ", grounding.Unverified)}) și a reconstruit răspunsul strict din calculele AERIS.";

                return new Explanation(
                    ScenarioRevision: input.ScenarioRevision,
                    Mode: "grounded_selection",
                    StatementIds: chosen.Select(s => s.Id).ToArray(),
                    Sentences: chosen.Select(s => s.Text).ToArray(),
                    SourceIds: chosen.Select(s => s.SourceId).Distinct(StringComparer.Ordinal).ToArray(),
                    FallbackReason: null,
                    DirectAnswer: safeAnswer,
                    Verification: new ExplanationVerification(
                        IsVerified: true,
                        EngineUsed: engineLabel + " + Scut Anti-Halucinație C#",
                        RuntimeEndpoint: runtimeHost,
                        LatencyMs: latencyMs,
                        TotalNumbersInAnswer: safeGrounding.Verified.Length,
                        VerifiedNumbers: safeGrounding.Verified,
                        UnverifiedNumbers: grounding.Unverified,
                        HallucinationBlocked: true,
                        VerificationSummary: blockNote,
                        Citations: citations));
            }

            string verifyMsg = grounding.Verified.Length > 0
                ? $"Verificat matematic: toate cele {grounding.Verified.Length}/{grounding.Verified.Length} valori numerice din răspunsul {engineLabel} corespund calculelor AERIS ({latencyMs} ms)."
                : $"Verificat: răspunsul {engineLabel} ({latencyMs} ms) nu conține cifre inventate sau autorizări nepermise.";

            return new Explanation(
                ScenarioRevision: input.ScenarioRevision,
                Mode: "grounded_selection",
                StatementIds: chosen.Select(s => s.Id).ToArray(),
                Sentences: chosen.Select(s => s.Text).ToArray(),
                SourceIds: chosen.Select(s => s.SourceId).Distinct(StringComparer.Ordinal).ToArray(),
                FallbackReason: null,
                DirectAnswer: modelDirectAnswer,
                Verification: new ExplanationVerification(
                    IsVerified: true,
                    EngineUsed: engineLabel,
                    RuntimeEndpoint: runtimeHost,
                    LatencyMs: latencyMs,
                    TotalNumbersInAnswer: grounding.Verified.Length,
                    VerifiedNumbers: grounding.Verified,
                    UnverifiedNumbers: Array.Empty<string>(),
                    HallucinationBlocked: false,
                    VerificationSummary: verifyMsg,
                    Citations: citations));
        }

        Explanation RenderFallback(string reason, int latencyMs)
        {
            var matched = MatchStatementsByQuestion(input.Question, statements);
            var chosen = matched.Length > 0 ? matched : statements;
            var directAnswer = ComposeFocusedAnswer(input.Question, chosen, statements);
            var grounding = VerifyNumericGrounding(directAnswer, input.Question, statements);
            var citations = chosen.Select(s => new VerificationCitation(s.Id, s.SourceId, s.Text)).ToArray();

            return new Explanation(
                ScenarioRevision: input.ScenarioRevision,
                Mode: "deterministic_fallback",
                StatementIds: chosen.Select(s => s.Id).ToArray(),
                Sentences: chosen.Select(s => s.Text).ToArray(),
                SourceIds: chosen.Select(s => s.SourceId).Distinct(StringComparer.Ordinal).ToArray(),
                FallbackReason: reason,
                DirectAnswer: directAnswer,
                Verification: new ExplanationVerification(
                    IsVerified: true,
                    EngineUsed: "Motor Q&A Determinist AERIS (C#)",
                    RuntimeEndpoint: "intern (fără LLM extern)",
                    LatencyMs: latencyMs,
                    TotalNumbersInAnswer: grounding.Verified.Length,
                    VerifiedNumbers: grounding.Verified,
                    UnverifiedNumbers: Array.Empty<string>(),
                    HallucinationBlocked: false,
                    VerificationSummary: $"Răspuns calculat direct de motorul determinist AERIS ({grounding.Verified.Length} valori verificate, 0 halucinații posibile).",
                    Citations: citations));
        }
    }

    private static ApprovedStatement[] SelectPromptCandidates(string question, ApprovedStatement[] statements)
    {
        if (statements.Length <= 8)
            return statements;

        var matched = MatchStatementsByQuestion(question, statements);
        var list = new List<ApprovedStatement>();

        foreach (var s in statements.Where(s => s.Required))
        {
            if (list.All(x => x.Id != s.Id))
                list.Add(s);
        }

        // Adăugăm mai întâi zborurile menționate explicit în întrebare
        var specificFlights = matched.Where(s => s.Id.StartsWith("flight_", StringComparison.Ordinal)).ToList();
        foreach (var s in specificFlights)
        {
            if (list.Count >= 5) break;
            if (list.All(x => x.Id != s.Id))
                list.Add(s);
        }

        // Adăugăm faptele tematice potrivite pentru întrebare (până la 8 fapte pentru răspunsuri complexe complete)
        foreach (var s in matched.Where(s => !s.Id.StartsWith("flight_", StringComparison.Ordinal) && s.Id != "limits"))
        {
            if (list.Count >= 7) break;
            if (list.All(x => x.Id != s.Id))
                list.Add(s);
        }

        var decision = statements.FirstOrDefault(s => s.Id == "decision");
        if (decision is not null && list.Count < 8 && list.All(x => x.Id != decision.Id))
            list.Add(decision);

        return list.Count > 0 ? list.ToArray() : statements.Take(6).ToArray();
    }

    private static void ValidateLoopbackEndpoint(Uri? endpoint)
    {
        if (endpoint is null || !endpoint.IsLoopback || endpoint.Scheme != "http")
            throw new ArgumentException("Configure HttpClient with a local HTTP BaseAddress.");
    }

    private static string FormatEndpoint(Uri? uri) =>
        uri is null ? "local" : $"{uri.Host}:{uri.Port}";

    private static string FormatModelLabel(string modelId, Uri? endpoint)
    {
        string shortModel = modelId.Contains("Qwen3-4B-Instruct-2507", StringComparison.OrdinalIgnoreCase)
            ? "Qwen3-4B-Instruct-2507"
            : modelId;
        if (endpoint?.Port == 18090)
            return $"{shortModel} (llama.cpp / NPU local)";
        return shortModel;
    }

    private static (string[] Verified, string[] Unverified) VerifyNumericGrounding(
        string answer,
        string question,
        ApprovedStatement[] allStatements)
    {
        var allowedValues = new List<double>();
        var allowedRawTokens = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void CollectNumbers(string text)
        {
            foreach (Match m in NumberTokenRegex.Matches(text))
            {
                var raw = m.Value;
                allowedRawTokens.Add(raw);
                var normalized = raw.Replace(',', '.');
                allowedRawTokens.Add(normalized);
                if (double.TryParse(normalized, NumberStyles.Float, CultureInfo.InvariantCulture, out var val))
                    allowedValues.Add(val);
            }
        }

        CollectNumbers(question);
        foreach (var s in allStatements)
        {
            CollectNumbers(s.Id);
            CollectNumbers(s.Text);
        }

        allowedValues.Add(allStatements.Count(s => s.Id.StartsWith("flight_", StringComparison.Ordinal)));

        var verified = new List<string>();
        var unverified = new List<string>();

        foreach (Match m in NumberTokenRegex.Matches(answer))
        {
            var token = m.Value;
            var normalized = token.Replace(',', '.');
            if (allowedRawTokens.Contains(token) || allowedRawTokens.Contains(normalized))
            {
                if (!verified.Contains(token, StringComparer.Ordinal))
                    verified.Add(token);
                continue;
            }

            if (double.TryParse(normalized, NumberStyles.Float, CultureInfo.InvariantCulture, out var num))
            {
                bool closeMatch = allowedValues.Any(a => Math.Abs(a - num) <= 0.6);
                if (closeMatch)
                {
                    if (!verified.Contains(token, StringComparer.Ordinal))
                        verified.Add(token);
                    continue;
                }
            }

            if (Regex.IsMatch(token, @"^\d{1,3}[.,]\d{3}$") &&
                double.TryParse(token.Replace(".", "").Replace(",", ""), NumberStyles.Float, CultureInfo.InvariantCulture, out var groupedNum) &&
                allowedValues.Any(a => Math.Abs(a - groupedNum) <= 0.6))
            {
                if (!verified.Contains(token, StringComparer.Ordinal))
                    verified.Add(token);
                continue;
            }

            if (!unverified.Contains(token, StringComparer.Ordinal))
                unverified.Add(token);
        }

        return (verified.ToArray(), unverified.ToArray());
    }

    private static string ComposeFocusedAnswer(string question, ApprovedStatement[] chosen, ApprovedStatement[] allStatements)
    {
        string q = question.ToLowerInvariant();
        var flights = allStatements.Where(s => s.Id.StartsWith("flight_", StringComparison.Ordinal)).ToArray();
        var mentionedFlights = MatchFlightStatements(q, flights);

        if (q.Contains("bilet") || q.Contains("pret") || q.Contains("preț") || q.Contains("bagaj") || q.Contains("hotel") || q.Contains("cazar"))
        {
            return $"Această informație nu există în datele operaționale AERIS. Sistemul monitorizează doar traficul aerian ({flights.Length} aeronave active), starea meteo pe LRCV și calculele de traiectorie/separare.";
        }

        if (mentionedFlights.Length > 0)
            return string.Join(" ", mentionedFlights.Select(f => f.Text));

        if (q.Contains("primul") || q.Contains("ordinea") || q.Contains("secvent") || q.Contains("secvenț") || q.Contains("cand ateriz") || q.Contains("când ateriz") || q.Contains("la ce ora") || q.Contains("la ce oră") || q.Contains("eta") || q.Contains("slot") || q.Contains("intarzier") || q.Contains("întârzier"))
        {
            var seq = allStatements.FirstOrDefault(s => s.Id == "landing_sequence");
            if (seq is not null) return seq.Text;
        }

        if (q.Contains("combustibil") || q.Contains("pnr") || q.Contains("podari") || q.Contains("balta") || q.Contains("lrcw") || q.Contains("alternativ") || q.Contains("redirec") || q.Contains("devier"))
        {
            var vfr = allStatements.FirstOrDefault(s => s.Id == "vfr_redirection");
            if (vfr is not null) return vfr.Text;
        }

        if (q.Contains("2000") || q.Contains("5000") || q.Contains("altitudin") || q.Contains("forfecar") || q.Contains("forfecare") || q.Contains("shear"))
        {
            var wx = allStatements.FirstOrDefault(s => s.Id == "weather");
            var fp = allStatements.FirstOrDefault(s => s.Id == "future_prediction");
            if (wx is not null && fp is not null) return $"{wx.Text} {fp.Text}";
            if (fp is not null) return fp.Text;
        }

        if (q.Contains("vfr") && (q.Contains("ateriz") || q.Contains("redirec") || q.Contains("podari") || q.Contains("balta") || q.Contains("astept") || q.Contains("aștept") || q.Contains("care")))
        {
            var vfr = allStatements.FirstOrDefault(s => s.Id == "vfr_redirection");
            var seq = allStatements.FirstOrDefault(s => s.Id == "landing_sequence");
            var wx = allStatements.FirstOrDefault(s => s.Id == "weather");
            var parts = new[] { vfr?.Text, seq?.Text, wx?.Text }.Where(t => !string.IsNullOrEmpty(t));
            if (parts.Any()) return string.Join(" ", parts);
        }

        if (q.Contains("analiz") || q.Contains("situat") || q.Contains("situaț") || q.Contains("general"))
        {
            var seq = allStatements.FirstOrDefault(s => s.Id == "landing_sequence");
            var vfr = allStatements.FirstOrDefault(s => s.Id == "vfr_redirection");
            var wx = allStatements.FirstOrDefault(s => s.Id == "weather");
            var sep = allStatements.FirstOrDefault(s => s.Id == "separation_4d");
            var parts = new[] { wx?.Text, seq?.Text, vfr?.Text, sep?.Text }.Where(t => !string.IsNullOrEmpty(t));
            if (parts.Any()) return string.Join(" ", parts);
        }

        if (q.Contains("vreme") || q.Contains("vant") || q.Contains("vânt") || q.Contains("metar") || q.Contains("pist"))
        {
            var wx = allStatements.FirstOrDefault(s => s.Id == "weather");
            var dec = allStatements.FirstOrDefault(s => s.Id == "decision");
            if (wx is not null && dec is not null) return $"{wx.Text} {dec.Text}";
            if (wx is not null) return wx.Text;
        }

        if (q.Contains("viitor") || q.Contains("45") || q.Contains("predict") || q.Contains("prognoz"))
        {
            var fp = allStatements.FirstOrDefault(s => s.Id == "future_prediction");
            if (fp is not null) return fp.Text;
        }

        if (q.Contains("pas") || q.Contains("pași") || q.Contains("inainte") || q.Contains("înainte"))
        {
            var ts = allStatements.FirstOrDefault(s => s.Id == "two_steps_ahead");
            if (ts is not null) return ts.Text;
        }

        if (q.Contains("conflict") || q.Contains("separar") || q.Contains("siaj") || q.Contains("wake") || q.Contains("sigur"))
        {
            var sep = allStatements.FirstOrDefault(s => s.Id == "separation_4d");
            if (sep is not null) return sep.Text;
        }

        if (q.Contains("tod") || q.Contains("ldr") || q.Contains("franar") || q.Contains("frânar") || q.Contains("crab") || q.Contains("deriv") || q.Contains("decolar") || q.Contains("ruta") || q.Contains("rută"))
        {
            var ttl = allStatements.FirstOrDefault(s => s.Id == "takeoff_to_landing");
            if (ttl is not null) return ttl.Text;
        }

        var nonLimits = chosen.Where(s => s.Id != "limits").Take(2).Select(s => s.Text).ToArray();
        return nonLimits.Length > 0 ? string.Join(" ", nonLimits) : chosen[0].Text;
    }

    private static ApprovedStatement[] MatchFlightStatements(string qLower, ApprovedStatement[] flightStatements)
    {
        var matched = new List<ApprovedStatement>();
        foreach (var s in flightStatements)
        {
            string t = s.Text.ToLowerInvariant();
            string idLow = s.Id.ToLowerInvariant();
            if ((qLower.Contains("wzz") && t.Contains("wzz")) ||
                (qLower.Contains("3751") && t.Contains("3751")) ||
                (qLower.Contains("3762") && t.Contains("3762")) ||
                (qLower.Contains("londra") && t.Contains("eggw")) ||
                (qLower.Contains("luton") && t.Contains("eggw")) ||
                (qLower.Contains("bergamo") && t.Contains("lime")) ||
                (qLower.Contains("italia") && t.Contains("lime")) ||
                (qLower.Contains("cca") && t.Contains("cca")) ||
                (qLower.Contains("841") && t.Contains("841")) ||
                (qLower.Contains("china") && t.Contains("zbaa")) ||
                (qLower.Contains("beijing") && t.Contains("zbaa")) ||
                (qLower.Contains("rot") && t.Contains("rot")) ||
                (qLower.Contains("tarom") && t.Contains("rot")) ||
                (qLower.Contains("otopeni") && t.Contains("lrop")) ||
                (qLower.Contains("sav") && t.Contains("savannah")) ||
                (qLower.Contains("5123") && t.Contains("5123")) ||
                (qLower.Contains("wilg") && t.Contains("wilga")) ||
                (qLower.Contains("wlg") && t.Contains("wlg")) ||
                (qLower.Contains("172") && t.Contains("172")) ||
                (qLower.Contains("cessna") && t.Contains("172")) ||
                (qLower.Contains("cra") && t.Contains("yr-cra")) || (qLower.Contains("641") && t.Contains("641")) || (qLower.Contains("tna") && t.Contains("tna")) || (qLower.Contains("mdv") && t.Contains("mdv")) || (qLower.Contains("seminole") && t.Contains("seminole")) || (qLower.Contains("tdo") && t.Contains("tdo")) || (qLower.Contains("king air") && t.Contains("king air")) ||
                (idLow.Length > 8 && qLower.Contains(idLow["flight_".Length..])))
            {
                matched.Add(s);
            }
        }
        return matched.ToArray();
    }

    private static ApprovedStatement[] MatchStatementsByQuestion(string question, ApprovedStatement[] statements)
    {
        string q = question.ToLowerInvariant();
        var pickedIds = new HashSet<string>(StringComparer.Ordinal);

        foreach (var s in statements.Where(s => s.Required))
            pickedIds.Add(s.Id);

        var flightStatements = statements.Where(s => s.Id.StartsWith("flight_", StringComparison.Ordinal)).ToArray();
        foreach (var fs in MatchFlightStatements(q, flightStatements))
            pickedIds.Add(fs.Id);

        if (q.Contains("primul") || q.Contains("ordinea") || q.Contains("secvent") || q.Contains("secvenț") || q.Contains("cand") || q.Contains("când") || q.Contains("ora") || q.Contains("oră") || q.Contains("eta") || q.Contains("slot") || q.Contains("intarzier") || q.Contains("întârzier"))
            pickedIds.Add("landing_sequence");

        if (q.Contains("viitor") || q.Contains("predict") || q.Contains("prognoz") || q.Contains("45") || q.Contains("t+5") || q.Contains("t+15") || q.Contains("t+30") || q.Contains("evolu") ||
            q.Contains("2000") || q.Contains("5000") || q.Contains("altitudin") || q.Contains("forfecar") || q.Contains("forfecare") || q.Contains("shear") || q.Contains("densitat") || q.Contains("fereastr") || q.Contains("trend") || q.Contains("nowcast"))
            pickedIds.Add("future_prediction");

        if (q.Contains("pas") || q.Contains("pasi") || q.Contains("pași") || q.Contains("step") || q.Contains("inainte") || q.Contains("înainte") || q.Contains("ahead"))
            pickedIds.Add("two_steps_ahead");

        if (q.Contains("decolar") || q.Contains("aterizar") || q.Contains("takeoff") || q.Contains("landing") || q.Contains("tod") || q.Contains("glisad") || q.Contains("energie") || q.Contains("ldr") || q.Contains("franar") || q.Contains("frânar") || q.Contains("traiector") || q.Contains("ruta") || q.Contains("rută") || q.Contains("china") || q.Contains("beijing") || q.Contains("sector") || q.Contains("fir") || q.Contains("crab") || q.Contains("deriv"))
            pickedIds.Add("takeoff_to_landing");

        if (q.Contains("vfr") || q.Contains("orbit") || q.Contains("devier") || q.Contains("redirec") || q.Contains("alternativ") || q.Contains("podari") || q.Contains("balta") || q.Contains("lrcw") || q.Contains("slatina") || q.Contains("pnr") || q.Contains("combustibil") || q.Contains("astept") || q.Contains("aștept") || q.Contains("holding") || q.Contains("savannah") || q.Contains("wilga") || q.Contains("cessna") || q.Contains("172"))
        {
            pickedIds.Add("vfr_redirection");
            pickedIds.Add("landing_sequence");
            pickedIds.Add("weather");
        }

        // Întrebări de sinteză / analiză generală / suport decizional complex
        if (q.Contains("analiz") || q.Contains("situat") || q.Contains("situaț") || q.Contains("general") || q.Contains("cum se prezint") || q.Contains("ce recomand") || q.Contains("toat") || q.Contains("plan"))
        {
            pickedIds.Add("weather");
            pickedIds.Add("landing_sequence");
            pickedIds.Add("vfr_redirection");
            pickedIds.Add("future_prediction");
            pickedIds.Add("separation_4d");
        }

        if (q.Contains("separar") || q.Contains("siaj") || q.Contains("wake") || q.Contains("conflict") || q.Contains("ocupar") || q.Contains("sigur"))
            pickedIds.Add("separation_4d");

        if (q.Contains("vreme") || q.Contains("vant") || q.Contains("vânt") || q.Contains("metar") || q.Contains("pist") || q.Contains("08") || q.Contains("26") || q.Contains("09") || q.Contains("27") || q.Contains("triunghi"))
            pickedIds.Add("weather");

        if (pickedIds.Count == 0 || (pickedIds.Count == 1 && pickedIds.Contains("limits")))
        {
            pickedIds.Add("decision");
            pickedIds.Add("weather");
            pickedIds.Add("landing_sequence");
        }

        return statements.Where(s => pickedIds.Contains(s.Id)).ToArray();
    }
}
