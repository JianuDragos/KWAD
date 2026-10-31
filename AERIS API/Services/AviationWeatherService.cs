namespace Aeris.PlanningEngine.Services;

/// <summary>Named aviation weather integration; inherits the shared AviationWeather.gov METAR client.</summary>
public sealed class AviationWeatherService : MetarService
{
    public AviationWeatherService(HttpClient httpClient, ILogger<MetarService> logger, MetarFetchCache cache) : base(httpClient, logger, cache) { }
}
