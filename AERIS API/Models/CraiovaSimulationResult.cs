using Aeris.PlanningEngine.Models.TrajectorySeparation;

namespace Aeris.PlanningEngine.Models;

public record CraiovaAirportInfo(
    string Icao = "LRCV",
    string Iata = "CRA",
    string Name = "Aeroportul Internațional Craiova",
    double Latitude = 44.3181,
    double Longitude = 23.8886,
    double ElevationFeet = 626,
    string Runways = "08/26 (2500m x 45m, Asfalt)"
);

public record CraiovaSimulationResult(
    CraiovaAirportInfo Airport,
    WeatherCondition Weather,
    string ActiveRunway,
    double ActiveRunwayCrosswindKnots,
    double ActiveRunwayHeadwindKnots,
    bool IsCrosswindCriticalForLightAircraft,
    List<AircraftAdvisory> Advisories,
    PlanningResponse? ClearedLandingSequences,
    SimulationTrafficStats Stats,
    string DataSource,
    DateTime GeneratedAtUtc,
    SafetyAssessmentResult? SafetyAssessment = null
);

public record SimulationTrafficStats(
    int TotalInbounds,
    int CommercialAirlinersCount,
    int LightAircraftCount,
    int ClearedToLandCount,
    int HoldingInOrbitCount,
    int DivertAdvisedCount
);
