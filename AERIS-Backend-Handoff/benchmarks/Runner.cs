using Aeris;
using System.Diagnostics;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

var mode=args.FirstOrDefault()??"help";
if(mode=="native"){await NativeProbe.Run(args.Skip(1).ToArray());return;}
if(mode=="selftest"){Validator.SelfTest();return;}
if(mode=="revalidate"){Audit.Revalidate(args[1]);return;}
if(mode=="help"){Console.WriteLine("bench <endpoint> <model-id> <result-dir> [repeats=3] [case=all] | serve <endpoint> <model-id> | native <model-id> <cache> <evidence-dir> | selftest");return;}
var endpoint=args[1];var model=args[2];using var engine=new Inference(endpoint,model);
if(mode=="bench")
{
    var dir=Path.GetFullPath(args[3]);Directory.CreateDirectory(dir);
    int repeats=args.Length>4?int.Parse(args[4]):3;var filter=args.Length>5?args[5]:"all";
    File.WriteAllText(Path.Combine(dir,"protocol.json"),JsonSerializer.Serialize(new{model,endpoint,temperature=0,max_tokens=512,request_timeout_seconds=45,repeats,filter,system_prompt=Suite.SystemPrompt,cases=Suite.Cases},Json.Options));
    int errors=0;
    for(int repeat=1;repeat<=repeats;repeat++)foreach(var c in Suite.Cases.Where(c=>filter=="all"||c.Id==filter))
    {
        var r=await engine.Run(c,repeat);File.WriteAllText(Path.Combine(dir,$"{c.Id}-{repeat}.json"),JsonSerializer.Serialize(r,Json.Options));
        Console.WriteLine($"{model} {c.Id}/{repeat} {r.TotalSeconds:F2}s first={r.FirstContentSeconds:F2}s pass={r.Validation?.Pass} error={r.Error} {string.Join(';',r.Validation?.Failures??[])}");
        errors=r.Validation?.Completion!=true?errors+1:0;if(errors>=3){Console.WriteLine("Circuit breaker: three consecutive failures.");return;}
    }
    if(filter=="all"||filter=="F")for(int repeat=1;repeat<=repeats;repeat++){var r=await engine.RunTool(repeat);File.WriteAllText(Path.Combine(dir,$"F-{repeat}.json"),JsonSerializer.Serialize(r,Json.Options));Console.WriteLine($"Tool/{repeat}: pass={r.Validation?.Pass}; error={r.Error}");}return;
}
if(mode=="serve")
{
    var builder=WebApplication.CreateBuilder([]);builder.WebHost.UseUrls("http://127.0.0.1:5088");var app=builder.Build();using var gate=new SemaphoreSlim(1,1);
    app.MapGet("/",()=>Results.Content("""
<!doctype html><html><head><meta charset="utf-8"><title>AERIS local prototype</title><style>body{font:16px system-ui;max-width:900px;margin:40px auto;background:#10202b;color:#edf6fa}textarea,button{font:inherit;padding:12px}textarea{width:90%}button{background:#71dfc1;border:0;margin:12px 0}pre{white-space:pre-wrap;background:#192f3e;padding:20px}</style></head><body><h1>AERIS · Local arrival explanation</h1><p>Synthetic LRCV scenario. The deterministic engine supplies the evaluated options.</p><p>Simulation only. Weather is a fixed offline mock observation.</p><textarea id="q">Which arrival option has the least total delay, and what weather information is available?</textarea><br><button id="b" onclick="go()">Analyze locally</button><pre id="out">Ready</pre><script>async function go(){b.disabled=true;out.textContent='Analyzing…';try{const r=await fetch('/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q.value,scenario_revision:42})});out.textContent=JSON.stringify(await r.json(),null,2)}catch(e){out.textContent=String(e)}finally{b.disabled=false}}</script></body></html>
""","text/html"));
    app.MapPost("/analyze",async(AnalyzeInput input,HttpContext context)=>
    {
        if(input.Scenario_revision!=42)return Results.Conflict(new{error="stale_scenario_revision",current_revision=42});
        if(string.IsNullOrWhiteSpace(input.Question)||input.Question.Length>1200)return Results.BadRequest(new{error="question_length"});
        if(model=="deterministic"){var report=Validator.Fallback(DemoServices.GatherAndEvaluate());report["warnings"]=new JsonArray("simulation_only");return Results.Ok(new{mode="deterministic",model=(string?)null,report});}
        if(!await gate.WaitAsync(0))return Results.Json(new{error="inference_busy"},statusCode:429);
        try{var fixture=DemoServices.GatherAndEvaluate();var c=fixture with{Question="User question (untrusted): "+input.Question+"\nExplain only this synthetic scenario and return the required report."};var r=await engine.Run(c,1,context.RequestAborted);bool valid=r.Validation?.Pass==true;return Results.Ok(new{mode=valid?"local_llm":"deterministic_fallback",model,elapsed_seconds=r.TotalSeconds,report=valid?JsonNode.Parse(r.Text):Validator.Fallback(fixture),validation=r.Validation,inference_error=r.Error});}finally{gate.Release();}
    });await app.RunAsync();
}
public record AnalyzeInput(string Question,int Scenario_revision);
public static class Json{public static readonly JsonSerializerOptions Options=new(){WriteIndented=true,PropertyNamingPolicy=JsonNamingPolicy.SnakeCaseLower};}
public class RunResult
{
    public string Model{get;set;}="";public string CaseId{get;set;}="";public int Repeat{get;set;}public DateTimeOffset StartedUtc{get;set;}=DateTimeOffset.UtcNow;
    public string Transport{get;set;}="http-sse";public string? ProviderEvidence{get;set;}public double? FirstContentSeconds{get;set;}public double TotalSeconds{get;set;}
    public long InitialProcessWorkingSetBytes{get;set;}public long PeakProcessWorkingSetBytes{get;set;}public ulong MinimumSystemAvailableBytes{get;set;}public int InferencePid{get;set;}
    public int ContentChunks{get;set;}public int? ReportedPromptTokens{get;set;}public int? ReportedCompletionTokens{get;set;}public double? ReportedTokensPerSecond=>ReportedCompletionTokens/TotalSeconds;
    public string? FinishReason{get;set;}public string Text{get;set;}="";public List<string> RawEvents{get;set;}=[];public string? Error{get;set;}public bool Repetition{get;set;}public Validation? Validation{get;set;}
}
public record Validation(bool Pass,bool Grounding,bool Instructions,bool Structure,bool Completion,string[] Failures);
public sealed class Inference:IDisposable
{
    readonly HttpClient client=new(new HttpClientHandler{UseProxy=false}){Timeout=Timeout.InfiniteTimeSpan};readonly string endpoint,model;
    public Inference(string endpoint,string model){var u=new Uri(endpoint);if(!u.IsLoopback||u.Scheme!="http")throw new ArgumentException("Only local HTTP inference is allowed.");this.endpoint=endpoint.TrimEnd('/');this.model=model;}
    public async Task<RunResult> Run(Case c,int repeat,CancellationToken external=default)
    {
        var r=await Send(new{model,messages=new[]{new{role="system",content=Suite.SystemPrompt},new{role="user",content=Suite.Prompt(c)}},temperature=0,max_tokens=512,stream=true,stream_options=new{include_usage=true}},c.Id,repeat,external);r.Validation=Validator.Check(c,r);return r;
    }
    public async Task<RunResult> RunTool(int repeat)
    {
        var r=await Send(new{model,messages=new[]{new{role="system",content="You are AERIS, an offline arrival simulation assistant. Retrieve missing facts using only approved tools. Do not invent weather. Request exactly one tool call; no explanation until facts are returned."},new{role="user",content="Get the scenario weather for scenario_id LRCV-SYN-42. Weather is missing. Use the appropriate tool with the exact scenario ID."}},tools=Suite.Tools,tool_choice="auto",temperature=0,max_tokens=512,stream=true,stream_options=new{include_usage=true}},"F",repeat,default);
        var calls=new Dictionary<int,(string Name,string Arguments)>();foreach(var raw in r.RawEvents)try{var n=JsonNode.Parse(raw);if(n?["choices"] is JsonArray choices)foreach(var ch in choices)if(ch?["delta"]?["tool_calls"] is JsonArray ts)foreach(var t in ts){var idx=t?["index"]?.GetValue<int>()??0;calls.TryGetValue(idx,out var old);calls[idx]=(old.Name+(t?["function"]?["name"]?.GetValue<string>()??""),old.Arguments+(t?["function"]?["arguments"]?.GetValue<string>()??""));}}catch{}
        bool ok=false;try{var call=calls.Single().Value;var a=JsonNode.Parse(call.Arguments)!.AsObject();ok=call.Name=="get_scenario_weather"&&a.Count==1&&a["scenario_id"]!.GetValue<string>()=="LRCV-SYN-42"&&string.IsNullOrWhiteSpace(r.Text)&&r.Error==null;}catch{}
        r.Validation=new(ok,ok,ok,ok,r.Error==null,ok?[]:["Expected exactly one weather tool call with exact scenario_id and no invented answer"]);return r;
    }
    async Task<RunResult> Send(object body,string id,int repeat,CancellationToken external)
    {
        var r=new RunResult{Model=model,CaseId=id,Repeat=repeat};var sw=Stopwatch.StartNew();using var timeout=CancellationTokenSource.CreateLinkedTokenSource(external);timeout.CancelAfter(TimeSpan.FromSeconds(45));using var sampleStop=new CancellationTokenSource();using var process=int.TryParse(Environment.GetEnvironmentVariable("AERIS_INFERENCE_PID"),out var inferencePid)?Process.GetProcessById(inferencePid):Process.GetProcessesByName("foundrylocald").FirstOrDefault();if(process!=null){r.InferencePid=process.Id;r.InitialProcessWorkingSetBytes=process.WorkingSet64;}r.MinimumSystemAvailableBytes=ulong.MaxValue;
        var sampler=Task.Run(async()=>{while(!sampleStop.IsCancellationRequested)try{if(process!=null){process.Refresh();r.PeakProcessWorkingSetBytes=Math.Max(r.PeakProcessWorkingSetBytes,process.WorkingSet64);}r.MinimumSystemAvailableBytes=Math.Min(r.MinimumSystemAvailableBytes,Memory.Available());await Task.Delay(100,sampleStop.Token);}catch{break;}});var text=new StringBuilder();
        try
        {
            using var request=new HttpRequestMessage(HttpMethod.Post,endpoint+"/v1/chat/completions"){Content=JsonContent.Create(body)};using var response=await client.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,timeout.Token);if(!response.IsSuccessStatusCode)throw new Exception($"HTTP {(int)response.StatusCode}: "+await response.Content.ReadAsStringAsync(timeout.Token));using var reader=new StreamReader(await response.Content.ReadAsStreamAsync(timeout.Token));
            while(await reader.ReadLineAsync(timeout.Token) is{} line)
            {
                if(!line.StartsWith("data: "))continue;var data=line[6..];if(data=="[DONE]")break;r.RawEvents.Add(data);var n=JsonNode.Parse(data)!;if(n["error"]!=null)throw new Exception(n["error"]!.ToJsonString());if(n["usage"] is{} usage){r.ReportedPromptTokens=usage["prompt_tokens"]?.GetValue<int>();r.ReportedCompletionTokens=usage["completion_tokens"]?.GetValue<int>();}
                if(n["choices"] is JsonArray choices)foreach(var ch in choices){var delta=ch?["delta"];var part=delta?["content"]?.GetValue<string>();if(!string.IsNullOrEmpty(part)){r.FirstContentSeconds??=sw.Elapsed.TotalSeconds;text.Append(part);r.ContentChunks++;}if(delta?["tool_calls"]!=null)r.FirstContentSeconds??=sw.Elapsed.TotalSeconds;r.FinishReason=ch?["finish_reason"]?.GetValue<string>()??r.FinishReason;}
                if(text.Length>16000)throw new Exception("Output character limit exceeded");if(r.ContentChunks%16==0&&Validator.Repeated(text.ToString())){r.Repetition=true;throw new Exception("Repeated output detected");}
            }
        }catch(Exception ex){r.Error=ex is OperationCanceledException?"Request timeout/cancellation (45-second maximum)":ex.ToString();}finally{r.Text=text.ToString();r.TotalSeconds=sw.Elapsed.TotalSeconds;sampleStop.Cancel();await sampler;r.Repetition|=Validator.Repeated(r.Text);}return r;
    }
    public void Dispose()=>client.Dispose();
}
public static class Memory
{
    [StructLayout(LayoutKind.Sequential)]struct Status{public uint Length,Load;public ulong TotalPhys,AvailPhys,TotalPage,AvailPage,TotalVirtual,AvailVirtual,AvailExtended;}
    [DllImport("kernel32.dll")]static extern bool GlobalMemoryStatusEx(ref Status s);
    public static ulong Available(){var s=new Status{Length=(uint)Marshal.SizeOf<Status>()};return GlobalMemoryStatusEx(ref s)?s.AvailPhys:0;}
}
public static class Validator
{
    public static bool Repeated(string s)
    {
        if(s.Length<160)return false;for(int i=0;i+40<=s.Length;i+=20){var part=s.Substring(i,40);int count=0,pos=0;while((pos=s.IndexOf(part,pos,StringComparison.Ordinal))>=0){count++;pos+=40;if(count>=4)return true;}}var words=Regex.Split(s.ToLowerInvariant(),@"\s+");var counts=new Dictionary<string,int>();for(int i=0;i+8<=words.Length;i++){var phrase=string.Join(' ',words.Skip(i).Take(8));counts.TryGetValue(phrase,out var n);if(n>=3)return true;counts[phrase]=n+1;}return false;
    }
    public static Validation Check(Case c,RunResult r)
    {
        var fail=new List<string>();bool structure=true,grounding=true,instructions=true;bool complete=r.Error==null&&!r.Repetition&&r.FinishReason is "stop" or "Stop"&&!string.IsNullOrWhiteSpace(r.Text);if(!complete)fail.Add("not_normal_completion");
        try
        {
            var n=JsonNode.Parse(r.Text)!.AsObject();var fields=new[]{"scenario_revision","summary","candidate_option_ids","explanation","relevant_source_ids","missing_information","warnings","facts"};if(n.Count!=fields.Length||fields.Any(k=>!n.ContainsKey(k))){structure=false;fail.Add("fields");}string summary=n["summary"]!.GetValue<string>(),explanation=n["explanation"]!.GetValue<string>();string[] ReadArray(string k)=>n[k]!.AsArray().Select(x=>x!.GetValue<string>()).ToArray();var candidates=ReadArray("candidate_option_ids");var sources=ReadArray("relevant_source_ids");var missing=ReadArray("missing_information");var warnings=ReadArray("warnings");
            if(n["scenario_revision"]!.GetValue<int>()!=c.Revision){structure=false;instructions=false;fail.Add("revision");}if(!candidates.Order().SequenceEqual(c.Candidates.Order())){structure=false;fail.Add("candidate_ids");}if(!sources.Order().SequenceEqual(c.Sources.Order())){structure=false;fail.Add("source_ids");}if(!JsonNode.DeepEquals(n["facts"],JsonNode.Parse(c.ExpectedFacts))){grounding=false;fail.Add("facts");}if(summary.Length>240||explanation.Length>600||summary.Length==0||explanation.Length==0){instructions=false;fail.Add("prose_length");}if(!warnings.Contains("simulation_only")||(c.Missing&&missing.Length==0)){instructions=false;fail.Add("missing_or_warning");}
            var prose=summary+" "+explanation;var data=JsonSerializer.Serialize(c.Data);foreach(var number in Numbers(prose))if(!Numbers(data).Contains(number)){grounding=false;fail.Add("unknown_number:"+number);}if(Regex.IsMatch(prose,@"\bdepartures?\b",RegexOptions.IgnoreCase)&&c.Id!="H"){instructions=false;fail.Add("departure_regression");}
        }catch(Exception ex){structure=false;grounding=false;instructions=false;fail.Add("invalid_json_or_type:"+ex.GetType().Name);}return new(complete&&structure&&grounding&&instructions,grounding,instructions,structure,complete,fail.ToArray());
    }
    public static JsonObject Fallback(Case c)=>new(){["scenario_revision"]=c.Revision,["summary"]="Engine-evaluated arrival option: "+c.Candidates[0],["candidate_option_ids"]=new JsonArray(c.Candidates.Select(x=>(JsonNode?)JsonValue.Create(x)).ToArray()),["explanation"]="The deterministic engine selected the option with the lowest supplied total delay. The weather is a synthetic observation. Operational permission cannot be determined from these data.",["relevant_source_ids"]=new JsonArray(c.Sources.Select(x=>(JsonNode?)JsonValue.Create(x)).ToArray()),["missing_information"]=new JsonArray("operational_criteria"),["warnings"]=new JsonArray("simulation_only","llm_unavailable_or_invalid"),["facts"]=JsonNode.Parse(c.ExpectedFacts)};
    public static HashSet<string> Numbers(string text) => Regex.Matches(text, @"(?<![A-Za-z0-9])[-+]?\d+(?:,\d{3})*(?::\d+)?(?:\.\d+)?").Select(m => m.Value.Replace(",", "")).ToHashSet();
    public static void SelfTest()
    {
        var c=Suite.Cases.Single(x=>x.Id=="J");var good=new RunResult{Text=Fallback(c).ToJsonString(),FinishReason="stop"};if(!Check(c,good).Pass)throw new Exception("Valid fallback rejected");foreach(var field in new[]{"scenario_revision","candidate_option_ids","relevant_source_ids","facts"}){var n=Fallback(c);n[field]=field=="scenario_revision"?JsonValue.Create(43):field=="facts"?JsonNode.Parse("{}"):new JsonArray("UNKNOWN");if(Check(c,new(){Text=n.ToJsonString(),FinishReason="stop"}).Pass)throw new Exception("Invalid "+field+" accepted");}if(Check(c,new(){Text=good.Text,FinishReason="length"}).Pass)throw new Exception("Truncation accepted");if(!Repeated(string.Concat(Enumerable.Repeat("This repeated segment is deliberately more than forty characters long. ",5))))throw new Exception("Repetition missed");var formatted=Fallback(c);formatted["summary"]="Visibility is 6,000m.";if(!Check(c,new(){Text=formatted.ToJsonString(),FinishReason="stop"}).Pass)throw new Exception("Formatted known number rejected");formatted["summary"]="Visibility is 5000m.";if(Check(c,new(){Text=formatted.ToJsonString(),FinishReason="stop"}).Grounding)throw new Exception("Unknown number adjacent to unit accepted");Console.WriteLine("PASS: fallback, stale revision, unknown IDs, facts, truncation, repetition, comma numbers, numbers adjacent to units");
    }
}



