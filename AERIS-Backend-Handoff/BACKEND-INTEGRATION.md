# Connect to ASP.NET Core

Copy `backend/GroundedExplainer.cs` into the backend project, or reference `backend/Aeris.LocalAI.csproj`. It targets .NET 8 and has no NuGet dependencies. Run the model separately using Start-LLM.ps1; the API process does not load model weights or own the inference server.

Register the helper in Program.cs:

```csharp
using Aeris.LocalAI;

builder.Services.AddHttpClient<GroundedExplainer>(client =>
{
    client.BaseAddress = new Uri("http://127.0.0.1:18090/");
    client.Timeout = Timeout.InfiniteTimeSpan; // helper supplies a 30-second deadline
}).ConfigurePrimaryHttpMessageHandler(() =>
    new HttpClientHandler { UseProxy = false });
```

In your existing endpoint/service, fetch the current authorized scenario snapshot, run the mathematical planner, and render approved sentences. The following uses illustrative engine values, not a supplied AERIS engine API:

```csharp
var statements = new[]
{
    new ApprovedStatement("decision",
        "The engine selected P2; total delay is 5 minutes.", "ENGINE-42", Required: true),
    new ApprovedStatement("delays",
        "P1 totals 8 minutes; P2 totals 5 minutes. P2 has the lower total delay.", "ENGINE-42"),
    new ApprovedStatement("weather",
        "Synthetic observation: wind 240 degrees at 12 knots; visibility 6000 metres.", "WEATHER-42"),
    new ApprovedStatement("limits",
        "Simulation only. Operational criteria are missing; no flight permission is inferred.",
        "RULES-42", Required: true)
};

// Check the client's revision against your current snapshot BEFORE this call.
// Build statement text from that snapshot; do not accept statements from the browser.
var report = await explainer.ExplainAsync(
    new ExplanationRequest(question, snapshotRevision, statements), cancellationToken);
return Results.Ok(report);
```

The `sample/Program.cs` endpoint is a complete working example. Change its fixture lookup to your repository/planner call. Keep the selected option, missing criteria and simulation limitation marked Required. Keep IDs unique and stable within the snapshot. Use invariant formatting for numbers/times when rendering typed fields. Supply up to 32 statements, each at most 800 characters; in practice use a compact set of relevant facts to fit the 4096-token context. Long inputs can exceed model context and will fall back.

Output contract:

```json
{
  "scenarioRevision": 42,
  "mode": "grounded_selection",
  "statementIds": ["decision", "weather", "limits"],
  "sentences": ["Exact backend decision text", "Exact backend weather text", "Exact backend limitation text"],
  "sourceIds": ["ENGINE-42", "WEATHER-42", "RULES-42"],
  "fallbackReason": null
}
```

Display sentences as plain text in React and source IDs as references. `deterministic_fallback` means the complete approved scenario report is returned; label it as a general report, since it may not answer the question. `no_matching_statement` means there was no approved answer to select; other reasons include timeout, unavailable server, invalid model JSON or incomplete output. The helper never repairs or displays arbitrary generated prose.

Caller cancellation propagates so ASP.NET can stop work for a disconnected client; the helper's own deadline returns fallback. Client-side cancellation does not prove native inference stopped. Keep one dedicated server per laptop, bound the backend's request concurrency, and use your existing service supervision for recovery. Start/stop scripts handle only their owned process, not a shared Foundry daemon. The provided sample is for one local developer, not a multi-user production server.

Stale-state protection belongs to the backend: take one immutable snapshot, reject an already stale client revision, and compare again with current state if you require the answer to reflect changes made during generation. The helper echoes the supplied revision; it has no repository access. React must discard any response whose revision no longer matches its current scenario.

## Direct model API (experimental)

The same server also accepts standard chat completions, so your friend can use an existing HttpClient/OpenAI-compatible adapter with base URL and model above. `Test-LLM.ps1` demonstrates the exact HTTP request. Free-form generation remains experimental: the model failed parts of the full aviation benchmark. JSON schema ensures allowed structure, not factual truth. Do not replace the required planner-owned fields with model outputs, execute model-proposed clearances, or assume this narrow selection evaluation certifies unrestricted chat.

All input in this handoff is synthetic. Connecting real weather, aircraft repositories and RAG is application work: verify provenance/units in C#, preserve unknown fields, and avoid promoting retrieved prose into trusted instructions or approved statements without validation.
