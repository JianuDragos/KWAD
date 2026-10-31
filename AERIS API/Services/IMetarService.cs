using Aeris.PlanningEngine.Models;

namespace Aeris.PlanningEngine.Services;

/// <summary>
/// Serviciu pentru obținerea și decodarea datelor METAR de la aviationweather.gov.
/// </summary>
public interface IMetarService
{
    /// <summary>
    /// Returnează METAR-ul raw (string original) pentru LRCV (Craiova).
    /// </summary>
    Task<string?> GetRawMetarAsync();

    /// <summary>
    /// Returnează METAR-ul decodat complet: vreme human-readable + prompt AI.
    /// </summary>
    Task<MetarDecoded?> GetDecodedMetarAsync();
}
