namespace Aeris.PlanningEngine.Services;

/// <summary>Named aviation weather integration; inherits the shared AviationWeather.gov METAR client.</summary>
public sealed class AviationWeatherService : MetarService
{
    public AviationWeatherService(IResilientWeatherService weather) : base(weather) { }
}
