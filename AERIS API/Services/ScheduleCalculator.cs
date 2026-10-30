using Aeris.PlanningEngine.Models;

namespace Aeris.PlanningEngine.Services;

public class ScheduleCalculator
{
    public static EvaluationVariant Calculate(List<AircraftInput> sequence, ScenarioRules rules)
    {
        var schedule = new List<ScheduleSlot>();
        double previousTime = 0;

        for (int i = 0; i < sequence.Count; i++)
        {
            var ac = sequence[i];
            double calculatedTime;

            if (ac.FrozenTimeSeconds.HasValue)
            {
                calculatedTime = ac.FrozenTimeSeconds.Value;

                if (calculatedTime < ac.EarliestSeconds || calculatedTime > ac.LatestSeconds)
                    return Reject(sequence, schedule, $"Aeronava {ac.Id} (timp blocat {calculatedTime}s) este în afara limitelor [{ac.EarliestSeconds}s, {ac.LatestSeconds}s].");

                if (i > 0 && (calculatedTime - previousTime) < rules.MinimumGapSeconds)
                    return Reject(sequence, schedule, $"Aeronava {ac.Id} încalcă intervalul minim de {rules.MinimumGapSeconds}s față de {previousTime}s.");
            }
            else
            {
                // Formula: L_i = max(e_i, a_i)
                double minLimit = Math.Max(ac.EarliestSeconds, ac.EtaSeconds);

                // Formula: t_1 = L_1, respectiv t_i = max(L_i, t_{i-1} + s_{i-1, i})
                calculatedTime = (i == 0) ? minLimit : Math.Max(minLimit, previousTime + rules.MinimumGapSeconds);

                // Verificare limita maxima: t_i <= l_i
                if (calculatedTime > ac.LatestSeconds)
                    return Reject(sequence, schedule, $"Aeronava {ac.Id} depășește limita maximă permisă ({ac.LatestSeconds}s). Calculat: {calculatedTime}s.");
            }

            double delay = Math.Max(0, calculatedTime - ac.EtaSeconds);
            string formattedTime = TimeSpan.FromSeconds(calculatedTime + rules.BaseTimeOffsetSeconds).ToString(@"hh\:mm");
            double delayMinutes = Math.Round(delay / 60.0, 2);

            schedule.Add(new ScheduleSlot(
                ac.Id,
                ac.FlightRules,
                calculatedTime,
                delay,
                formattedTime,
                delayMinutes
            ));

            previousTime = calculatedTime;
        }

        return PlanEvaluator.EvaluateValidSchedule(sequence, schedule);
    }

    private static EvaluationVariant Reject(List<AircraftInput> sequence, List<ScheduleSlot> schedule, string reason) =>
        new(
            SequenceOrder: sequence.Select(a => a.Id).ToList(),
            Schedule: schedule,
            IsValid: false,
            RejectionReason: reason,
            TotalDelaySeconds: 0,
            TotalDelayMinutes: 0,
            MaxDelaySeconds: 0,
            MaxDelayMinutes: 0,
            DelayedAircraftCount: 0
        );
}

public class PlanEvaluator
{
    public static EvaluationVariant EvaluateValidSchedule(List<AircraftInput> sequence, List<ScheduleSlot> schedule)
    {
        double totalDelay = schedule.Sum(s => s.DelaySeconds);
        double maxDelay = schedule.Any() ? schedule.Max(s => s.DelaySeconds) : 0;
        int delayedCount = schedule.Count(s => s.DelaySeconds > 0);

        return new EvaluationVariant(
            SequenceOrder: sequence.Select(a => a.Id).ToList(),
            Schedule: schedule,
            IsValid: true,
            RejectionReason: null,
            TotalDelaySeconds: totalDelay,
            TotalDelayMinutes: Math.Round(totalDelay / 60.0, 2),
            MaxDelaySeconds: maxDelay,
            MaxDelayMinutes: Math.Round(maxDelay / 60.0, 2),
            DelayedAircraftCount: delayedCount
        );
    }

    public static List<EvaluationVariant> RankVariants(List<EvaluationVariant> validVariants)
    {
        return validVariants
            .OrderBy(v => v.TotalDelaySeconds)
            .ThenBy(v => v.MaxDelaySeconds)
            .ThenBy(v => string.Join("-", v.SequenceOrder))
            .ToList();
    }
}
