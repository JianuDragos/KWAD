using Aeris.PlanningEngine.Models;

namespace Aeris.PlanningEngine.Services;

/// <summary>
/// Serviciu extins pentru OpenSky: adaugă obținerea pozițiilor live (lat/lon/alt/track)
/// fără a modifica metodele existente utilizate de advisory engine.
/// </summary>
public interface IOpenSkyLiveService
{
    /// <summary>
    /// Returnează pozițiile în timp real ale tuturor aeronavelor din bounding box-ul Craiova.
    /// Aceste date sunt brute din OpenSky și nu intră în motorul de simulare.
    /// </summary>
    Task<LivePositionsResponse> GetLivePositionsAsync();
}
