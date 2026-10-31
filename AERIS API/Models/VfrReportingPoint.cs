namespace Aeris.PlanningEngine.Models;

public sealed record VfrReportingPoint(string Code, double Lat, double Long, double RadiusMeters, string? Name = null, string Source = "local");

public sealed record VfrPointEnteredEventArgs(string FlightId, string PointCode, DateTime EnteredAtUtc);

public sealed record VmcStatusResponse(
    string Status,
    bool IsVmcValid,
    int VisibilityMeters,
    int? CeilingFeet,
    int WindDirectionDegrees,
    int WindSpeedKnots,
    double CrosswindRunway09Knots,
    double CrosswindRunway27Knots,
    string RawMetar,
    string Source = "aviationweather.gov",
    bool IsStale = false,
    string SourceProvider = "NOAA AviationWeather.gov");

public sealed record VfrTrackingState(
    string FlightId,
    string Callsign,
    string PointCode,
    double DistanceToPointMeters,
    double EtaViaPointMinutes,
    bool IsVmcValid,
    string Status);
