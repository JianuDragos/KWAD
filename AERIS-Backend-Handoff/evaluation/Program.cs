using Aeris.LocalAI;
using System.Diagnostics;
using System.Text.Json;

if(args.Length < 3) throw new ArgumentException("Usage: <questions.json> <result-dir> <model-alias> [endpoint]");
var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented=true };
var cases = JsonSerializer.Deserialize<TestCase[]>(File.ReadAllText(args[0]), options)!;
if (Directory.Exists(args[1]) && Directory.EnumerateFileSystemEntries(args[1]).Any())
    throw new ArgumentException("Use a new empty result directory; existing evidence is never overwritten.");
Directory.CreateDirectory(args[1]);
using var recorder = new RecordingHandler(new HttpClientHandler { UseProxy=false });
using var client = new HttpClient(recorder) { BaseAddress=new Uri(args.Length>3?args[3]:"http://127.0.0.1:18090/"), Timeout=Timeout.InfiniteTimeSpan };
var service = new GroundedExplainer(client, args[2]);
var required = Fixture.Statements.Where(s=>s.Required).Select(s=>s.Id).ToArray();
var rows=new List<object>();
int relevant=0,preserved=0,fallbacks=0;
foreach(var test in cases) {
    recorder.RawResponse=null;
    var timer=Stopwatch.StartNew();
    var result=await service.ExplainAsync(new(test.Question,42,Fixture.Statements));
    var seconds=timer.Elapsed.TotalSeconds;
    var wanted=test.Expected.Concat(required).Distinct().Order().ToArray();
    bool correct=test.Expected.Length==0 ? result.Mode=="deterministic_fallback" && result.FallbackReason=="no_matching_statement"
        : result.Mode=="grounded_selection" && result.StatementIds.Order().SequenceEqual(wanted);
    bool facts=result.ScenarioRevision==42 && required.All(result.StatementIds.Contains) && result.StatementIds.Length==result.Sentences.Length &&
        result.StatementIds.Zip(result.Sentences).All(x=>Fixture.Statements.Any(s=>s.Id==x.First&&s.Text==x.Second));
    relevant+=correct?1:0;preserved+=facts?1:0;fallbacks+=result.Mode=="deterministic_fallback"?1:0;
    var row=new{test.Id,test.Question,test.Expected,seconds,relevance_pass=correct,factual_preservation_pass=facts,result,raw_response=recorder.RawResponse};
    File.WriteAllText(Path.Combine(args[1],test.Id+".json"),JsonSerializer.Serialize(row,options));rows.Add(row);
    Console.WriteLine($"{test.Id}: relevant={correct}, facts={facts}, {seconds:F2}s, {result.Mode}, {string.Join(',',result.StatementIds)}");
}
File.WriteAllText(Path.Combine(args[1],"summary.json"),JsonSerializer.Serialize(new{model=args[2],count=cases.Length,relevance_pass=relevant,factual_preservation_pass=preserved,fallbacks,acceptance_target=0.90,task="backend-approved statement selection; not free-form generation"},options));
Console.WriteLine($"Relevance {relevant}/{cases.Length}; factual preservation {preserved}/{cases.Length}; fallback {fallbacks}");
record TestCase(string Id,string Question,string[] Expected);
sealed class RecordingHandler(HttpMessageHandler inner):DelegatingHandler(inner) {
    public string? RawResponse;
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct) {
        var response=await base.SendAsync(request,ct);RawResponse=await response.Content.ReadAsStringAsync(ct);return response;
    }
}
