using Microsoft.AspNetCore.Mvc;
using Aeris.PlanningEngine.Models;
using Aeris.PlanningEngine.Services;
using Aeris.LocalAI;

namespace AERIS_API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class CraiovaController : ControllerBase
{
    private readonly IOpenSkyService _openSkyService;
    private readonly IOpenSkyLiveService _openSkyLiveService;
    private readonly ICraiovaAdvisoryEngine _advisoryEngine;
    private readonly IMetarService _metarService;
    private readonly GroundedExplainer _groundedExplainer;

    public CraiovaController(
        IOpenSkyService openSkyService,
        IOpenSkyLiveService openSkyLiveService,
        ICraiovaAdvisoryEngine advisoryEngine,
        IMetarService metarService,
        GroundedExplainer groundedExplainer)
    {
        _openSkyService = openSkyService;
        _openSkyLiveService = openSkyLiveService;
        _advisoryEngine = advisoryEngine;
        _metarService = metarService;
        _groundedExplainer = groundedExplainer;
    }

    /// <summary>
    /// Execută simularea de aterizare pe Aeroportul Craiova (LRCV), colectând date OpenSky și evaluând aeronavele mari (IFR) și mici (Savannah, Wilga, etc.).
    /// În caz de vânt lateral critic, calculează sfaturi de orbită paralelă cu pista sau deviere către Balta Verde / Podari.
    /// </summary>
    /// <param name="windSpeed">Viteza vântului în noduri (implicit 22 kts).</param>
    /// <param name="windDirection">Direcția vântului în grade (implicit 180° - vânt perpendicular pe pista 09/27).</param>
    /// <param name="windGust">Rafale de vânt în noduri (implicit 26 kts).</param>
    /// <param name="forceSimulated">Dacă este true, folosește setul simulat demonstrativ fără a interoga OpenSky Network.</param>
    [HttpGet("simulation")]
    public async Task<IActionResult> RunSimulation(
        [FromQuery] double windSpeed = 22,
        [FromQuery] double windDirection = 180,
        [FromQuery] double windGust = 26,
        [FromQuery] bool forceSimulated = false)
    {
        var weather = new WeatherCondition(
            WindDirectionDegrees: windDirection,
            WindSpeedKnots: windSpeed,
            WindGustKnots: windGust
        );

        var (traffic, sourceDesc) = await _openSkyService.GetCraiovaTrafficAsync(forceSimulated);
        var result = _advisoryEngine.EvaluateSimulation(traffic, weather, sourceDesc);

        return Ok(result);
    }

    /// <summary>
    /// Evaluează un scenariu personalizat pentru Craiova transmis în corpul cererii (vreme custom și listă aeronave).
    /// </summary>
    [HttpPost("evaluate")]
    public IActionResult EvaluateCustomScenario([FromBody] CraiovaCustomEvaluationDto request)
    {
        var weather = request.Weather ?? new WeatherCondition();
        var traffic = request.Aircrafts ?? OpenSkyService.GetRealisticCraiovaTraffic();

        var result = _advisoryEngine.EvaluateSimulation(traffic, weather, "Scenariu personalizat utilizator");
        return Ok(result);
    }

    /// <summary>
    /// Returnează lista aerodromurilor alternative din jurul Craiovei (Balta Verde, Podari) și calculează compatibilitatea lor cu vântul specificat.
    /// </summary>
    [HttpGet("alternates")]
    public IActionResult GetAlternates(
        [FromQuery] double windSpeed = 20,
        [FromQuery] double windDirection = 180,
        [FromQuery] double cruiseSpeedKnots = 70)
    {
        var weather = new WeatherCondition(WindDirectionDegrees: windDirection, WindSpeedKnots: windSpeed);
        var alternates = _advisoryEngine.GetAlternateAerodromes(weather, cruiseSpeedKnots);
        return Ok(alternates);
    }

    /// <summary>
    /// Colectează traficul aerian în timp real din spațiul aerian Craiova prin OpenSky Network.
    /// Utilizat de motorul de simulare și advisory engine (legacy support păstrat).
    /// </summary>
    [HttpGet("live-traffic")]
    public async Task<IActionResult> GetLiveTraffic([FromQuery] bool forceSimulated = false)
    {
        var (traffic, source) = await _openSkyService.GetCraiovaTrafficAsync(forceSimulated);
        return Ok(new { source, count = traffic.Count, traffic });
    }

