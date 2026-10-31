using Microsoft.AspNetCore.Mvc;
using Aeris.PlanningEngine.Services;

namespace AERIS_API.Controllers;

/// <summary>
/// Controller pentru date meteorologice în timp real la Aeroportul Craiova (LRCV).
/// Oferă acces la METAR brut și decodat, destinat frontend-ului și modulului AI.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class WeatherController : ControllerBase
{
    private readonly IMetarService _metarService;

    public WeatherController(IMetarService metarService)
    {
        _metarService = metarService;
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
        var raw = await _metarService.GetRawMetarAsync();
        if (raw is null)
            return StatusCode(503, new { error = "METAR indisponibil momentan. aviationweather.gov nu a răspuns sau LRCV nu are METAR activ." });

        return Ok(new MetarRawResponse(
            Station: "LRCV",
            Metar: raw,
            RetrievedAt: DateTime.UtcNow
        ));
    }

    /// <summary>
    /// Returnează METAR-ul decodat complet pentru LRCV Craiova, cu toate câmpurile
    /// în format human-readable și un prompt AI structurat.
    /// Destinat frontend-ului (afișare condiții meteo) și modulului AI (context pentru LLM).
    /// </summary>
    /// <remarks>
    /// Câmpurile returnate includ: vânt (direcție, viteză, rafale), vizibilitate, nori/plafon,
    /// temperatură, punct de rouă, umiditate, QNH, fenomene meteo, categoria de zbor,
    /// rezumat pentru controller și promptul gata pentru injecție în LLM.
    /// </remarks>
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
}

/// <summary>Răspuns simplu pentru METAR brut.</summary>
public record MetarRawResponse(string Station, string Metar, DateTime RetrievedAt);
