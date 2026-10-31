namespace Aeris.PlanningEngine.Models;

/// <summary>
/// Configurația centralizată a pistelor pentru Aeroportul Internațional Craiova (LRCV),
/// verificată conform AIP România (AIRAC 2026-10-01 / 2026-10-29, AD 2 LRCV, AD 2.9-71 RNP RWY 26, AD 2.9-72 RNP RWY 08).
/// Sursă unică de adevăr pentru coordonate, capete magnetice și direcții adevărate.
/// </summary>
public static class RunwayConfiguration
{
    public const string DefaultAirportIcao = "LRCV";
    public const string DefaultAirportName = "Aeroportul Internațional Craiova";

    /// <summary>Declinația magnetică publicată în AIP: 5.0° E (2019).</summary>
    public const double MagneticVariationDeg = 5.0;

    // ── Pista 08 (desemnată anterior 09) ──────────────────────────────────────
    public const string Runway08 = "08";
    /// <summary>Direcția adevărată (True Bearing GEO / WGS84) din AIP: 88.93°.</summary>
    public const double Runway08TrueBearingDeg = 88.93;
    /// <summary>Capul magnetic oficial (MAG = True - 5°E): 83.93° (rotunjit 084° pe aparate).</summary>
    public const double Runway08MagneticHeadingDeg = 83.93;
    public const double Runway08ElevationFt = 628.0;
    public const double Threshold08Latitude = 44.317936;
    public const double Threshold08Longitude = 23.872867;

    // ── Pista 26 (desemnată anterior 27) ──────────────────────────────────────
    public const string Runway26 = "26";
    /// <summary>Direcția adevărată (True Bearing GEO / WGS84) din AIP: 268.95°.</summary>
    public const double Runway26TrueBearingDeg = 268.95;
    /// <summary>Capul magnetic oficial (MAG = True - 5°E): 263.95° (rotunjit 264° pe aparate).</summary>
    public const double Runway26MagneticHeadingDeg = 263.95;
    public const double Runway26ElevationFt = 615.4;
    public const double Threshold26Latitude = 44.318356;
    public const double Threshold26Longitude = 23.904197;
    public const string IlsIdentifier = "ICV";
    public const double IlsFrequencyMhz = 108.7;

    public const double RunwayLengthMeters = 2500.0;
    public const double RunwayWidthMeters = 45.0;
    public const string SurfaceType = "Asfalt";

    /// <summary>
    /// Normalizează orice identificator de pistă, acceptând atât noile indicative oficiale (08/26),
    /// cât și aliasurile istorice (09/27).
    /// </summary>
    public static string Normalize(string? runwayId)
    {
        if (string.IsNullOrWhiteSpace(runwayId)) return Runway08;
        return runwayId.Trim().ToUpperInvariant() switch
        {
            "26" or "26L" or "26R" or "27" => Runway26,
            "08" or "8" or "08L" or "08R" or "09" or "9" => Runway08,
            _ => runwayId.Trim()
        };
    }

    /// <summary>
    /// Returnează identificatorul pistei opuse (sens invers / reciprocal).
    /// </summary>
    public static string GetReciprocal(string runwayId)
    {
        var norm = Normalize(runwayId);
        return norm switch
        {
            Runway08 => Runway26,
            Runway26 => Runway08,
            "13" => "31",
            "31" => "13",
            "02" or "2" => "20",
            "20" => "02",
            _ => runwayId
        };
    }

    /// <summary>
    /// Obține capul de pistă în funcție de referința dorită (Adevărată pentru METAR / calcule WGS84, Magnetică pentru cockpit/ATC).
    /// </summary>
    public static double GetHeading(string runwayId, bool trueNorth = true)
    {
        var norm = Normalize(runwayId);
        if (norm == Runway08) return trueNorth ? Runway08TrueBearingDeg : Runway08MagneticHeadingDeg;
        if (norm == Runway26) return trueNorth ? Runway26TrueBearingDeg : Runway26MagneticHeadingDeg;

        // Aerodromuri alternative locale (orientări magnetice standard)
        return norm switch
        {
            "13" => 130.0,
            "31" => 310.0,
            "02" or "2" => 20.0,
            "20" => 200.0,
            _ => trueNorth ? Runway08TrueBearingDeg : Runway08MagneticHeadingDeg
        };
    }
}
