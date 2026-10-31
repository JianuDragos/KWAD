namespace Aeris;
// Minimal deterministic fixture engine, not an operational separation planner.
public static class DemoServices
{
    public static Case GatherAndEvaluate()
    {
        var plans=new[]{new{Id="P1",Delays=new[]{3,5}},new{Id="P2",Delays=new[]{2,3}}};
        var evaluated=plans.Select(p=>new{p.Id,Total=p.Delays.Sum()}).ToArray();
        if(evaluated.Any(p=>p.Total<0))throw new InvalidOperationException("Invalid synthetic delay input");
        var best=evaluated.OrderBy(p=>p.Total).ThenBy(p=>p.Id).First();
        // PlanCase is the fixed offline scenario/weather repository adapter.
        return Suite.PlanCase("J",42,best.Id,evaluated.Single(p=>p.Id=="P2").Total,evaluated.Single(p=>p.Id=="P1").Total);
    }
}
