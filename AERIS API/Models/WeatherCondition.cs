namespace Aeris.PlanningEngine.Models;

public record WeatherCondition(
    double WindDirectionDegrees = 180, // Direcția vântului (ex: 180° = vânt din sud, vânt lateral pe pista 09/27 din Craiova)
    double WindSpeedKnots = 20,        // Viteza de bază a vântului (noduri)
    double WindGustKnots = 26,         // Rafale (noduri)
    double VisibilityMeters = 9999     // Vizibilitate
);

public record RunwayInfo(
    string Identifier,       // ex: "09" sau "27"
    double HeadingDegrees,   // ex: 92° sau 272°
    double LengthMeters,     // ex: 2500m
    string Surface = "Asphalt"
);
