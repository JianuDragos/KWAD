namespace Aeris.PlanningEngine.Models;

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
