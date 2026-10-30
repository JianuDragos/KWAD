namespace Aeris.PlanningEngine.Models;

public record ScenarioRules(
    double MinimumGapSeconds,
    bool AllowVfr = true,
    double BaseTimeOffsetSeconds = 50400 // Offset implicit: 14:00 (14 * 3600 secunde)
);
