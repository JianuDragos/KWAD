namespace Aeris.PlanningEngine.Models;

// ─────────────────────────────────────────────────────────────────────────────
// Raw METAR response – câmpurile returnate de aviationweather.gov JSON API
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// Răspunsul JSON brut de la aviationweather.gov pentru un singur METAR.
/// Serializat direct din API, câmpurile pot fi null dacă nu sunt raportate.
/// </summary>
public record MetarRaw(
    string? RawObservation,       // Ex: "LRCV 310730Z 24009KT 7000 BKN003 OVC007 11/11 Q1020"
    string? IcaoId,               // "LRCV"
    string? ObsTime,              // ISO-8601 UTC: "2026-10-31T07:30:00Z"
    double? Temp,                 // Temperatura (°C)
    double? Dewp,                 // Punctul de rouă (°C)
    double? Altim,                // QNH (hPa / inHg – depinde de unitate)
    string? Altim_hpa,            // QNH în hPa (string, ex "Q1020")
    double? Wspd,                 // Viteza vântului (noduri)
    double? Wdir,                 // Direcția vântului (grade)
    double? Wgst,                 // Rafale (noduri), null dacă nu există
    double? Visib,                // Vizibilitate (statute miles, convertim la metri)
    string? WxString,             // Fenomene meteo: "RA", "-RA", "TSRA", "FG", etc.
    string? SkyCondition,         // Str cloud (ex: "BKN003 OVC007") — câmp legacy
    string? FlightCategory,       // "VFR" | "MVFR" | "IFR" | "LIFR"
    List<CloudLayerRaw>? Clouds   // Lista straturilor de nori
);

/// <summary>
/// Un strat de nori din METAR (ex: BKN003 = broken la 300 ft).
/// </summary>
public record CloudLayerRaw(
    string? Cover,    // "CLR","FEW","SCT","BKN","OVC","OVX"
    int? Base         // Baza norilor în sute de picioare (FL), ex 3 = 300 ft AGL
);

// ─────────────────────────────────────────────────────────────────────────────
// Decoded METAR – versiunea human-readable + AI-ready
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// METAR decodat complet. Destinat frontend-ului și LLM-ului de 4B pentru
/// analiza în timp real a condițiilor meteo la LRCV.
/// </summary>
public record MetarDecoded(
    // ── Identificare ──────────────────────────────────────────────────────────
    string Station,                     // "LRCV"
    string RawMetar,                    // Stringul METAR original
    DateTime ObservationTimeUtc,        // Ora observației în UTC
    string ObservationTimeLocal,        // Ora locală formatată (UTC+2 EET / UTC+3 EEST)

    // ── Vânt ──────────────────────────────────────────────────────────────────
    int? WindDirectionDegrees,          // Direcția vântului (°), null = variabil
    int WindSpeedKnots,                 // Viteza vântului (noduri)
    int? WindGustKnots,                 // Rafale (noduri), null dacă nu există
    string WindDescription,            // Ex: "Sud-Vest 9 noduri, rafale 15 noduri"
    bool IsWindVariable,               // true dacă vântul este variabil (VRB)

    // ── Vizibilitate ──────────────────────────────────────────────────────────
    int VisibilityMeters,              // Vizibilitate în metri
    string VisibilityDescription,      // Ex: "7000 m (7 km)"

    // ── Nori ──────────────────────────────────────────────────────────────────
    List<CloudLayerDecoded> CloudLayers, // Lista straturilor de nori decodate
    string SkyConditionDescription,    // Ex: "Overcast la 700 ft (cer acoperit)"

    // ── Temperatură & Rouă ────────────────────────────────────────────────────
    double TemperatureCelsius,         // Temperatura (°C)
    double DewPointCelsius,            // Punctul de rouă (°C)
    int HumidityPercent,               // Umiditate relativă (%)
    string TemperatureDewPointDescription, // Ex: "11°C / 11°C – umiditate 100%, ceață probabilă"

    // ── Presiune ──────────────────────────────────────────────────────────────
    int QnhHpa,                        // QNH în hPa (ex: 1020)
    string PressureDescription,        // Ex: "QNH 1020 hPa (altimetrul setează 30.12 inHg)"

    // ── Fenomene meteo speciale ────────────────────────────────────────────────
    string? WeatherPhenomena,          // Null dacă cer senin, altfel "Ploaie moderată", etc.
    bool HasSignificantWeather,        // true dacă există fenomene meteo notabile

    // ── Categoria de zbor ─────────────────────────────────────────────────────
    string FlightCategory,             // "VFR" | "MVFR" | "IFR" | "LIFR"
    string FlightCategoryDescription,  // Ex: "IFR – Condiții instrumental (vizibilitate sub 5 km sau plafon sub 1000 ft)"

    // ── Rezumat pentru controller aerian ─────────────────────────────────────
    string ControllerSummary,          // Un paragraf: condiții curente, impactul operațional
    string AiContextPrompt,            // Prompt gata de injectat în LLM: toate datele într-un text structurat
    bool IsStale = false,
    string SourceProvider = "NOAA AviationWeather.gov",
    bool CeilingKnown = true
);

/// <summary>Provider-neutral weather snapshot used by the resilient fetch chain and VMC checker.</summary>
public sealed record MetarData(
    string IcaoCode,
    string? RawMetar,
    DateTime ObservationTimeUtc,
    int? WindDirectionDegrees,
    int? WindSpeedKnots,
    int? WindGustKnots,
    int? VisibilityMeters,
    int? CeilingFeet,
    bool CeilingKnown,
    string? CeilingCover,
    int? CloudCoverPercent,
    double? TemperatureCelsius,
    double? DewPointCelsius,
    int? QnhHpa,
    string FlightCategory,
    string SourceProvider,
    bool IsStale = false);

/// <summary>
/// Un strat de nori decodat cu denumiri human-readable.
/// </summary>
public record CloudLayerDecoded(
    string Code,           // "BKN", "OVC", etc.
    string CoverName,      // "Broken (5-7 octas)", "Overcast (8 octas)"
    int BaseHundredsFeet,  // Baza în sute de ft: ex 3 = 300 ft
    int BaseFeet,          // Baza în picioare: ex 300
    int BaseMeters,        // Baza în metri: ex ~90 m
    bool IsCeiling         // true dacă BKN sau OVC (plafonul operațional)
);
