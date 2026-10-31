using Microsoft.AspNetCore.Mvc;
using Aeris.PlanningEngine.Models;
using Aeris.PlanningEngine.Services;

namespace AERIS_API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class CraiovaController : ControllerBase
{
    private readonly IOpenSkyService _openSkyService;
    private readonly ICraiovaAdvisoryEngine _advisoryEngine;

    public CraiovaController(IOpenSkyService openSkyService, ICraiovaAdvisoryEngine advisoryEngine)
    {
        _openSkyService = openSkyService;
        _advisoryEngine = advisoryEngine;
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
    /// </summary>
    [HttpGet("live-traffic")]
    public async Task<IActionResult> GetLiveTraffic([FromQuery] bool forceSimulated = false)
    {
        var (traffic, source) = await _openSkyService.GetCraiovaTrafficAsync(forceSimulated);
        return Ok(new { source, count = traffic.Count, traffic });
    }
}

public record CraiovaCustomEvaluationDto(
    WeatherCondition? Weather,
    List<CraiovaAircraft>? Aircrafts
);
