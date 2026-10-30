namespace Aeris.PlanningEngine.Models;

public record EvaluationRequestDto(
    List<AircraftInput> Aircrafts,
    ScenarioRules Rules
);
