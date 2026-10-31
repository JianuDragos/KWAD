namespace Aeris.PlanningEngine.Models;

// ─────────────────────────────────────────────────────────────────────────────
// Poziție în timp real din OpenSky Network
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// Starea în timp real a unei aeronave detectate de OpenSky Network.
/// Destinat frontend-ului pentru afișare pe hartă și LLM-ului pentru context situațional.
/// </summary>
public record LiveFlightState(
    // ── Identificare ──────────────────────────────────────────────────────────
    string Icao24,                     // Codul ICAO 24-bit (hex): "4b1800"
    string Callsign,                   // Indicativul: "WZZ3751" (trimmed)
    string? OriginCountry,             // Țara de înregistrare: "Romania"

    // ── Poziție ───────────────────────────────────────────────────────────────
    double? Latitude,                  // Latitudine WGS-84 (grade zecimale)
    double? Longitude,                 // Longitudine WGS-84 (grade zecimale)
    double? BaroAltitudeMeters,        // Altitudine barometrică (metri)
    double? GeoAltitudeMeters,         // Altitudine geometrică GPS (metri)
    double? BaroAltitudeFeet,          // Altitudine barometrică (picioare) – calculat
    int? FlightLevelApprox,            // FL aproximat (baro_alt / 30.48 / 100) – calculat

    // ── Mișcare ───────────────────────────────────────────────────────────────
    bool OnGround,                     // true dacă aeronava este la sol
    double? VelocityMs,                // Viteza sol (m/s)
    double? VelocityKnots,             // Viteza sol (noduri) – calculat
    double? TrueTrackDegrees,          // Track real față de nord geografic (°)
    double? VerticalRateMs,            // Rată vertcală (m/s): pozitiv = urcare, negativ = coborâre
    string VerticalTrend,              // "Urcare" | "Coborâre" | "Nivel"

    // ── Timing ────────────────────────────────────────────────────────────────
    long? TimePosition,               // Unix timestamp ultima poziție
    long LastContact,                  // Unix timestamp ultimul contact

    // ── Squawk & Categorii ────────────────────────────────────────────────────
    string? Squawk,                    // Codul squawk transponder: "1200", "7700", etc.
    FlightRules FlightRules,            // Feed-ul OpenSky nu conține reguli; VFR e estimat din squawk-ul standard
    bool? Spi,                         // Special Purpose Indicator (urgență)
    int? Category,                     // Categoria ICAO a aeronavei (0-20)

    // ── Distanța față de LRCV ─────────────────────────────────────────────────
    double? DistanceFromLrcvKm,       // Distanța calculată față de LRCV (km)
    double? BearingFromLrcvDegrees,   // Azimut față de LRCV (°)
    double? VfrEtaMinutes = null,
    string? VfrEntryPointCode = null
);

/// <summary>
/// Răspunsul complet pentru endpoint-ul de poziții live.
/// Include metadata și lista aeronavelor.
/// </summary>
public record LivePositionsResponse(
    DateTime QueryTimeUtc,            // Momentul interogării
    string Source,                    // "OpenSky Live" sau "Simulated"
    int TotalCount,                   // Număr total aeronave detectate în bounding box
    int AirborneCount,                // Număr aeronave în zbor (OnGround=false)
    double BoundingBoxLamin,
    double BoundingBoxLamax,
    double BoundingBoxLomin,
    double BoundingBoxLomax,
    List<LiveFlightState> Flights     // Lista stărilor aeronavelor
);
