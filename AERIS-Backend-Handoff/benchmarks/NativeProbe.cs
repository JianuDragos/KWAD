using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Microsoft.AI.Foundry.Local;
using Microsoft.Extensions.Logging.Abstractions;
namespace Aeris;
public static class NativeProbe
{
    public static async Task Run(string[] args)
    {
        var dir=Path.GetFullPath(args[2]);Directory.CreateDirectory(dir);
        // A watchdog terminates this isolated worker even if unmanaged code ignores cancellation.
        using var watchdog=new Timer(_=>{Console.Error.WriteLine("Native worker watchdog: 120 seconds");Environment.Exit(124);},null,120000,Timeout.Infinite);
        var config=new Configuration{AppName="AerisLocalBench",AppDataDir=Path.Combine(dir,"appdata"),ModelCacheDir=Path.GetFullPath(args[1]),LogsDir=Path.Combine(dir,"logs"),LogLevel=Microsoft.AI.Foundry.Local.LogLevel.Information,DisableNonessentialTelemetry=true};
        await FoundryLocalManager.CreateAsync(config,NullLogger.Instance);using var mgr=FoundryLocalManager.Instance;
        File.WriteAllText(Path.Combine(dir,"eps.json"),JsonSerializer.Serialize(mgr.DiscoverEps(),Json.Options));
        await mgr.DownloadAndRegisterEpsAsync();var cat=await mgr.GetCatalogAsync();var model=await cat.GetModelVariantAsync(args[0])??throw new Exception("Variant not found");
        File.WriteAllText(Path.Combine(dir,"model.json"),JsonSerializer.Serialize(model.Info,Json.Options));
        var load=Stopwatch.StartNew();await model.LoadAsync();Console.WriteLine($"Loaded {model.Id} in {load.Elapsed.TotalSeconds:F2}s");
        var c=Suite.Cases.Single(c=>c.Id=="J");var r=new RunResult{Model=model.Id,CaseId="J",Repeat=1,Transport="native-sdk-2.2.1",InferencePid=Environment.ProcessId};
        using var session=new ChatSession(model);session.SetStreaming(true);session.SetOptions(new RequestOptions{Search=new SearchOptions{Temperature=0,MaxOutputTokens=512,DoSample=false}});
        using var req=new Request().AddItem(MessageItem.System(Suite.SystemPrompt)).AddItem(MessageItem.User(Suite.Prompt(c)));
        using var cts=new CancellationTokenSource(TimeSpan.FromSeconds(45));var sw=Stopwatch.StartNew();var text=new StringBuilder();
        try{await using var stream=session.ProcessStreamingRequestAsync(req,cts.Token);await foreach(var item in stream){using(item){if(item is TextItem t){r.FirstContentSeconds??=sw.Elapsed.TotalSeconds;text.Append(t.Text);r.ContentChunks++;Console.Write(t.Text);if(Validator.Repeated(text.ToString())){r.Repetition=true;cts.Cancel();}}}}using var final=await stream.FinalResponse;r.FinishReason=final.FinishReason.ToString();var usage=final.GetUsage();r.ReportedPromptTokens=usage.PromptTokens;r.ReportedCompletionTokens=usage.CompletionTokens;}catch(Exception ex){r.Error=ex.ToString();}
        r.TotalSeconds=sw.Elapsed.TotalSeconds;r.Text=text.ToString();r.PeakProcessWorkingSetBytes=Process.GetCurrentProcess().PeakWorkingSet64;r.MinimumSystemAvailableBytes=Memory.Available();r.Validation=Validator.Check(c,r);File.WriteAllText(Path.Combine(dir,"result.json"),JsonSerializer.Serialize(r,Json.Options));Console.WriteLine($"\nPass={r.Validation.Pass}");req.Dispose();session.Dispose();await model.UnloadAsync();
    }
}

