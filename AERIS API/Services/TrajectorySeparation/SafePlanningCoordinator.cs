using Aeris.PlanningEngine.Models;
using Aeris.PlanningEngine.Models.TrajectorySeparation;

namespace Aeris.PlanningEngine.Services.TrajectorySeparation;

/// <summary>
/// Răspunsul combinat de planificare validată prin Trajectory &amp; Separation Engine.
/// </summary>
public record SafePlanningResponse(
    PlanningResponse PlanningResponse,
    EvaluationVariant? SelectedVariant,
    SafetyAssessmentResult SafetyAssessment,
    int ReplanningAttempts,
    bool ReplanningTriggered
);

/// <summary>
/// Coordonator între PlanningEngine și Trajectory &amp; Separation Engine:
/// Validează programul propus, iar dacă este UNSAFE, solicită replanificarea automată cu constrângeri adaptate.
/// </summary>
public interface ISafePlanningCoordinator
{
    SafePlanningResponse PlanAndValidate(
        List<CraiovaAircraft> aircrafts,
        ScenarioRules rules,
        string runwayId = "09",
        SeparationSettings? separationSettings = null,
        int maxReplanningAttempts = 5);
}

public class SafePlanningCoordinator : ISafePlanningCoordinator
{
    private readonly IPlanningService _planningService;
    private readonly ITrajectorySeparationEngine _separationEngine;

    public SafePlanningCoordinator(IPlanningService planningService, ITrajectorySeparationEngine separationEngine)
    {
        _planningService = planningService;
        _separationEngine = separationEngine;
    }

    public SafePlanningResponse PlanAndValidate(
        List<CraiovaAircraft> aircrafts,
        ScenarioRules rules,
        string runwayId = "09",
        SeparationSettings? separationSettings = null,
        int maxReplanningAttempts = 5)
    {
        var settings = separationSettings ?? new SeparationSettings();
        var currentRules = rules;
        int attempts = 0;
        bool replanned = false;

        PlanningResponse planningRes = null!;
        EvaluationVariant? chosenVariant = null;
        SafetyAssessmentResult assessment = null!;

        // Pregătim intrările pentru PlanningEngine
        var inputs = aircrafts.Select(a => new AircraftInput(
            Id: a.Id,
            FlightRules: a.FlightRules,
            EtaSeconds: a.EtaSeconds,
            EarliestSeconds: a.EarliestSeconds,
            LatestSeconds: a.LatestSeconds,
            FrozenTimeSeconds: a.FrozenTimeSeconds
        )).ToList();

        while (attempts < maxReplanningAttempts)
        {
            attempts++;
            planningRes = _planningService.EvaluateScenario(inputs, currentRules);

            chosenVariant = planningRes.ValidVariants.FirstOrDefault();
            if (chosenVariant == null || !chosenVariant.IsValid)
            {
                // Nicio variantă validă găsită de PlanningEngine
                assessment = new SafetyAssessmentResult(
                    Status: SafetyStatus.Unsafe,
                    IsSafe: false,
                    Summary: "PlanningEngine nu a putut găsi nicio secvență viabilă în limitele de timp ale aeronavelor.",
                    Conflicts: new List<SeparationConflict>(),
                    TotalEvaluatedPairs: 0,
                    TotalTrajectoryPoints: 0,
                    EvaluatedAtUtc: DateTime.UtcNow,
                    ReplanningSuggestions: new List<string> { "Extindeți ferestrele de timp (LatestSeconds) pentru aeronavele întârziate." }
                );
                break;
            }

            // Validare traiectorii 3D, pistă și siaj
            assessment = _separationEngine.ValidateSchedule(aircrafts, chosenVariant.Schedule, runwayId, settings);

            if (assessment.IsSafe)
            {
                // Găsit plan sigur!
                break;
            }

            // Planul este UNSAFE: analizăm conflictele pentru replanificare
            replanned = true;

            // Dacă avem conflict de ocupare a pistei sau de siaj, creștem MinimumGapSeconds
            double maxRequiredGap = currentRules.MinimumGapSeconds;
            foreach (var conflict in assessment.Conflicts)
            {
                if (conflict.Type == SeparationConflictType.RunwayOccupancyViolation ||
                    conflict.Type == SeparationConflictType.WakeTurbulenceViolation)
                {
                    // De exemplu, Light după Medium necesită 180s
                    maxRequiredGap = Math.Max(maxRequiredGap, 180.0);
                }
                else if (conflict.Type == SeparationConflictType.LossOfSeparation_IFR_IFR ||
                         conflict.Type == SeparationConflictType.LossOfSeparation_IFR_VFR)
                {
                    maxRequiredGap = Math.Max(maxRequiredGap, currentRules.MinimumGapSeconds + 60.0);
                }
            }

            if (maxRequiredGap > currentRules.MinimumGapSeconds)
            {
                currentRules = currentRules with { MinimumGapSeconds = maxRequiredGap };
            }
            else
            {
                // Nicio ajustare suplimentară posibilă pe gap
                break;
            }
        }

        return new SafePlanningResponse(
            PlanningResponse: planningRes,
            SelectedVariant: chosenVariant,
            SafetyAssessment: assessment,
            ReplanningAttempts: attempts,
            ReplanningTriggered: replanned
        );
    }
}
