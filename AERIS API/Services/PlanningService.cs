namespace Aeris.PlanningEngine.Services;

public interface IPlanningService
{
    PlanningResponse EvaluateScenario(List<AircraftInput> aircrafts, ScenarioRules rules);
    PlanningResponse GetSampleScenario();
}

public class PlanningService : IPlanningService
{
    public PlanningResponse EvaluateScenario(List<AircraftInput> aircrafts, ScenarioRules rules)
    {
        var (isValid, errorMessage) = ScenarioValidator.Validate(aircrafts, rules);

        if (!isValid)
            throw new ArgumentException(errorMessage);

        if (aircrafts.Any(a => a.FlightRules == FlightRules.VFR) && !rules.AllowVfr)
        {
            return new PlanningResponse(
                ValidVariants: new List<EvaluationVariant>(),
                RejectedVariants: new List<EvaluationVariant>
                {
                    new(
                        SequenceOrder: aircrafts.Select(a => a.Id).ToList(),
                        Schedule: new List<ScheduleSlot>(),
                        IsValid: false,
                        RejectionReason: "Zborurile VFR sunt neeligibile în scenariu.",
                        TotalDelaySeconds: 0,
                        TotalDelayMinutes: 0,
                        MaxDelaySeconds: 0,
                        MaxDelayMinutes: 0,
                        DelayedAircraftCount: 0
                    )
                },
                TotalEvaluatedVariants: 1
            );
        }

        var candidateSequences = SequenceGenerator.GenerateCandidates(aircrafts);
        var allResults = candidateSequences.Select(seq => ScheduleCalculator.Calculate(seq, rules)).ToList();

        var validVariants = PlanEvaluator.RankVariants(allResults.Where(r => r.IsValid).ToList()).Take(3).ToList();
        var rejectedVariants = allResults.Where(r => !r.IsValid).ToList();

        return new PlanningResponse(
            ValidVariants: validVariants,
            RejectedVariants: rejectedVariants,
            TotalEvaluatedVariants: allResults.Count
        );
    }

    public PlanningResponse GetSampleScenario()
    {
        var rules = new ScenarioRules(MinimumGapSeconds: 120, AllowVfr: true, BaseTimeOffsetSeconds: 50400);

        var aircrafts = new List<AircraftInput>
        {
            // IFR1: ETA 14:00 (0s), Limits [14:00 (0s), 14:03 (180s)]
            new("IFR1", FlightRules.IFR, EtaSeconds: 0, EarliestSeconds: 0, LatestSeconds: 180),

            // IFR2: ETA 14:04 (240s), Limits [14:04 (240s), 14:10 (600s)]
            new("IFR2", FlightRules.IFR, EtaSeconds: 240, EarliestSeconds: 240, LatestSeconds: 600),

            // IFR3: ETA 14:08 (480s), Limits [14:08 (480s), 14:14 (840s)]
            new("IFR3", FlightRules.IFR, EtaSeconds: 480, EarliestSeconds: 480, LatestSeconds: 840),

            // VFR:  ETA 14:06 (360s), Limits [14:05 (300s), 14:07 (420s)]
            new("VFR",  FlightRules.VFR, EtaSeconds: 360, EarliestSeconds: 300, LatestSeconds: 420)
        };

        return EvaluateScenario(aircrafts, rules);
    }
}
