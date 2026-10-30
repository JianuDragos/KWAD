namespace Aeris.PlanningEngine;

public enum FlightRules
{
    IFR,
    VFR
}

public record AircraftInput(
    string Id,
    FlightRules FlightRules,
    double EtaSeconds,
    double EarliestSeconds,
    double LatestSeconds,
    double? FrozenTimeSeconds = null
);

public record ScenarioRules(
    double MinimumGapSeconds,
    bool AllowVfr = true,
    double BaseTimeOffsetSeconds = 50400 // Offset implicit: 14:00 (14 * 3600 secunde)
);

public record ScheduleSlot(
    string AircraftId,
    FlightRules FlightRules,
    double CalculatedTimeSeconds,
    double DelaySeconds,
    string FormattedTime,
    double DelayMinutes
);

public record EvaluationVariant(
    List<string> SequenceOrder,
    List<ScheduleSlot> Schedule,
    bool IsValid,
    string? RejectionReason,
    double TotalDelaySeconds,
    double TotalDelayMinutes,
    double MaxDelaySeconds,
    double MaxDelayMinutes,
    int DelayedAircraftCount
);

public record PlanningResponse(
    List<EvaluationVariant> ValidVariants,
    List<EvaluationVariant> RejectedVariants,
    int TotalEvaluatedVariants
);
