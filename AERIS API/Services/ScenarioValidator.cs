namespace Aeris.PlanningEngine.Services;

public class ScenarioValidator
{
    public static (bool IsValid, string? ErrorMessage) Validate(List<AircraftInput> aircrafts, ScenarioRules rules)
    {
        if (aircrafts == null || !aircrafts.Any())
            return (false, "Lista de aeronave este goală.");

        if (aircrafts.Select(a => a.Id).Distinct().Count() != aircrafts.Count)
            return (false, "Existență ID-uri duplicate în lista de aeronave.");

        foreach (var ac in aircrafts)
        {
            if (ac.EarliestSeconds > ac.LatestSeconds)
                return (false, $"Aeronava {ac.Id} are EarliestSeconds ({ac.EarliestSeconds}s) > LatestSeconds ({ac.LatestSeconds}s).");

            if (ac.FrozenTimeSeconds.HasValue)
            {
                if (ac.FrozenTimeSeconds < ac.EarliestSeconds || ac.FrozenTimeSeconds > ac.LatestSeconds)
                    return (false, $"Timpul blocat ({ac.FrozenTimeSeconds}s) pentru {ac.Id} este în afara ferestrei permise.");
            }
        }

        return (true, null);
    }
}
