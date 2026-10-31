using System.Text.Json;
using System.Text.RegularExpressions;
namespace Aeris;
public static class Audit
{
    public static void Revalidate(string root)
    {
        var rows=new List<object>();
        foreach(var dir in Directory.GetDirectories(root))foreach(var file in Directory.GetFiles(dir,"*.json"))
        {
            if(!Regex.IsMatch(Path.GetFileName(file),@"^(A|B|C|D|E|G|H|I|J|J2)-\d+\.json$"))continue;
            var r=JsonSerializer.Deserialize<RunResult>(File.ReadAllText(file),Json.Options)!;
            var c=Suite.Cases.Single(c=>c.Id==r.CaseId);
            rows.Add(new{key=Path.GetFileName(dir)+"/"+Path.GetFileName(file),original=r.Validation,validation=Validator.Check(c,r),timing_valid=r.TotalSeconds<=50,timing_note=r.TotalSeconds>50?"External interruption/clock gap; exclude from performance calculations and retain raw sample":null});
        }
        File.WriteAllText(Path.Combine(root,"revalidation.json"),JsonSerializer.Serialize(rows,Json.Options));
        Console.WriteLine($"Revalidated {rows.Count} saved responses; original evidence unchanged.");
    }
}
