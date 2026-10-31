namespace Aeris.PlanningEngine.Models.TrajectorySeparation;

/// <summary>
/// Setări configurabile pentru validarea separării 3D, ocupării pistei și turbulenței de siaj.
/// </summary>
public record SeparationSettings(
    // ── Separare En-Route / Terminal (EASA SERA & ICAO) ───────────────────────
    double IfrIfrHorizontalSeparationNm = 5.0,     // 5.0 NM radar standard (sau 3.0 NM terminal)
    double IfrIfrVerticalSeparationFt = 1000.0,    // 1.000 ft sub FL410
    double IfrVfrHorizontalSeparationNm = 3.0,    // 3.0 NM separare ATC în Spațiul C (Craiova CTR)
    double IfrVfrVerticalSeparationFt = 1000.0,   // 1.000 ft separare verticală IFR față de VFR
    double VfrVfrHorizontalSeparationNm = 1.5,    // 1.5 NM bulă de siguranță / informare trafic AERIS
    double VfrVfrVerticalSeparationFt = 500.0,    // 500 ft separare verticală VFR/VFR
    
    // ── Mod Strict (Demonstrativ) ─────────────────────────────────────────────
    // Respinge planurile dacă două aeronave se suprapun orizontal (< prag), chiar dacă altitudinile diferă!
    bool StrictMode = false,
    double StrictModeHorizontalThresholdNm = 3.0,

    // ── Siguranța Pistei (Runway Safety & Occupancy) ──────────────────────────
    double RunwayOccupancyCommercialSeconds = 60.0, // Timp estimat ocupare pistă pentru jet/turboprop
    double RunwayOccupancyLightSeconds = 45.0,      // Timp ocupare pistă pentru avioane ușoare / ULM
    double RunwaySafetyMarginSeconds = 15.0,        // Marjă suplimentară de siguranță la eliberare

    // ── Separare Siaj (Wake Turbulence Interval - Secunde) ─────────────────────
    // ICAO Doc 4444 / EASA ATS.TR.210 minime de timp la pragul pistei
    double WakeHeavyBehindHeavySeconds = 100.0,
    double WakeMediumBehindHeavySeconds = 120.0,
    double WakeLightBehindHeavySeconds = 180.0,
    double WakeLightBehindMediumSeconds = 180.0,    // 3 minute oficial EASA pentru LIGHT după MEDIUM
    double WakeMediumBehindMediumSeconds = 90.0,
    double WakeLightBehindLightSeconds = 60.0,

    // ── Rezoluție simulare ────────────────────────────────────────────────────
    double TimeStepSeconds = 2.0                    // Interval de eșantionare 3D (2 secunde)
)
{
    /// <summary>
    /// Returnează separarea minimă de siaj necesară (în secunde) între aeronava anterioară (lider) și cea curentă (urmăritor).
    /// </summary>
    public double GetRequiredWakeIntervalSeconds(WakeCategory leader, WakeCategory follower)
    {
        return (leader, follower) switch
        {
            (WakeCategory.Heavy, WakeCategory.Heavy) => WakeHeavyBehindHeavySeconds,
            (WakeCategory.Heavy, WakeCategory.Medium) => WakeMediumBehindHeavySeconds,
            (WakeCategory.Heavy, WakeCategory.Light) => WakeLightBehindHeavySeconds,
            (WakeCategory.Medium, WakeCategory.Light) => WakeLightBehindMediumSeconds,
            (WakeCategory.Medium, WakeCategory.Medium) => WakeMediumBehindMediumSeconds,
            (WakeCategory.Light, WakeCategory.Light) => WakeLightBehindLightSeconds,
            _ => 60.0
        };
    }

    /// <summary>
    /// Returnează timpul minim de ocupare a pistei pentru o categorie de aeronavă.
    /// </summary>
    public double GetRunwayOccupancySeconds(AircraftCategory category)
    {
        return category switch
        {
            AircraftCategory.CommercialJet or AircraftCategory.RegionalTurboprop =>
                RunwayOccupancyCommercialSeconds + RunwaySafetyMarginSeconds,
            _ => RunwayOccupancyLightSeconds + RunwaySafetyMarginSeconds
        };
    }
}
