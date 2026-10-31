using Aeris.PlanningEngine.Models;

namespace Aeris.PlanningEngine.Services;

public record CorridorWeatherPoint(
    double Latitude,
    double Longitude,
    DateTime ObservationTimeUtc,
    int? WindDirectionDegrees,
    int? WindSpeedKnots,
    int? WindGustKnots,
    int? VisibilityMeters,
    int? CloudCoverPercent,
    int? WeatherCode,
    double? TemperatureCelsius,
    bool FromCache
);

public record CorridorWeatherResponse(
    DateTime RetrievedAtUtc,
    string SourceProvider,
    int TotalPoints,
    int CachedPointsCount,
    int FetchedPointsCount,
    IReadOnlyList<CorridorWeatherPoint> Points
);

public interface IResilientWeatherService
{
    Task<MetarData> GetAirportWeatherAsync(string icaoCode, double lat, double lon);
    Task<CorridorWeatherResponse> GetCorridorWeatherAsync(IReadOnlyList<(double Lat, double Lon)> waypoints, CancellationToken cancellationToken = default);
}
