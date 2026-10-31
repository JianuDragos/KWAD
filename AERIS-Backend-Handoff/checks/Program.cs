using Aeris.LocalAI;
using System.Net;
using System.Text.Json;

var statements = new[] {
    new ApprovedStatement("plan", "Engine selected P2; total delay is 5 minutes.", "ENGINE-42", true),
    new ApprovedStatement("weather", "Synthetic observation: wind 240 degrees at 12 knots.", "WX-42"),
    new ApprovedStatement("limits", "Operational criteria are missing; no flight permission is inferred.", "RULES-42", true)
};
var request = new ExplanationRequest("What is the wind?", 42, statements);
int passed = 0;
void Check(bool ok, string name) { if (!ok) throw new Exception("FAIL: " + name); passed++; Console.WriteLine("PASS: " + name); }
GroundedExplainer Service(string content, int status = 200) => new(new HttpClient(new ReplyHandler(content, status)) { BaseAddress = new Uri("http://127.0.0.1:18090/") });
var result = await Service("{\"statement_ids\":[\"weather\"]}").ExplainAsync(request);
Check(result.Mode == "grounded_selection" && result.StatementIds.SequenceEqual(new[]{"plan","weather","limits"}), "required engine facts survive model omission");
Check(result.Sentences.SequenceEqual(statements.Select(s=>s.Text)) && result.ScenarioRevision == 42, "exact backend text and revision preserved");
foreach (var bad in new[]{"{\"statement_ids\":[\"I9\"]}", "{\"statement_ids\":[\"weather\",\"weather\"]}", "{\"statement_ids\":[]}", "{\"statement_ids\":[\"weather\"],\"explanation\":\"clearance granted\"}", "not json"}) {
    result = await Service(bad).ExplainAsync(request);
    Check(result.Mode == "deterministic_fallback" && result.Sentences.SequenceEqual(statements.Select(s=>s.Text)), "invalid selection falls back without invented prose: " + bad);
}
result = await Service("server unavailable", 503).ExplainAsync(request);
Check(result.Mode == "deterministic_fallback", "HTTP failure returns backend statements");
try { await Service("{}").ExplainAsync(request with { Statements = [statements[0], statements[0]] }); throw new Exception("Duplicate IDs accepted"); }
catch (ArgumentException) { Check(true, "duplicate backend IDs rejected"); }
try { await Service("{}").ExplainAsync(request with { Question = "" }); throw new Exception("Empty question accepted"); }
catch (ArgumentException) { Check(true, "empty question rejected"); }
try { await new GroundedExplainer(new HttpClient { BaseAddress = new Uri("https://example.com/") }).ExplainAsync(request); throw new Exception("Remote endpoint accepted"); }
catch (ArgumentException) { Check(true, "remote inference endpoint rejected"); }
using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
try { await Service("{}").ExplainAsync(request, cancelled.Token); throw new Exception("Caller cancellation ignored"); }
catch (OperationCanceledException) { Check(true, "caller cancellation propagates"); }
using var stalled = new HttpClient(new ReplyHandler(null)) { BaseAddress = new Uri("http://127.0.0.1:18090/") };
result = await new GroundedExplainer(stalled, timeout: TimeSpan.FromMilliseconds(40)).ExplainAsync(request);
Check(result.Mode == "deterministic_fallback" && result.FallbackReason == "timeout", "inference deadline uses deterministic fallback");
using var midFlight = new CancellationTokenSource(TimeSpan.FromMilliseconds(40));
try { await new GroundedExplainer(stalled).ExplainAsync(request, midFlight.Token); throw new Exception("In-flight caller cancellation ignored"); }
catch (OperationCanceledException) { Check(true, "caller cancellation during inference propagates instead of returning fallback"); }
Console.WriteLine($"{passed} checks passed");

sealed class ReplyHandler(string? content, int status = 200) : HttpMessageHandler {
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) {
        if (content is null) await Task.Delay(Timeout.Infinite, ct);
        var payload = status == 200 ? JsonSerializer.Serialize(new { choices = new[] { new { finish_reason="stop", message = new { content } } } }) : content;
        return new HttpResponseMessage((HttpStatusCode)status) { Content = new StringContent(payload!) };
    }
}
