namespace Aeris.PlanningEngine.Models;

public record PlanningResponse(
    List<EvaluationVariant> ValidVariants,
    List<EvaluationVariant> RejectedVariants,
    int TotalEvaluatedVariants
);
