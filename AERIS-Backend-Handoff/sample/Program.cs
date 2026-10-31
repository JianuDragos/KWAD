using Aeris.LocalAI;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://127.0.0.1:5088");
builder.Services.AddHttpClient<GroundedExplainer>(client => {
    client.BaseAddress = new Uri("http://127.0.0.1:18090/");
    client.Timeout = Timeout.InfiniteTimeSpan;
}).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { UseProxy = false });
var app = builder.Build();
app.MapGet("/health", () => new { status = "ok", scenario_revision = 42 });
app.MapPost("/api/aeris/explain", async (QuestionInput input, GroundedExplainer explainer, HttpContext context) => {
    if (input.ScenarioRevision != 42) return Results.Conflict(new { error = "stale_revision", currentRevision = 42 });
    if (string.IsNullOrWhiteSpace(input.Question) || input.Question.Length > 1200) return Results.BadRequest(new { error = "question_length" });
    // Fetch the authorized scenario snapshot from your repository here. Clients supply no approved facts.
    var result = await explainer.ExplainAsync(new(input.Question, 42, Fixture.Statements), context.RequestAborted);
    return Results.Ok(result);
});
await app.RunAsync();
record QuestionInput(string Question, int ScenarioRevision);