    /// <summary>
    /// Returnează pozițiile în timp real (lat/lon/altitudine/track/viteză) ale tuturor
    /// aeronavelor detectate de OpenSky Network în sectorul Craiova.
    /// Destinat frontend-ului (afișare pe hartă) și modulului AI.
    /// Complet independent de motorul de simulare – nu afectează funcționalitatea existentă.
    /// </summary>
    /// <remarks>
    /// Câmpurile cheie per aeronavă:
    /// - icao24, callsign, originCountry
    /// - latitude, longitude, baroAltitudeMeters, baroAltitudeFeet, flightLevelApprox
    /// - velocityKnots, trueTrackDegrees, verticalRateMs, verticalTrend
    /// - onGround, squawk, distanceFromLrcvKm, bearingFromLrcvDegrees
    /// 
    /// Nota: OpenSky Network poate fi indisponibil sau rate-limited.
    /// În acest caz răspunsul conține source cu explicația și flights=[].
    /// </remarks>
    [HttpGet("live-positions")]
    [ProducesResponseType(typeof(object), 200)]
    public async Task<IActionResult> GetLivePositions()
    {
        var result = await _openSkyLiveService.GetLivePositionsAsync();
        return Ok(result);
    }

    /// <summary>
    /// Explică în română întrebarea ATC folosind un snapshot nou al simulării și METAR-ul decodat.
    /// Răspunsul este selectat doar dintre enunțuri aprobate de backend; nu reprezintă autorizare operațională.
    /// </summary>
    [HttpPost("explain")]
    [ProducesResponseType(typeof(Explanation), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> Explain([FromBody] CraiovaExplainRequest request, CancellationToken cancellationToken)
    {
        var metar = await _metarService.GetDecodedMetarAsync();
        if (metar is null)
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                new { error = "METAR LRCV indisponibil; explicația nu poate fi generată fără context meteo curent." });

        var weather = new WeatherCondition(
            WindDirectionDegrees: metar.WindDirectionDegrees ?? 0,
            WindSpeedKnots: metar.WindSpeedKnots,
            WindGustKnots: metar.WindGustKnots ?? metar.WindSpeedKnots,
            VisibilityMeters: metar.VisibilityMeters);
        var (traffic, source) = await _openSkyService.GetCraiovaTrafficAsync(forceSimulatedTraffic: false);
        var simulation = _advisoryEngine.EvaluateSimulation(traffic, weather, source);
        var revision = checked((int)DateTimeOffset.UtcNow.ToUnixTimeSeconds());
        var statements = BuildApprovedStatements(simulation, metar, revision);
        var report = await _groundedExplainer.ExplainAsync(
            new ExplanationRequest(request.Question, revision, statements), cancellationToken);
        return Ok(report);
    }

    private static ApprovedStatement[] BuildApprovedStatements(
        CraiovaSimulationResult simulation, Aeris.PlanningEngine.Models.MetarDecoded metar, int revision)
    {
        var source = $"SIM-{revision}";
        var weatherSource = string.IsNullOrWhiteSpace(metar.RawMetar) ? $"METAR-{revision}" : metar.RawMetar;
        var statements = new List<ApprovedStatement>
        {
            new("decision", $"Snapshot simulare LRCV: pista activă {simulation.ActiveRunway}; {simulation.Stats.TotalInbounds} aeronave evaluate, {simulation.Stats.ClearedToLandCount} cu apropiere recomandată, {simulation.Stats.HoldingInOrbitCount} în așteptare și {simulation.Stats.DivertAdvisedCount} cu deviere recomandată.", source, Required: true),
            new("weather", Clip($"METAR LRCV: {metar.ControllerSummary} Categorie: {metar.FlightCategory}.", 800), weatherSource),
            new("limits", "Acesta este un rezultat de simulare și suport decizional. Nu este o autorizare ATC și nu înlocuiește procedurile, verificările sau judecata controlorului.", $"RULES-{revision}", Required: true)
        };

        foreach (var advisory in simulation.Advisories.Take(27))
        {
            var id = "flight_" + new string(advisory.AircraftId.Where(char.IsLetterOrDigit).Take(48).ToArray());
            if (id == "flight_") id += statements.Count;
            statements.Add(new ApprovedStatement(id,
                Clip($"{advisory.Callsign} ({advisory.ModelName}): stare {advisory.AdvisoryStatus}, pista {advisory.AssignedRunway}, vânt lateral {advisory.CurrentCrosswindKnots:0.#} kt (limită {advisory.MaxCrosswindLimitKnots:0.#} kt). {advisory.AdvisoryReason}", 800), source));
        }
        return statements.ToArray();
    }

    private static string Clip(string value, int maxLength) =>
        value.Length <= maxLength ? value : value[..(maxLength - 1)] + "…";
}

public sealed record CraiovaExplainRequest(
    [param: System.ComponentModel.DataAnnotations.Required]
    [param: System.ComponentModel.DataAnnotations.StringLength(1200, MinimumLength = 1)]
    string Question);

public record CraiovaCustomEvaluationDto(
    WeatherCondition? Weather,
    List<CraiovaAircraft>? Aircrafts
);
