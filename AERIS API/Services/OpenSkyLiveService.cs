using System.Text.Json;
using Aeris.PlanningEngine.Models;

namespace Aeris.PlanningEngine.Services;

/// <summary>
/// Serviciu dedicat obținerii pozițiilor în timp real din OpenSky Network.
/// Complet separat de <see cref="OpenSkyService"/> (motorul de simulare) –
/// nu modifică sau afectează funcționalitatea existentă.
/// </summary>
public class OpenSkyLiveService : IOpenSkyLiveService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<OpenSkyLiveService> _logger;

    // Coordonate LRCV (Craiova International Airport)
    private const double LrcvLat = 44.3182;
    private const double LrcvLon = 23.8886;

    // Bounding box identic cu OpenSkyService (moștenit pentru consistență)
    private const double Lamin = 43.8;
    private const double Lamax = 44.8;
    private const double Lomin = 23.3;
    private const double Lomax = 24.5;

    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public OpenSkyLiveService(HttpClient httpClient, ILogger<OpenSkyLiveService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
        _httpClient.Timeout = TimeSpan.FromSeconds(6);
        if (!_httpClient.DefaultRequestHeaders.Contains("User-Agent"))
            _httpClient.DefaultRequestHeaders.Add("User-Agent", "AERIS-Craiova-ATM/1.0");
    }

    /// <inheritdoc/>
    public async Task<LivePositionsResponse> GetLivePositionsAsync()
    {
        var queryTime = DateTime.UtcNow;

        try
        {
            string url = $"https://opensky-network.org/api/states/all" +
                         $"?lamin={Lamin}&lomin={Lomin}&lamax={Lamax}&lomax={Lomax}";

            var response = await _httpClient.GetAsync(url);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("OpenSky a returnat HTTP {Status} pentru live positions.", response.StatusCode);
                return EmptyResponse(queryTime, $"OpenSky indisponibil (HTTP {(int)response.StatusCode})");
            }

            var content = await response.Content.ReadAsStringAsync();
            var openSkyData = JsonSerializer.Deserialize<OpenSkyRawResponse>(content, JsonOptions);

            if (openSkyData?.States is null || openSkyData.States.Count == 0)
            {
                _logger.LogInformation("OpenSky: 0 aeronave detectate în sectorului LRCV.");
                return EmptyResponse(queryTime, "OpenSky live – 0 aeronave în sector");
            }

            var flights = ParseStates(openSkyData.States);
            int airborne = flights.Count(f => !f.OnGround);

            return new LivePositionsResponse(
                QueryTimeUtc: queryTime,
                Source: $"OpenSky Network – live ({flights.Count} detectate, {airborne} în zbor)",
                TotalCount: flights.Count,
                AirborneCount: airborne,
                BoundingBoxLamin: Lamin,
                BoundingBoxLamax: Lamax,
                BoundingBoxLomin: Lomin,
                BoundingBoxLomax: Lomax,
                Flights: flights
            );
        }
        catch (TaskCanceledException)
        {
            _logger.LogWarning("Timeout la interogarea OpenSky pentru pozițiile live.");
            return EmptyResponse(queryTime, "OpenSky timeout (>6s)");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Eroare la obținerea pozițiilor live din OpenSky.");
            return EmptyResponse(queryTime, $"Eroare OpenSky: {ex.Message}");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Parsing
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Parsează lista de state vectors din răspunsul OpenSky.
    /// Fiecare „state" este un array JSON cu 17 elemente indexate.
    /// Index map: https://openskynetwork.github.io/opensky-api/rest.html#response
    /// </summary>
    private List<LiveFlightState> ParseStates(List<List<JsonElement>> states)
    {
        var result = new List<LiveFlightState>();

        foreach (var s in states)
        {
            if (s.Count < 17) continue;

            string icao24 = GetString(s, 0) ?? "unknown";
            string callsign = (GetString(s, 1) ?? "").Trim();
            if (string.IsNullOrEmpty(callsign)) callsign = $"TFC-{icao24.ToUpper()}";

            double? lat = GetDouble(s, 6);
            double? lon = GetDouble(s, 5);
            double? baroAlt = GetDouble(s, 7);      // metri
            double? geoAlt = GetDouble(s, 13);      // metri
            bool onGround = GetBool(s, 8);
            double? velMs = GetDouble(s, 9);
            double? track = GetDouble(s, 10);
            double? vertRate = GetDouble(s, 11);
            long? timePosUnix = GetLong(s, 3);
            long lastContact = GetLong(s, 4) ?? 0;
            string? squawk = GetString(s, 14);
            bool? spi = GetBool2(s, 15);
            int? category = GetInt(s, 16);

            // Conversii
            double? velKts = velMs.HasValue ? velMs.Value * 1.94384 : null;
            double? baroFt = baroAlt.HasValue ? baroAlt.Value * 3.28084 : null;
            int? fl = baroFt.HasValue ? (int)(baroFt.Value / 100) : null;

            string vertTrend = vertRate switch
            {
                null => "Nivel",
                >= 0.5 => "Urcare",
                <= -0.5 => "Coborâre",
                _ => "Nivel"
            };

            // Distanță față de LRCV
            double? distKm = null, bearing = null;
            if (lat.HasValue && lon.HasValue)
            {
                distKm = HaversineKm(LrcvLat, LrcvLon, lat.Value, lon.Value);
                bearing = BearingDeg(LrcvLat, LrcvLon, lat.Value, lon.Value);
            }

            result.Add(new LiveFlightState(
                Icao24: icao24,
                Callsign: callsign,
                OriginCountry: GetString(s, 2),
                Latitude: lat,
                Longitude: lon,
                BaroAltitudeMeters: baroAlt,
                GeoAltitudeMeters: geoAlt,
                BaroAltitudeFeet: baroFt.HasValue ? Math.Round(baroFt.Value, 0) : null,
                FlightLevelApprox: fl,
                OnGround: onGround,
                VelocityMs: velMs,
                VelocityKnots: velKts.HasValue ? Math.Round(velKts.Value, 1) : null,
                TrueTrackDegrees: track,
                VerticalRateMs: vertRate,
                VerticalTrend: vertTrend,
                TimePosition: timePosUnix,
                LastContact: lastContact,
                Squawk: squawk,
                Spi: spi,
                Category: category,
                DistanceFromLrcvKm: distKm.HasValue ? Math.Round(distKm.Value, 2) : null,
                BearingFromLrcvDegrees: bearing.HasValue ? Math.Round(bearing.Value, 1) : null
            ));
        }

        // Sortăm după distanța față de LRCV (cele mai apropiete primele)
        return result.OrderBy(f => f.DistanceFromLrcvKm ?? double.MaxValue).ToList();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Geo helpers
    // ─────────────────────────────────────────────────────────────────────────

    private static double HaversineKm(double lat1, double lon1, double lat2, double lon2)
    {
        const double R = 6371.0;
        double dLat = (lat2 - lat1) * Math.PI / 180;
        double dLon = (lon2 - lon1) * Math.PI / 180;
        double a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2)
                 + Math.Cos(lat1 * Math.PI / 180) * Math.Cos(lat2 * Math.PI / 180)
                 * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        return R * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }

    private static double BearingDeg(double lat1, double lon1, double lat2, double lon2)
    {
        double dLon = (lon2 - lon1) * Math.PI / 180;
        double y = Math.Sin(dLon) * Math.Cos(lat2 * Math.PI / 180);
        double x = Math.Cos(lat1 * Math.PI / 180) * Math.Sin(lat2 * Math.PI / 180)
                 - Math.Sin(lat1 * Math.PI / 180) * Math.Cos(lat2 * Math.PI / 180) * Math.Cos(dLon);
        double brng = Math.Atan2(y, x) * 180 / Math.PI;
        return (brng + 360) % 360;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // JsonElement helper extractors (state vector indexat)
    // ─────────────────────────────────────────────────────────────────────────

    private static string? GetString(List<JsonElement> s, int i) =>
        s[i].ValueKind == JsonValueKind.String ? s[i].GetString() : null;

    private static double? GetDouble(List<JsonElement> s, int i) =>
        s[i].ValueKind == JsonValueKind.Number ? s[i].GetDouble() : null;

    private static long? GetLong(List<JsonElement> s, int i) =>
        s[i].ValueKind == JsonValueKind.Number ? s[i].GetInt64() : null;

    private static int? GetInt(List<JsonElement> s, int i) =>
        s[i].ValueKind == JsonValueKind.Number ? s[i].GetInt32() : null;

    private static bool GetBool(List<JsonElement> s, int i) =>
        s[i].ValueKind == JsonValueKind.True;

    private static bool? GetBool2(List<JsonElement> s, int i) =>
        s[i].ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null
        };

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    private static LivePositionsResponse EmptyResponse(DateTime time, string source) =>
        new(
            QueryTimeUtc: time,
            Source: source,
            TotalCount: 0,
            AirborneCount: 0,
            BoundingBoxLamin: Lamin,
            BoundingBoxLamax: Lamax,
            BoundingBoxLomin: Lomin,
            BoundingBoxLomax: Lomax,
            Flights: new List<LiveFlightState>()
        );

    // ─────────────────────────────────────────────────────────────────────────
    // DTO intern pentru răspunsul OpenSky
    // ─────────────────────────────────────────────────────────────────────────

    private class OpenSkyRawResponse
    {
        public int Time { get; set; }
        public List<List<JsonElement>>? States { get; set; }
    }
}
