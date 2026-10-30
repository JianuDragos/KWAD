namespace Aeris.PlanningEngine.Models;

public record ScheduleSlot(
    string AircraftId,
    FlightRules FlightRules,
    double CalculatedTimeSeconds,
    double DelaySeconds,
    string FormattedTime,
    double DelayMinutes
);
