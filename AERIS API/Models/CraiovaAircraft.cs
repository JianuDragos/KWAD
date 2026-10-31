using Aeris.PlanningEngine.Models.TrajectorySeparation;

namespace Aeris.PlanningEngine.Models;

public record CraiovaAircraft(
    string Id,
    string Callsign,
    string ModelName,
    AircraftCategory Category,
    FlightRules FlightRules,
    bool HasInstrumentAvionics,     // true dacă are IFR/avionice avansate, false dacă e pur VFR/vizual (Savannah, Wilga simplu)
    double MaxCrosswindKnots,       // Limita de vânt lateral a aeronavei (noduri)
    double EtaSeconds,              // Timp estimat de sosire de la T0 (secunde)
    double EarliestSeconds,
    double LatestSeconds,
    double? FrozenTimeSeconds = null,
    double SpeedKnots = 100,        // Viteza de croazieră / apropiere
    double RemainingFuelMinutes = 90
);

public record AlternateAerodrome(
    string Name,
    string Code,
    double DistanceKm,
    double BearingDegrees,
    double RunwayHeadingDegrees,
    string BestRunway,
    double CalculatedCrosswindKnots,
    double CalculatedHeadwindKnots,
    double EstimatedFlightMinutes,
    string SuitabilityReason,
    double SafetyScore = 0,
    double RunwayLengthMeters = 600,
    string SurfaceType = "Iarbă",
    double LandingDistanceRequiredMeters = 150,
    double LandingSafetyMarginMeters = 450,
    double WindCorrectedHeadingDegrees = 0,
    double GroundSpeedToAlternateKnots = 70,
    double RemainingFuelAtTouchdownMinutes = 60,
    bool IsRecommendedBestSpot = false
);

public record OrbitPatternAdvice(
    string PatternName,             // ex: "Orbită paralelă cu axul pistei 08/26 (Zona Cârcea - Pielești)"
    double RecommendedAltitudeFeet, // ex: 1500 ft QNH
    double HoldingDurationMinutes,  // Timp estimat de așteptare în orbită
    double RemainingFuelMarginMinutes,
    string SafetyInstructions,
    HoldingRacetrackConfig? Racetrack = null
);

public record AircraftAdvisory(
    string AircraftId,
    string Callsign,
    string ModelName,
    AircraftCategory Category,
    FlightRules FlightRules,
    bool HasInstrumentAvionics,
    string AssignedRunway,                   // Pista de aterizare alocată (ex: "08" sau "26", acceptă și aliasuri)
    double CurrentCrosswindKnots,
    double CurrentHeadwindKnots,
    double MaxCrosswindLimitKnots,
    bool IsOppositeDirectionLanding,         // true dacă execută aterizare pe sensul invers (reciprocal runway) pentru a avea vânt de față
    string? OppositeDirectionAdvice,         // Detalii manevră sens invers (deconflictualizare și transformare vânt de spate în vânt de față)
    AdvisoryStatus AdvisoryStatus,
    string AdvisoryReason,
    OrbitPatternAdvice? OrbitAdvice = null,
    List<AlternateAerodrome>? RecommendedAlternates = null,
    ScheduleSlot? AssignedLandingSlot = null,
    TakeoffToLandingAnalysis? TakeoffToLanding = null,
    TwoStepsAheadPrediction? TwoStepsAhead = null,
    VfrRedirectionAnalysis? VfrRedirection = null
);
