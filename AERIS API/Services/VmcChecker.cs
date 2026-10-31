using Aeris.PlanningEngine.Models;

namespace Aeris.PlanningEngine.Services;

public sealed class VmcChecker
{
    public const int MinimumVisibilityMeters = 5000;
    public const int MinimumCeilingFeet = 1500;

    public static int? GetCeilingFeet(MetarDecoded metar) => metar.CloudLayers
        .Where(layer => layer.IsCeiling)
        .Select(layer => (int?)layer.BaseFeet)
        .Min();

    public static bool IsVmcValid(MetarDecoded metar) =>
        metar.VisibilityMeters >= MinimumVisibilityMeters &&
        metar.CeilingKnown && (GetCeilingFeet(metar) is not int ceiling || ceiling >= MinimumCeilingFeet);

    public static string GetStatus(MetarDecoded metar) =>
        !metar.CeilingKnown ? "UNKNOWN" :
        !IsVmcValid(metar) ? "IMC" :
        metar.FlightCategory.Equals("MVFR", StringComparison.OrdinalIgnoreCase) ? "MVFR" : "VMC";

    public static int? GetCeilingFeet(MetarData weather) => weather.CeilingFeet;

    public static bool IsVmcValid(MetarData weather) =>
        weather.VisibilityMeters is >= MinimumVisibilityMeters && weather.CeilingKnown &&
        (weather.CeilingFeet is not int ceiling || ceiling >= MinimumCeilingFeet);

    public static string GetStatus(MetarData weather) =>
        weather.VisibilityMeters is null || !weather.CeilingKnown ? "UNKNOWN" :
        !IsVmcValid(weather) ? "IMC" :
        weather.FlightCategory.Equals("MVFR", StringComparison.OrdinalIgnoreCase) ? "MVFR" : "VMC";

    public static VmcStatusResponse ToResponse(MetarData weather)
    {
        var speed = (double)(weather.WindGustKnots ?? weather.WindSpeedKnots ?? 0);
        var direction = (double)(weather.WindDirectionDegrees ?? 0);
        var cross09 = CrosswindCalculator.Calculate(direction, speed, 88.93).CrosswindKnots;
        var cross27 = CrosswindCalculator.Calculate(direction, speed, 268.95).CrosswindKnots;
        return new VmcStatusResponse(GetStatus(weather), IsVmcValid(weather), weather.VisibilityMeters ?? 0,
            weather.CeilingFeet, weather.WindDirectionDegrees ?? 0, weather.WindSpeedKnots ?? 0,
            cross09, cross27, weather.RawMetar ?? "", weather.SourceProvider, weather.IsStale, weather.SourceProvider);
    }

    public static VmcStatus ToStatus(MetarData weather) => new(
        GetStatus(weather), IsVmcValid(weather), weather.VisibilityMeters ?? 0, weather.CeilingFeet,
        weather.SourceProvider, weather.ObservationTimeUtc);

    public static IReadOnlyList<RunwayWindComponent> GetRunwayComponents(MetarData weather) =>
    [
        Component("09", 88.93, weather.WindDirectionDegrees, weather.WindSpeedKnots, weather.WindGustKnots),
        Component("27", 268.95, weather.WindDirectionDegrees, weather.WindSpeedKnots, weather.WindGustKnots)
    ];

    public static (double Runway09Knots, double Runway27Knots) GetCrosswind(MetarDecoded metar)
    {
        var speed = (double)(metar.WindGustKnots ?? metar.WindSpeedKnots);
        var direction = (double)(metar.WindDirectionDegrees ?? 0);
        return (
            CrosswindCalculator.Calculate(direction, speed, 88.93).CrosswindKnots,
            CrosswindCalculator.Calculate(direction, speed, 268.95).CrosswindKnots);
    }

    public static VmcStatusResponse ToResponse(MetarDecoded metar)
    {
        var crosswind = GetCrosswind(metar);
        return new VmcStatusResponse(
            GetStatus(metar), IsVmcValid(metar), metar.VisibilityMeters, GetCeilingFeet(metar),
            metar.WindDirectionDegrees ?? 0, metar.WindSpeedKnots,
            crosswind.Runway09Knots, crosswind.Runway27Knots, metar.RawMetar);
    }

    public static VmcStatus ToStatus(MetarDecoded metar) => new(
        GetStatus(metar), IsVmcValid(metar), metar.VisibilityMeters, GetCeilingFeet(metar),
        "aviationweather.gov", DateTime.UtcNow);

    public static IReadOnlyList<RunwayWindComponent> GetRunwayComponents(MetarDecoded metar) =>
    [
        Component("09", 88.93, metar),
        Component("27", 268.95, metar)
    ];

    private static RunwayWindComponent Component(string runway, double heading, MetarDecoded metar)
    {
        var wind = CrosswindCalculator.Calculate(metar.WindDirectionDegrees ?? 0,
            metar.WindGustKnots ?? metar.WindSpeedKnots, heading);
        return new RunwayWindComponent(runway, heading, wind.CrosswindKnots, wind.HeadwindKnots);
    }

    private static RunwayWindComponent Component(string runway, double heading, int? direction, int? speed, int? gust)
    {
        var wind = CrosswindCalculator.Calculate(direction ?? 0, gust ?? speed ?? 0, heading);
        return new RunwayWindComponent(runway, heading, wind.CrosswindKnots, wind.HeadwindKnots);
    }
}
