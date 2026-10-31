using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Aeris.PlanningEngine.Services;

namespace AERIS_API.Controllers;

/// <summary>
/// Controller pentru date meteorologice în timp real la Aeroportul Craiova (LRCV) și pe coridoarele de rută.
/// Oferă acces la METAR brut și decodat, plus interogare grupată (bulk cached) pe rută pentru evitarea rate-limit-ului.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class WeatherController : ControllerBase
{
    private readonly IMetarService _metarService;
    private readonly IResilientWeatherService _weatherService;

    public WeatherController(IMetarService metarService, IResilientWeatherService weatherService)
    {
        _metarService = metarService;
        _weatherService = weatherService;
    }

    /// <summary>
    /// Returnează cel mai recent METAR raw (string nemodificat) pentru LRCV Craiova.
    /// Sursa: aviationweather.gov API (actualizat la ~30 min).
    /// </summary>
    /// <remarks>
    /// Exemplu răspuns:
    /// <code>
    /// {
    ///   "station": "LRCV",
    ///   "metar": "LRCV 310730Z 24009KT 7000 BKN003 OVC007 11/11 Q1020",
    ///   "retrievedAt": "2026-10-31T07:35:00Z"
    /// }
    /// </code>
    /// </remarks>
    [HttpGet("metar")]
    [ProducesResponseType(typeof(MetarRawResponse), 200)]
    [ProducesResponseType(503)]
    public async Task<IActionResult> GetRawMetar()
    {
        var weather = await _weatherService.GetAirportWeatherAsync("LRCV", 44.318056, 23.888611);
        if (weather.RawMetar is null)
            return StatusCode(503, new { error = "METAR indisponibil momentan. aviationweather.gov nu a răspuns sau LRCV nu are METAR activ." });

        return Ok(new MetarRawResponse(
            Station: "LRCV",
            Metar: weather.RawMetar,
            RetrievedAt: DateTime.UtcNow,
            ObservationTimeUtc: weather.ObservationTimeUtc,
            SourceProvider: weather.SourceProvider,
            IsStale: weather.IsStale
        ));
    }

    /// <summary>
    /// Returnează METAR-ul decodat complet pentru LRCV Craiova, cu toate câmpurile
    /// în format human-readable și un prompt AI structurat.
    /// Destinat frontend-ului (afișare condiții meteo) și modulului AI (context pentru LLM).
    /// </summary>
    [HttpGet("metar/decoded")]
    [ProducesResponseType(typeof(object), 200)]
    [ProducesResponseType(503)]
    public async Task<IActionResult> GetDecodedMetar()
    {
        var decoded = await _metarService.GetDecodedMetarAsync();
        if (decoded is null)
            return StatusCode(503, new { error = "METAR indisponibil sau nu a putut fi decodat. Verificați conectivitatea la aviationweather.gov." });

        return Ok(decoded);
    }

    /// <summary>
    /// Returnează starea meteo pe un coridor de zbor (ex: "51.87,-0.37;48.11,16.57;44.32,23.89")
    /// folosind un singur apel bulk Open-Meteo și cache în RAM pe celule de 0.25° timp de 20 minute.
    /// </summary>
    [HttpGet("corridor")]
    [ProducesResponseType(typeof(CorridorWeatherResponse), 200)]
    public async Task<IActionResult> GetCorridorWeather(
        [FromQuery] string points = "44.3181,23.8886",
        CancellationToken cancellationToken = default)
    {
        var parsed = new List<(double Lat, double Lon)>();
        foreach (var pair in (points ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var coords = pair.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (coords.Length == 2 &&
                double.TryParse(coords[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var lat) &&
                double.TryParse(coords[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var lon))
            {
                parsed.Add((lat, lon));
            }
        }

        var response = await _weatherService.GetCorridorWeatherAsync(parsed, cancellationToken);
        return Ok(response);
    }
}

/// <summary>Răspuns simplu pentru METAR brut.</summary>
public record MetarRawResponse(string Station, string Metar, DateTime RetrievedAt, DateTime ObservationTimeUtc, string SourceProvider, bool IsStale);
