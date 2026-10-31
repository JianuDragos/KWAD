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
    string SuitabilityReason
);

public record OrbitPatternAdvice(
    string PatternName,             // ex: "Orbită paralelă cu axul pistei 09/27 (Zona Cârcea - Pielești)"
    double RecommendedAltitudeFeet, // ex: 1500 ft QNH
    double HoldingDurationMinutes,  // Timp estimat de așteptare în orbită
    double RemainingFuelMarginMinutes,
    string SafetyInstructions
);

public record AircraftAdvisory(
    string AircraftId,
    string Callsign,
    string ModelName,
    AircraftCategory Category,
    FlightRules FlightRules,
    bool HasInstrumentAvionics,
    string AssignedRunway,                   // Pista de aterizare alocată (ex: "09" sau "27")
    double CurrentCrosswindKnots,
    double CurrentHeadwindKnots,
    double MaxCrosswindLimitKnots,
    bool IsOppositeDirectionLanding,         // true dacă execută aterizare pe sensul invers (reciprocal runway) pentru a avea vânt de față
    string? OppositeDirectionAdvice,         // Detalii manevră sens invers (deconflictualizare și transformare vânt de spate în vânt de față)
    AdvisoryStatus AdvisoryStatus,
    string AdvisoryReason,
    OrbitPatternAdvice? OrbitAdvice = null,
    List<AlternateAerodrome>? RecommendedAlternates = null,
    ScheduleSlot? AssignedLandingSlot = null
);
