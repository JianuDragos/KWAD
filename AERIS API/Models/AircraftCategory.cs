namespace Aeris.PlanningEngine.Models;

public enum AircraftCategory
{
    CommercialJet,      // Airbus A320, Boeing 737 (ex. Wizz Air, TAROM)
    RegionalTurboprop,  // ATR-72, Dash 8
    GeneralAviation,    // Cessna 172, Piper PA-28
    UltralightAndGlider // ICP Savannah, PZL-104 Wilga, ULM
}

public enum AdvisoryStatus
{
    ClearedForApproach,       // Permis pentru apropiere și secvențiere aterizare
    HoldInOrbitRecommended,   // Recomandare intrare în orbită (așteptare paralel cu pista)
    DivertRecommended         // Recomandare deviere către aerodrom alternativ (Balta Verde, Podari)
}
