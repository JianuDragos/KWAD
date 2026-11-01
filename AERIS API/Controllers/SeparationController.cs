using Microsoft.AspNetCore.Mvc;
using Aeris.PlanningEngine.Models;
using Aeris.PlanningEngine.Models.TrajectorySeparation;
using Aeris.PlanningEngine.Services.TrajectorySeparation;

namespace AERIS_API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class SeparationController : ControllerBase
{
    private readonly ITrajectorySeparationEngine _separationEngine;
    private readonly ISafePlanningCoordinator _safePlanningCoordinator;
    private readonly TrajectoryPredictor _predictor;

    public SeparationController(
        ITrajectorySeparationEngine separationEngine,
        ISafePlanningCoordinator safePlanningCoordinator,
        TrajectoryPredictor predictor)
    {
        _separationEngine = separationEngine;
        _safePlanningCoordinator = safePlanningCoordinator;
        _predictor = predictor;
    }

    /// <summary>
    /// Returnează parametrii și pragurile implicite de separare (EASA Clasa C, ICAO siaj, mod strict).
    /// </summary>
    [HttpGet("settings")]
    public ActionResult<SeparationSettings> GetDefaultSettings()
    {
        return Ok(new SeparationSettings());
    }

    /// <summary>
    /// Validează separarea 3D între stările instantanee ale aeronavelor furnizate (cu suport mod strict).
    /// </summary>
    [HttpPost("validate-states")]
    public ActionResult<SafetyAssessmentResult> ValidateDirectStates(
        [FromBody] List<Aircraft3DState> states,
        [FromQuery] bool strictMode = false)
    {
        var settings = new SeparationSettings(StrictMode: strictMode);
        var result = _separationEngine.ValidateDirectStates(states, settings);
        return Ok(result);
    }

    /// <summary>
    /// Evaluează o listă de traiectorii complete pentru conflicte de apropiere, holding, ratare, siaj și ocupare pistă.
    /// </summary>
    [HttpPost("validate-trajectories")]
    public ActionResult<SafetyAssessmentResult> ValidateTrajectories(
        [FromBody] ValidateTrajectoriesRequest request)
    {
        var settings = request.Settings ?? new SeparationSettings();
        var result = _separationEngine.ValidateSeparation(request.Trajectories, settings);
        return Ok(result);
    }

    /// <summary>
    /// Generează punctele de traiectorie pentru un circuit de așteptare hipodrom (ICAO Racetrack Holding Pattern).
    /// </summary>
    [HttpPost("racetrack")]
    public ActionResult<List<TrajectoryPoint>> GenerateRacetrack([FromBody] HoldingRacetrackConfig config)
    {
        var points = RacetrackGenerator.Generate(config);
        return Ok(points);
    }

    /// <summary>
    /// Evaluează un scenariu de planificare, validează traiectoriile 3D și replanifică automat dacă secvența inițială este nesigură.
    /// </summary>
    [HttpPost("evaluate-safe-plan")]
    public ActionResult<SafePlanningResponse> EvaluateSafePlan([FromBody] SafePlanningRequest request)
    {
        var rules = request.Rules ?? new ScenarioRules(MinimumGapSeconds: 120, AllowVfr: true, BaseTimeOffsetSeconds: 50400);
        var result = _safePlanningCoordinator.PlanAndValidate(
            request.Aircrafts,
            rules,
            request.RunwayId ?? "09",
            request.Settings,
            request.MaxReplanningAttempts ?? 3
        );

        return Ok(result);
    }
}

public record ValidateTrajectoriesRequest(
    List<AircraftTrajectory> Trajectories,
    SeparationSettings? Settings = null
);

public record SafePlanningRequest(
    List<CraiovaAircraft> Aircrafts,
    ScenarioRules? Rules = null,
    string? RunwayId = "09",
    SeparationSettings? Settings = null,
    int? MaxReplanningAttempts = 3
);
