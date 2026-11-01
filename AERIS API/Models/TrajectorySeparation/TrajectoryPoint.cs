namespace Aeris.PlanningEngine.Models.TrajectorySeparation;

/// <summary>
/// Punct în spațiu și timp pe traiectoria prezisă a unei aeronave.
/// </summary>
public record TrajectoryPoint(
    double TimeSeconds,
    double Latitude,
    double Longitude,
    double AltitudeFeet,
    double SpeedKnots,
    double HeadingDegrees,
    FlightPhase Phase = FlightPhase.Approach,
    string? WaypointId = null
);
