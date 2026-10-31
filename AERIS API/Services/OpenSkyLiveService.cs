using System.Globalization;
using System.Net;
using System.Text.Json;
using Aeris.PlanningEngine.Models;

namespace Aeris.PlanningEngine.Services;

/// <summary>
/// Serviciu dedicat obținerii pozițiilor în timp real din OpenSky Network, cu protecție anti-blacklist:
/// - cache partajat în memorie (implicit 15s) și blocare single-flight (SemaphoreSlim) pentru toate tab-urile și endpoint-urile;
/// - respectare antete Retry-After / X-Rate-Limit-Retry-After-Seconds + backoff exponențial la HTTP 429/5xx;
/// - fallback automat fără cheie pe api.adsb.lol când cota anonimă OpenSky este epuizată;
/// - servire snapshot recent din cache (până la 180s) dacă ambele surse externe sunt temporar indisponibile.
/// Complet separat de <see cref="OpenSkyService"/> (motorul de simulare) –
/// nu modifică sau afectează funcționalitatea existentă.
/// </summary>
public class OpenSkyLiveService : IOpenSkyLiveService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<OpenSkyLiveService> _logger;
    private readonly IConfiguration _configuration;

    // Stare partajată între instanțe (dacă serviciul este rezolvat tranzient sau singleton)
    private static readonly SemaphoreSlim PollGate = new(1, 1);
    private static readonly SemaphoreSlim TokenGate = new(1, 1);
    private static LivePositionsResponse? _cachedResponse;
    private static DateTimeOffset _cachedAtUtc;
    private static DateTimeOffset _openSkyBackoffUntilUtc;
    private static int _openSkyConsecutiveFailures;
    private static DateTimeOffset _adsbLolBackoffUntilUtc;
    private static string? _accessToken;
    private static DateTime _tokenExpiresUtc;

    // Coordonate LRCV (Craiova International Airport)
    private const double LrcvLat = 44.3182;
    private const double LrcvLon = 23.8886;

    // Bounding box identic cu OpenSkyService (moștenit pentru consistență)
    private const double Lamin = 43.8;
    private const double Lamax = 44.8;
    private const double Lomin = 23.3;
    private const double Lomax = 24.5;

    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public OpenSkyLiveService(HttpClient httpClient, ILogger<OpenSkyLiveService> logger, IConfiguration configuration)
    {
        _httpClient = httpClient;
        _logger = logger;
        _configuration = configuration;
        _httpClient.Timeout = TimeSpan.FromSeconds(6);
        if (!_httpClient.DefaultRequestHeaders.Contains("User-Agent"))
            _httpClient.DefaultRequestHeaders.Add("User-Agent", "AERIS-Craiova-ATM/1.0");
    }

    /// <inheritdoc/>
    public async Task<LivePositionsResponse> GetLivePositionsAsync()
    {
        var freshDuration = TimeSpan.FromSeconds(Math.Clamp(_configuration.GetValue("OpenSky:CacheSeconds", 15), 5, 120));
        var staleDuration = TimeSpan.FromSeconds(Math.Clamp(_configuration.GetValue("OpenSky:StaleCacheSeconds", 180), 30, 900));
        var adsbFallbackEnabled = _configuration.GetValue("OpenSky:AdsbLolFallbackEnabled", true);

        var now = DateTimeOffset.UtcNow;
        if (_cachedResponse is not null && now - _cachedAtUtc < freshDuration)
            return _cachedResponse;

        await PollGate.WaitAsync();
        try
        {
            now = DateTimeOffset.UtcNow;
            if (_cachedResponse is not null && now - _cachedAtUtc < freshDuration)
                return _cachedResponse;

            string? openSkyFailureReason = null;

            if (now >= _openSkyBackoffUntilUtc)
            {
                var (openSkyResult, errorReason) = await TryFetchOpenSkyAsync(now.UtcDateTime);
                if (openSkyResult is not null)
                {
                    _openSkyConsecutiveFailures = 0;
                    _cachedResponse = openSkyResult;
                    _cachedAtUtc = DateTimeOffset.UtcNow;
                    return openSkyResult;
                }
                openSkyFailureReason = errorReason;
            }
            else
            {
                var waitSec = Math.Max(1, (int)Math.Ceiling((_openSkyBackoffUntilUtc - now).TotalSeconds));
                openSkyFailureReason = $"OpenSky în protecție rate-limit ({waitSec}s rămase)";
            }

            // Fallback fără autentificare: ADSB.lol (agregator comunitar ADS-B, rază 55 NM în jurul LRCV)
            if (adsbFallbackEnabled && DateTimeOffset.UtcNow >= _adsbLolBackoffUntilUtc)
            {
                var adsbResult = await TryFetchAdsbLolAsync(DateTime.UtcNow, openSkyFailureReason);
                if (adsbResult is not null)
                {
                    _cachedResponse = adsbResult;
                    _cachedAtUtc = DateTimeOffset.UtcNow;
                    return adsbResult;
                }
            }

            // Dacă avem un snapshot recent în memorie, îl servim marcat clar ca cache în loc să golim ecranul radar
            if (_cachedResponse is not null && DateTimeOffset.UtcNow - _cachedAtUtc < staleDuration)
            {
                var ageSec = (int)Math.Round((DateTimeOffset.UtcNow - _cachedAtUtc).TotalSeconds);
                return _cachedResponse with
                {
                    Source = $"{_cachedResponse.Source} [cache {ageSec}s]"
                };
            }

            return EmptyResponse(DateTime.UtcNow, openSkyFailureReason ?? "OpenSky indisponibil");
        }
        finally
        {
            PollGate.Release();
        }
    }

    private async Task<(LivePositionsResponse? Result, string? ErrorReason)> TryFetchOpenSkyAsync(DateTime queryTime)
    {
        try
        {
            string url = $"https://opensky-network.org/api/states/all" +
                         $"?lamin={Lamin.ToString(CultureInfo.InvariantCulture)}" +
                         $"&lomin={Lomin.ToString(CultureInfo.InvariantCulture)}" +
                         $"&lamax={Lamax.ToString(CultureInfo.InvariantCulture)}" +
                         $"&lomax={Lomax.ToString(CultureInfo.InvariantCulture)}";

            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            var token = await GetAccessTokenAsync();
            if (!string.IsNullOrWhiteSpace(token))
                request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

            using var response = await _httpClient.SendAsync(request);

            if (!response.IsSuccessStatusCode)
            {
                ApplyOpenSkyBackoff(response);
                _logger.LogWarning(
                    "OpenSky a returnat HTTP {Status} pentru live positions. Backoff activ până la {BackoffUntilUtc}.",
                    (int)response.StatusCode,
                    _openSkyBackoffUntilUtc);
                return (null, $"OpenSky indisponibil (HTTP {(int)response.StatusCode})");
            }

            var content = await response.Content.ReadAsStringAsync();
            var openSkyData = JsonSerializer.Deserialize<OpenSkyRawResponse>(content, JsonOptions);

            if (openSkyData?.States is null || openSkyData.States.Count == 0)
            {
                _logger.LogInformation("OpenSky: 0 aeronave detectate în sectorul LRCV.");
                return (EmptyResponse(queryTime, "OpenSky live – 0 aeronave în sector"), null);
            }

            var flights = ParseStates(openSkyData.States);
            int airborne = flights.Count(f => !f.OnGround);

            return (new LivePositionsResponse(
                QueryTimeUtc: queryTime,
                Source: $"OpenSky Network – live ({flights.Count} detectate, {airborne} în zbor)",
                TotalCount: flights.Count,
                AirborneCount: airborne,
                BoundingBoxLamin: Lamin,
                BoundingBoxLamax: Lamax,
                BoundingBoxLomin: Lomin,
                BoundingBoxLomax: Lomax,
                Flights: flights
            ), null);
        }
        catch (TaskCanceledException)
        {
            ApplyOpenSkyBackoff(response: null);
            _logger.LogWarning("Timeout la interogarea OpenSky pentru pozițiile live.");
            return (null, "OpenSky timeout (>6s)");
        }
        catch (Exception ex)
        {
            ApplyOpenSkyBackoff(response: null);
            _logger.LogError(ex, "Eroare la obținerea pozițiilor live din OpenSky.");
            return (null, $"Eroare OpenSky: {ex.Message}");
        }
    }

    private async Task<LivePositionsResponse?> TryFetchAdsbLolAsync(DateTime queryTime, string? openSkyReason)
    {
        try
        {
            string url = string.Create(
                CultureInfo.InvariantCulture,
                $"https://api.adsb.lol/v2/point/{LrcvLat:F4}/{LrcvLon:F4}/55");

            using var response = await _httpClient.GetAsync(url);
            if (!response.IsSuccessStatusCode)
            {
                _adsbLolBackoffUntilUtc = DateTimeOffset.UtcNow.AddSeconds(response.StatusCode == HttpStatusCode.TooManyRequests ? 90 : 30);
                return null;
            }

            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            if (!doc.RootElement.TryGetProperty("ac", out var acArray) || acArray.ValueKind != JsonValueKind.Array)
                return null;

            long nowUnix = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var flights = new List<LiveFlightState>();

            foreach (var item in acArray.EnumerateArray())
            {
                double? lat = PropDouble(item, "lat");
                double? lon = PropDouble(item, "lon");
                if (lat is null || lon is null) continue;
                if (lat < Lamin || lat > Lamax || lon < Lomin || lon > Lomax) continue;

                string icao24 = (PropString(item, "hex") ?? "unknown").Trim().ToLowerInvariant();
                string callsign = (PropString(item, "flight") ?? "").Trim();
                if (string.IsNullOrEmpty(callsign)) callsign = $"TFC-{icao24.ToUpperInvariant()}";

                bool onGround = false;
                double? baroFt = null;
                if (item.TryGetProperty("alt_baro", out var altBaroEl))
                {
                    if (altBaroEl.ValueKind == JsonValueKind.String &&
                        string.Equals(altBaroEl.GetString(), "ground", StringComparison.OrdinalIgnoreCase))
                    {
                        onGround = true;
                        baroFt = 0;
                    }
                    else if (altBaroEl.ValueKind == JsonValueKind.Number)
                    {
                        baroFt = altBaroEl.GetDouble();
                    }
                }

                double? geoFt = PropDouble(item, "alt_geom");
                double? baroMeters = baroFt.HasValue ? Math.Round(baroFt.Value * 0.3048, 1) : null;
                double? geoMeters = geoFt.HasValue ? Math.Round(geoFt.Value * 0.3048, 1) : null;
                int? fl = baroFt.HasValue ? (int)(baroFt.Value / 100.0) : null;

                double? gsKnots = PropDouble(item, "gs");
                double? velMs = gsKnots.HasValue ? Math.Round(gsKnots.Value / 1.94384, 2) : null;
                double? track = PropDouble(item, "track");
                double? baroRateFpm = PropDouble(item, "baro_rate") ?? PropDouble(item, "geom_rate");
                double? vertRateMs = baroRateFpm.HasValue ? Math.Round(baroRateFpm.Value * 0.00508, 2) : null;

                string vertTrend = vertRateMs switch
                {
                    null => "Nivel",
                    >= 0.5 => "Urcare",
                    <= -0.5 => "Coborâre",
                    _ => "Nivel"
                };

                double seenSec = PropDouble(item, "seen") ?? 0;
                double seenPosSec = PropDouble(item, "seen_pos") ?? seenSec;
                long lastContact = nowUnix - (long)Math.Round(Math.Max(0, seenSec));
                long timePos = nowUnix - (long)Math.Round(Math.Max(0, seenPosSec));
                string? squawk = PropString(item, "squawk");

                double distKm = HaversineKm(LrcvLat, LrcvLon, lat.Value, lon.Value);
                double bearing = BearingDeg(LrcvLat, LrcvLon, lat.Value, lon.Value);

                flights.Add(new LiveFlightState(
                    Icao24: icao24,
                    Callsign: callsign,
                    OriginCountry: PropString(item, "r"),
                    Latitude: lat,
                    Longitude: lon,
                    BaroAltitudeMeters: baroMeters,
                    GeoAltitudeMeters: geoMeters,
                    BaroAltitudeFeet: baroFt.HasValue ? Math.Round(baroFt.Value, 0) : null,
                    FlightLevelApprox: fl,
                    OnGround: onGround,
                    VelocityMs: velMs,
                    VelocityKnots: gsKnots.HasValue ? Math.Round(gsKnots.Value, 1) : null,
                    TrueTrackDegrees: track,
                    VerticalRateMs: vertRateMs,
                    VerticalTrend: vertTrend,
                    TimePosition: timePos,
                    LastContact: lastContact,
                    Squawk: squawk,
                    FlightRules: ClassifyFlightRules(squawk),
                    Spi: PropInt(item, "spi") is int spiVal ? spiVal != 0 : null,
                    Category: null,
                    DistanceFromLrcvKm: Math.Round(distKm, 2),
                    BearingFromLrcvDegrees: Math.Round(bearing, 1)
                ));
            }

            var sorted = flights.OrderBy(f => f.DistanceFromLrcvKm ?? double.MaxValue).ToList();
            int airborne = sorted.Count(f => !f.OnGround);
            string suffix = string.IsNullOrWhiteSpace(openSkyReason) ? "" : $" [fallback după {openSkyReason}]";

            return new LivePositionsResponse(
                QueryTimeUtc: queryTime,
                Source: $"ADSB.lol – live ({sorted.Count} detectate, {airborne} în zbor){suffix}",
                TotalCount: sorted.Count,
                AirborneCount: airborne,
                BoundingBoxLamin: Lamin,
                BoundingBoxLamax: Lamax,
                BoundingBoxLomin: Lomin,
                BoundingBoxLomax: Lomax,
                Flights: sorted
            );
        }
        catch (Exception ex)
        {
            _adsbLolBackoffUntilUtc = DateTimeOffset.UtcNow.AddSeconds(30);
            _logger.LogWarning(ex, "Fallback-ul ADSB.lol nu a putut fi interogat.");
            return null;
        }
    }

    private static void ApplyOpenSkyBackoff(HttpResponseMessage? response)
    {
        _openSkyConsecutiveFailures = Math.Min(_openSkyConsecutiveFailures + 1, 6);
        var expSeconds = Math.Min(300, 30 * Math.Pow(2, Math.Min(_openSkyConsecutiveFailures - 1, 4)));
        var retryHeader = ParseRetryAfter(response);
        var delay = retryHeader.HasValue && retryHeader.Value.TotalSeconds > expSeconds
            ? TimeSpan.FromSeconds(Math.Min(900, retryHeader.Value.TotalSeconds))
            : TimeSpan.FromSeconds(expSeconds);
        _openSkyBackoffUntilUtc = DateTimeOffset.UtcNow.Add(delay);
    }

    internal static TimeSpan? ParseRetryAfter(HttpResponseMessage? response)
    {
        if (response is null) return null;
        if (response.Headers.TryGetValues("X-Rate-Limit-Retry-After-Seconds", out var customVals) &&
            double.TryParse(customVals.FirstOrDefault(), NumberStyles.Float, CultureInfo.InvariantCulture, out var sec) &&
            sec > 0)
        {
            return TimeSpan.FromSeconds(sec);
        }
        if (response.Headers.RetryAfter?.Delta is { } delta && delta > TimeSpan.Zero)
            return delta;
        if (response.Headers.RetryAfter?.Date is { } date && date > DateTimeOffset.UtcNow)
            return date - DateTimeOffset.UtcNow;
        return null;
    }

    private async Task<string?> GetAccessTokenAsync()
    {
        var clientId = _configuration["OpenSky:ClientId"];
        var clientSecret = _configuration["OpenSky:ClientSecret"];
        if (string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(clientSecret)) return null;
        if (!string.IsNullOrEmpty(_accessToken) && _tokenExpiresUtc > DateTime.UtcNow.AddMinutes(1)) return _accessToken;

        await TokenGate.WaitAsync();
        try
        {
            if (!string.IsNullOrEmpty(_accessToken) && _tokenExpiresUtc > DateTime.UtcNow.AddMinutes(1)) return _accessToken;
            using var content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "client_credentials", ["client_id"] = clientId, ["client_secret"] = clientSecret
            });
            using var response = await _httpClient.PostAsync("https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token", content);
            response.EnsureSuccessStatusCode();
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            _accessToken = document.RootElement.GetProperty("access_token").GetString();
            var expires = document.RootElement.TryGetProperty("expires_in", out var seconds) ? seconds.GetInt32() : 300;
            _tokenExpiresUtc = DateTime.UtcNow.AddSeconds(expires);
            return _accessToken;
        }
        finally
        {
            TokenGate.Release();
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
                FlightRules: ClassifyFlightRules(squawk),
                Spi: spi,
                Category: category,
                DistanceFromLrcvKm: distKm.HasValue ? Math.Round(distKm.Value, 2) : null,
                BearingFromLrcvDegrees: bearing.HasValue ? Math.Round(bearing.Value, 1) : null
            ));
        }

        // Sortăm după distanța față de LRCV (cele mai apropiate primele)
        return result.OrderBy(f => f.DistanceFromLrcvKm ?? double.MaxValue).ToList();
    }

    private static FlightRules ClassifyFlightRules(string? squawk) => squawk switch
    {
        "1200" => FlightRules.VFR,
        "7000" => FlightRules.VFR,
        // OpenSky's state vector has no filed-flight-rules field. Unknown squawks
        // remain unknown to this VFR feed and are conservatively classified IFR.
        _ => FlightRules.IFR
    };

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
    // JsonElement helper extractors (state vector indexat + obiecte JSON)
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

    private static string? PropString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static double? PropDouble(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;

    private static int? PropInt(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) ? n : null;

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
