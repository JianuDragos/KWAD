namespace Aeris.PlanningEngine.Models;

public record AircraftInput(
    string Id,
    FlightRules FlightRules,
    double EtaSeconds,
    double EarliestSeconds,
    double LatestSeconds,
    double? FrozenTimeSeconds = null
);
