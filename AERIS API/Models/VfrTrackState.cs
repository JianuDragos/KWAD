namespace Aeris.PlanningEngine.Models;

public enum VfrTrackSource { OpenSky, OpenAipCommunity, OgnAprs, Sbs1 }

public sealed record VfrTrackState(
    string FlightId,
    string Callsign,
    double Latitude,
    double Longitude,
    double? AltitudeMeters,
    double? GroundSpeedKnots,
    double? TrackDegrees,
    string? Squawk,
    FlightRules FlightRules,
    VfrTrackSource Source,
    DateTime LastContactUtc,
    string? CorrelatedFlightPlanId = null,
    string? CorrelatedCallsign = null);

public sealed record VfrFlightPlan(string FlightPlanId, string Callsign, FlightRules FlightRules, DateTime ExpiresUtc);

public sealed record VmcStatus(
    string Status,
    bool IsVmcValid,
    int VisibilityMeters,
    int? CeilingFeet,
    string Source,
    DateTime ObservationTimeUtc);

public sealed record RunwayWindComponent(
    string Runway,
    double HeadingDegrees,
    double CrosswindKnots,
    double HeadwindKnots);
