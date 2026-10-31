using Aeris.PlanningEngine.Models;

namespace Aeris.PlanningEngine.Services;

/// <summary>Compatibility adapter for existing controllers; fetches through the shared resilient provider chain.</summary>
public class MetarService : IMetarService
{
    private const double LrcvLatitude = 44.318056;
    private const double LrcvLongitude = 23.888611;
    private readonly IResilientWeatherService _weather;

    public MetarService(IResilientWeatherService weather) => _weather = weather;

    public async Task<string?> GetRawMetarAsync()
    {
        var weather = await _weather.GetAirportWeatherAsync("LRCV", LrcvLatitude, LrcvLongitude);
        return weather.RawMetar;
    }

    public async Task<MetarDecoded?> GetDecodedMetarAsync()
    {
        var weather = await _weather.GetAirportWeatherAsync("LRCV", LrcvLatitude, LrcvLongitude);
        if (weather.SourceProvider == "Unavailable") return null;

        var raw = new MetarRaw(
            weather.RawMetar ?? $"{weather.SourceProvider} weather snapshot (not a METAR)",
            weather.IcaoCode,
            weather.ObservationTimeUtc.ToString("O"),
            weather.TemperatureCelsius,
            weather.DewPointCelsius,
            weather.QnhHpa,
            weather.QnhHpa is int qnh ? $"Q{qnh}" : null,
            weather.WindSpeedKnots,
            weather.WindDirectionDegrees,
            weather.WindGustKnots,
            weather.VisibilityMeters / 1609.34,
            null,
            null,
            weather.FlightCategory,
            weather.CeilingKnown && weather.CeilingFeet is int ceiling
                ? [new CloudLayerRaw(weather.CeilingCover ?? "BKN", ceiling / 100)]
                : []);

        var decoded = MetarParser.Decode(raw);
        return decoded is null ? null : decoded with
        {
            RawMetar = weather.RawMetar ?? $"{weather.SourceProvider} weather snapshot (not a METAR)",
            IsStale = weather.IsStale,
            SourceProvider = weather.SourceProvider,
            CeilingKnown = weather.CeilingKnown,
            FlightCategory = weather.FlightCategory,
            VisibilityMeters = weather.VisibilityMeters ?? 0,
            VisibilityDescription = weather.VisibilityMeters is int visibility
                ? $"{visibility} m ({visibility / 1000.0:0.#} km)"
                : "unknown",
            SkyConditionDescription = weather.CeilingKnown
                ? decoded.SkyConditionDescription
                : $"Acoperire cu nori {weather.CloudCoverPercent?.ToString() ?? "necunoscută"}%; înălțimea plafonului nu e cunoscută, deci condițiile VMC nu pot fi confirmate.",
            ControllerSummary = weather.CeilingKnown
                ? decoded.ControllerSummary
                : $"{weather.SourceProvider}; cloud ceiling unavailable, VMC cannot be confirmed. {decoded.ControllerSummary}",
            AiContextPrompt = $"Source: {weather.SourceProvider}. Stale: {weather.IsStale}. Ceiling verified: {weather.CeilingKnown}. {decoded.AiContextPrompt}"
        };
    }
}
