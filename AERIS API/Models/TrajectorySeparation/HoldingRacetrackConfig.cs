namespace Aeris.PlanningEngine.Models.TrajectorySeparation;

/// <summary>
/// Configurația unei proceduri standard de așteptare de tip hipodrom (Racetrack Holding Pattern).
/// </summary>
public record HoldingRacetrackConfig(
    string FixId,
    double FixLatitude,
    double FixLongitude,
    double InboundHeadingDegrees,
    string TurnDirection = "Right", // "Right" (standard) sau "Left"
    double LegDurationSeconds = 60.0, // standard 1 minut (60s) sub 14,000 ft
    double SpeedKnots = 180.0, // viteza indicată / calculată în orbită
    double AltitudeFeet = 4000.0,
    double EntryTimeSeconds = 0.0,
    double DurationSeconds = 240.0 // Durata totală menținută în orbită (ex: 4 minute = 1 tur complet)
);
