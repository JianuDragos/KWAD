namespace Aeris.PlanningEngine.Models.TrajectorySeparation;

/// <summary>
/// Faza de zbor a aeronavei în simularea 4D.
/// </summary>
public enum FlightPhase
{
    EnRoute,
    Holding,
    Approach,
    Final,
    LandingRollout,
    MissedApproach
}

/// <summary>
/// Categoria de turbulență de siaj (Wake Turbulence Category conform ICAO Doc 4444 / EASA).
/// </summary>
public enum WakeCategory
{
    Heavy,   // MTOW >= 136,000 kg
    Medium,  // 7,000 kg < MTOW < 136,000 kg (A320, B737, ATR-72)
    Light    // MTOW <= 7,000 kg (Savannah, Wilga, Cessna 172)
}
