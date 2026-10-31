namespace Aeris.PlanningEngine.Models;

public record WeatherCondition(
    double WindDirectionDegrees = 180, // Direcția vântului (ex: 180° = vânt din sud, vânt lateral pe pista 08/26 din Craiova)
    double WindSpeedKnots = 20,        // Viteza de bază a vântului (noduri)
    double WindGustKnots = 26,         // Rafale (noduri)
    double VisibilityMeters = 9999,    // Vizibilitate
    string? ForceRunwayInUse = null    // Opțional: dacă se forțează o anumită pistă (ex: "26" pentru ILS comercial, sau "08")
);

public record RunwayInfo(
    string Identifier,       // ex: "08" sau "26" (sau aliasuri "09"/"27")
    double HeadingDegrees,   // ex: 84° sau 264° magnetic (88.93° / 268.95° adevărat)
    double LengthMeters,     // ex: 2500m
    string Surface = "Asphalt"
);
