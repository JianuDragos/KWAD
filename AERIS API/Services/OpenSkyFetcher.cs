using Aeris.PlanningEngine.Models;

namespace Aeris.PlanningEngine.Services;

/// <summary>Named OpenSky feed implementation for airport-scoped state vectors (shared singleton cache + fallback).</summary>
public sealed class OpenSkyFetcher : IOpenSkyLiveService
{
    private readonly OpenSkyLiveService _inner;

    public OpenSkyFetcher(HttpClient httpClient, ILogger<OpenSkyLiveService> logger, IConfiguration configuration) =>
        _inner = new OpenSkyLiveService(httpClient, logger, configuration);

    public Task<LivePositionsResponse> GetLivePositionsAsync() => _inner.GetLivePositionsAsync();
}
