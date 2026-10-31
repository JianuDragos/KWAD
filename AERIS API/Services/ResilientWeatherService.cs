using System.Collections.Concurrent;
using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;
using Aeris.PlanningEngine.Models;

namespace Aeris.PlanningEngine.Services;

/// <summary>Provider failover, per-ICAO cache, and batched corridor weather cache (anti-blacklist).</summary>
public sealed class ResilientWeatherService : IResilientWeatherService
{
    private static readonly TimeSpan FreshCacheAge = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan MinimumPollInterval = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan MinimumBulkCorridorGap = TimeSpan.FromSeconds(20);
    private const int MaxCorridorPoints = 40;

    private readonly IHttpClientFactory _clients;
    private readonly IConfiguration _configuration;
    private readonly ILogger<ResilientWeatherService> _logger;
    private readonly ConcurrentDictionary<string, AirportCache> _airports = new(StringComparer.OrdinalIgnoreCase);

    // Cache pe celule geografice de 0.25° (~25 km) pentru vremea pe rută:
    // elimină cererile repetate pe waypoint/cadru în timpul redării accelerate (10x..300x).
    private readonly ConcurrentDictionary<string, CachedCorridorCell> _corridorCells = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim _corridorGate = new(1, 1);
    private DateTimeOffset _corridorBackoffUntilUtc;
    private DateTimeOffset _lastCorridorFetchUtc;

    public ResilientWeatherService(IHttpClientFactory clients, IConfiguration configuration, ILogger<ResilientWeatherService> logger)
    {
        _clients = clients;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<MetarData> GetAirportWeatherAsync(string icaoCode, double lat, double lon)
    {
        var icao = icaoCode.Trim().ToUpperInvariant();
        if (!Regex.IsMatch(icao, "^[A-Z0-9]{4}$", RegexOptions.CultureInvariant)) throw new ArgumentException("ICAO must contain four letters or digits.", nameof(icaoCode));
        if (lat is < -90 or > 90 || lon is < -180 or > 180) throw new ArgumentOutOfRangeException(nameof(lat), "Airport coordinates are outside valid geographic bounds.");

        var cache = _airports.GetOrAdd(icao, _ => new AirportCache());
        await cache.Gate.WaitAsync();
        try
        {
            var now = DateTimeOffset.UtcNow;
            if (cache.Latest is not null && now - cache.FetchedAtUtc < FreshCacheAge) return cache.Latest;
            if (now < cache.NextPollUtc) return StaleOrUnavailable(icao, cache, now);

            var result = await TryNoaaAsync(icao, cache, now);
            if (result is null)
            {
                _logger.LogWarning("Primary Weather API rate limited / failed. Switching to Fallback 1 (Open-Meteo) for {ICAO}.", icao);
                result = await TryOpenMeteoAsync(icao, lat, lon, cache, now);
            }
            if (result is null)
            {
                _logger.LogWarning("Open-Meteo failed for {ICAO}; switching to Fallback 2 (AVWX, when configured).", icao);
                result = await TryAvwxAsync(icao, cache, now);
            }

            cache.NextPollUtc = DateTimeOffset.UtcNow.Add(MinimumPollInterval);
            if (result is not null)
            {
                cache.Latest = result;
                cache.FetchedAtUtc = DateTimeOffset.UtcNow;
                return result;
            }
            return StaleOrUnavailable(icao, cache, DateTimeOffset.UtcNow);
        }
        finally { cache.Gate.Release(); }
    }

    public async Task<CorridorWeatherResponse> GetCorridorWeatherAsync(
        IReadOnlyList<(double Lat, double Lon)> waypoints,
        CancellationToken cancellationToken = default)
    {
        if (waypoints is null || waypoints.Count == 0)
            return new CorridorWeatherResponse(DateTime.UtcNow, "Open-Meteo Bulk Corridor Cache", 0, 0, 0, Array.Empty<CorridorWeatherPoint>());

        var corridorTtl = TimeSpan.FromMinutes(Math.Clamp(_configuration.GetValue("WeatherProviders:CorridorCacheMinutes", 20), 5, 120));
        var normalized = waypoints
            .Where(p => p.Lat is >= -90 and <= 90 && p.Lon is >= -180 and <= 180)
            .Take(MaxCorridorPoints)
            .Select(p => (OrigLat: p.Lat, OrigLon: p.Lon, GridLat: SnapGrid(p.Lat), GridLon: SnapGrid(p.Lon), Key: GridKey(p.Lat, p.Lon)))
            .ToList();

        var now = DateTimeOffset.UtcNow;
        var missingKeys = normalized
            .Select(p => p.Key)
            .Distinct(StringComparer.Ordinal)
            .Where(k => !_corridorCells.TryGetValue(k, out var cell) || now - cell.FetchedAtUtc >= corridorTtl)
            .ToList();

        int fetchedCount = 0;
        if (missingKeys.Count > 0 && now >= _corridorBackoffUntilUtc && now - _lastCorridorFetchUtc >= MinimumBulkCorridorGap)
        {
            await _corridorGate.WaitAsync(cancellationToken);
            try
            {
                now = DateTimeOffset.UtcNow;
                missingKeys = normalized
                    .Select(p => p.Key)
                    .Distinct(StringComparer.Ordinal)
                    .Where(k => !_corridorCells.TryGetValue(k, out var cell) || now - cell.FetchedAtUtc >= corridorTtl)
                    .ToList();

                if (missingKeys.Count > 0 && now >= _corridorBackoffUntilUtc && now - _lastCorridorFetchUtc >= MinimumBulkCorridorGap)
                {
                    var uniqueCoords = missingKeys
                        .Select(k => normalized.First(n => n.Key == k))
                        .ToList();

                    fetchedCount = await FetchBulkOpenMeteoCellsAsync(uniqueCoords.Select(c => (c.Key, c.GridLat, c.GridLon)).ToList(), cancellationToken);
                    _lastCorridorFetchUtc = DateTimeOffset.UtcNow;
                }
            }
            finally
            {
                _corridorGate.Release();
            }
        }

        var output = new List<CorridorWeatherPoint>(normalized.Count);
        int cachedHits = 0;
        var freshKeys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in normalized)
        {
            if (_corridorCells.TryGetValue(item.Key, out var cell))
            {
                bool wasCached = DateTimeOffset.UtcNow - cell.FetchedAtUtc > TimeSpan.FromSeconds(3) || fetchedCount == 0;
                if (wasCached) cachedHits++;
                freshKeys.Add(item.Key);
                output.Add(cell.Point with
                {
                    Latitude = Math.Round(item.OrigLat, 4),
                    Longitude = Math.Round(item.OrigLon, 4),
                    FromCache = wasCached
                });
            }
        }

        return new CorridorWeatherResponse(
            RetrievedAtUtc: DateTime.UtcNow,
            SourceProvider: fetchedCount > 0 ? "Open-Meteo Bulk Corridor (1-call batched)" : "Open-Meteo Corridor RAM Cache (0 external calls)",
            TotalPoints: output.Count,
            CachedPointsCount: cachedHits,
            FetchedPointsCount: fetchedCount,
            Points: output
        );
    }

    private async Task<int> FetchBulkOpenMeteoCellsAsync(
        IReadOnlyList<(string Key, double Lat, double Lon)> cells,
        CancellationToken cancellationToken)
    {
        try
        {
            var lats = string.Join(",", cells.Select(c => c.Lat.ToString("0.##", CultureInfo.InvariantCulture)));
            var lons = string.Join(",", cells.Select(c => c.Lon.ToString("0.##", CultureInfo.InvariantCulture)));
            var url = "https://api.open-meteo.com/v1/forecast" +
                      $"?latitude={lats}&longitude={lons}" +
                      "&current=temperature_2m,visibility,cloud_cover,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m" +
                      "&wind_speed_unit=kn&timezone=UTC&forecast_days=1";

            var client = _clients.CreateClient("aviation-weather");
            using var response = await client.GetAsync(url, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                var retryAfter = ParseRetryAfterMinutes(response);
                _corridorBackoffUntilUtc = DateTimeOffset.UtcNow.AddMinutes(Math.Max(10, retryAfter));
                _logger.LogWarning("Open-Meteo bulk corridor returned HTTP {Status}; backing off until {BackoffUtc}.", (int)response.StatusCode, _corridorBackoffUntilUtc);
                return 0;
            }

            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            var root = document.RootElement;
            var fetchedAt = DateTimeOffset.UtcNow;

            if (root.ValueKind == JsonValueKind.Array)
            {
                int idx = 0;
                foreach (var elem in root.EnumerateArray())
                {
                    if (idx >= cells.Count) break;
                    StoreCorridorElement(cells[idx], elem, fetchedAt);
                    idx++;
                }
                return idx;
            }

            if (root.ValueKind == JsonValueKind.Object && cells.Count > 0)
            {
                StoreCorridorElement(cells[0], root, fetchedAt);
                return 1;
            }

            return 0;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _corridorBackoffUntilUtc = DateTimeOffset.UtcNow.AddMinutes(5);
            _logger.LogWarning(ex, "Bulk corridor weather fetch failed; backing off 5 minutes.");
            return 0;
        }
    }

    private void StoreCorridorElement((string Key, double Lat, double Lon) cellInfo, JsonElement root, DateTimeOffset fetchedAt)
    {
        if (!root.TryGetProperty("current", out var current)) return;
        var obs = DateProperty(current, "time") ?? fetchedAt.UtcDateTime;
        var pt = new CorridorWeatherPoint(
            Latitude: cellInfo.Lat,
            Longitude: cellInfo.Lon,
            ObservationTimeUtc: obs,
            WindDirectionDegrees: ToInt(NumberProperty(current, "wind_direction_10m")),
            WindSpeedKnots: ToInt(NumberProperty(current, "wind_speed_10m")),
            WindGustKnots: ToInt(NumberProperty(current, "wind_gusts_10m")),
            VisibilityMeters: ToInt(NumberProperty(current, "visibility")),
            CloudCoverPercent: ToInt(NumberProperty(current, "cloud_cover")),
            WeatherCode: ToInt(NumberProperty(current, "weather_code")),
            TemperatureCelsius: NumberProperty(current, "temperature_2m"),
            FromCache: false
        );
        _corridorCells[cellInfo.Key] = new CachedCorridorCell(pt, fetchedAt);
    }

    private static double SnapGrid(double deg) => Math.Round(deg * 4.0, MidpointRounding.AwayFromZero) / 4.0;
    private static string GridKey(double lat, double lon) =>
        string.Create(CultureInfo.InvariantCulture, $"{SnapGrid(lat):F2},{SnapGrid(lon):F2}");

    private async Task<MetarData?> TryNoaaAsync(string icao, AirportCache cache, DateTimeOffset now) =>
        await TryProviderAsync("NOAA AviationWeather.gov", cache, async () =>
        {
            var client = _clients.CreateClient("aviation-weather");
            using var response = await client.GetAsync($"https://aviationweather.gov/api/data/metar?ids={Uri.EscapeDataString(icao)}&format=json");
            if (!response.IsSuccessStatusCode)
                throw new ProviderHttpException((int)response.StatusCode, ParseRetryAfterMinutes(response));
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var row = document.RootElement.ValueKind == JsonValueKind.Array && document.RootElement.GetArrayLength() > 0
                ? document.RootElement[0] : document.RootElement;
            var raw = StringProperty(row, "rawOb") ?? StringProperty(row, "rawText") ?? StringProperty(row, "raw");
            if (string.IsNullOrWhiteSpace(raw)) return null;
            var observedAt = DateProperty(row, "reportTime") ?? DateProperty(row, "obsTime") ?? now.UtcDateTime;
            return DecodeMetar(icao, raw, observedAt, "NOAA AviationWeather.gov");
        });

    private async Task<MetarData?> TryOpenMeteoAsync(string icao, double lat, double lon, AirportCache cache, DateTimeOffset now) =>
        await TryProviderAsync("Open-Meteo", cache, async () =>
        {
            var client = _clients.CreateClient("aviation-weather");
            var url = "https://api.open-meteo.com/v1/forecast" +
                $"?latitude={lat.ToString(CultureInfo.InvariantCulture)}&longitude={lon.ToString(CultureInfo.InvariantCulture)}" +
                "&current=temperature_2m,dew_point_2m,visibility,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl" +
                "&wind_speed_unit=kn&timezone=UTC&forecast_days=1";
            using var response = await client.GetAsync(url);
            if (!response.IsSuccessStatusCode)
                throw new ProviderHttpException((int)response.StatusCode, ParseRetryAfterMinutes(response));
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            if (!document.RootElement.TryGetProperty("current", out var current)) return null;

            var observation = DateProperty(current, "time") ?? now.UtcDateTime;
            var temperature = NumberProperty(current, "temperature_2m");
            var dewPoint = NumberProperty(current, "dew_point_2m");
            var visibility = NumberProperty(current, "visibility");
            var windDirection = NumberProperty(current, "wind_direction_10m");
            var windSpeed = NumberProperty(current, "wind_speed_10m");
            var gust = NumberProperty(current, "wind_gusts_10m");
            var pressure = NumberProperty(current, "pressure_msl");
            var clouds = NumberProperty(current, "cloud_cover");
            return new MetarData(icao, null, observation, ToInt(windDirection), ToInt(windSpeed), ToInt(gust),
                ToInt(visibility), null, false, null, ToInt(clouds), temperature, dewPoint, ToInt(pressure), "UNKNOWN", "Open-Meteo (forecast; not METAR)");
        });

    private async Task<MetarData?> TryAvwxAsync(string icao, AirportCache cache, DateTimeOffset now)
    {
        var token = _configuration["WeatherProviders:AvwxApiToken"];
        if (string.IsNullOrWhiteSpace(token)) return null;
        return await TryProviderAsync("AVWX", cache, async () =>
        {
            var client = _clients.CreateClient("aviation-weather");
            using var request = new HttpRequestMessage(HttpMethod.Get, $"https://avwx.rest/api/metar/{Uri.EscapeDataString(icao)}");
            request.Headers.Authorization = new AuthenticationHeaderValue("BEARER", token);
            using var response = await client.SendAsync(request);
            if (!response.IsSuccessStatusCode)
                throw new ProviderHttpException((int)response.StatusCode, ParseRetryAfterMinutes(response));
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var raw = StringProperty(document.RootElement, "raw") ?? StringProperty(document.RootElement, "raw_text") ?? StringProperty(document.RootElement, "report");
            if (string.IsNullOrWhiteSpace(raw)) return null;
            var observedAt = document.RootElement.TryGetProperty("time", out var time) ? DateProperty(time, "dt") ?? now.UtcDateTime : now.UtcDateTime;
            return DecodeMetar(icao, raw, observedAt, "AVWX");
        });
    }

    private async Task<MetarData?> TryProviderAsync(string provider, AirportCache cache, Func<Task<MetarData?>> fetch)
    {
        if (cache.ProviderBackoff.TryGetValue(provider, out var backoff) && DateTimeOffset.UtcNow < backoff.NextAllowedUtc)
        {
            _logger.LogInformation("Skipping {Provider} until its exponential backoff expires at {RetryAtUtc}.", provider, backoff.NextAllowedUtc);
            return null;
        }

        try
        {
            var result = await fetch();
            if (result is null) throw new InvalidDataException($"{provider} returned no usable weather report.");
            cache.ProviderBackoff.Remove(provider);
            return result;
        }
        catch (Exception ex)
        {
            var failures = cache.ProviderBackoff.TryGetValue(provider, out var previous) ? previous.Failures + 1 : 1;
            var expMinutes = Math.Min(60, 10 * Math.Pow(2, Math.Min(failures - 1, 3)));
            var retryHeaderMinutes = ex is ProviderHttpException httpEx ? httpEx.RetryAfterMinutes : 0;
            var backoffMinutes = Math.Min(120, Math.Max(expMinutes, retryHeaderMinutes));
            cache.ProviderBackoff[provider] = new ProviderBackoff(failures, DateTimeOffset.UtcNow.AddMinutes(backoffMinutes));
            _logger.LogWarning(ex, "{Provider} failed for weather request; retry backoff is {BackoffMinutes} minutes.", provider, backoffMinutes);
            return null;
        }
    }

    private static double ParseRetryAfterMinutes(HttpResponseMessage response)
    {
        if (response.Headers.RetryAfter?.Delta is { } delta && delta > TimeSpan.Zero)
            return delta.TotalMinutes;
        if (response.Headers.RetryAfter?.Date is { } date && date > DateTimeOffset.UtcNow)
            return (date - DateTimeOffset.UtcNow).TotalMinutes;
        return 0;
    }

    private MetarData StaleOrUnavailable(string icao, AirportCache cache, DateTimeOffset now)
    {
        if (cache.Latest is not null && now - cache.FetchedAtUtc < CacheTtl)
            return cache.Latest with { IsStale = true };
        return new MetarData(icao, null, now.UtcDateTime, null, null, null, null, null, false, null, null,
            null, null, null, "UNKNOWN", "Unavailable", IsStale: true);
    }

    private static MetarData? DecodeMetar(string icao, string report, DateTime observedAt, string provider)
    {
        var wind = Regex.Match(report, @"\b(?<dir>\d{3}|VRB)(?<speed>\d{2,3})(?:G(?<gust>\d{2,3}))?KT\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        double? windDirection = null, windSpeed = null, gust = null;
        if (wind.Success)
        {
            if (wind.Groups["dir"].Value != "VRB" && double.TryParse(wind.Groups["dir"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var direction)) windDirection = direction;
            if (double.TryParse(wind.Groups["speed"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var speed)) windSpeed = speed;
            if (double.TryParse(wind.Groups["gust"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var gustValue)) gust = gustValue;
        }

        double? visibilityMiles = null;
        if (Regex.IsMatch(report, @"\bCAVOK\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)) visibilityMiles = 6.22;
        else
        {
            var metricVisibility = Regex.Match(report, @"(?<=\s)(?<vis>9999|\d{4})(?=\s|$)", RegexOptions.CultureInvariant);
            if (metricVisibility.Success && double.TryParse(metricVisibility.Groups["vis"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var meters)) visibilityMiles = meters / 1609.34;
            else
            {
                var smVisibility = Regex.Match(report, @"\b(?<vis>P?\d+(?:\s+\d+/\d+|/\d+)?)SM\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
                if (smVisibility.Success) visibilityMiles = ParseSmiles(smVisibility.Groups["vis"].Value);
            }
        }

        var cloudMatches = Regex.Matches(report, @"\b(?<cover>FEW|SCT|BKN|OVC|VV)(?<base>\d{3}|///)(?:CB|TCU)?\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        var clouds = cloudMatches.Select(m => new CloudLayerRaw(m.Groups["cover"].Value.ToUpperInvariant(),
            int.TryParse(m.Groups["base"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var baseHundreds) ? baseHundreds : null)).ToList();
        var ceilingKnown = !clouds.Any(layer => (layer.Cover is "BKN" or "OVC" or "VV") && layer.Base is null) &&
            (clouds.Count > 0 || Regex.IsMatch(report, @"\b(CAVOK|NSC|NCD|SKC|CLR)\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant));

        double? temperature = null, dewPoint = null;
        var tempMatch = Regex.Match(report, @"\b(?<temp>M?\d{2})/(?<dew>M?\d{2}|//)\b", RegexOptions.CultureInvariant);
        if (tempMatch.Success)
        {
            temperature = ParseSigned(tempMatch.Groups["temp"].Value);
            if (tempMatch.Groups["dew"].Value != "//") dewPoint = ParseSigned(tempMatch.Groups["dew"].Value);
        }
        double? qnh = null;
        var qnhMatch = Regex.Match(report, @"\bQ(?<qnh>\d{4})\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        if (qnhMatch.Success && double.TryParse(qnhMatch.Groups["qnh"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var qnhValue)) qnh = qnhValue;
        else
        {
            var altimeter = Regex.Match(report, @"\bA(?<alt>\d{4})\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
            if (altimeter.Success && double.TryParse(altimeter.Groups["alt"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var altValue)) qnh = altValue / 100 * 33.8639;
        }

        var raw = new MetarRaw(report, icao, observedAt.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture),
            temperature, dewPoint, qnh, qnh.HasValue ? $"Q{qnh.Value:0}" : null, windSpeed, windDirection, gust,
            visibilityMiles, null, null, null, clouds);
        var decoded = MetarParser.Decode(raw);
        if (decoded is null) return null;
        var ceiling = ceilingKnown
            ? decoded.CloudLayers.Where(layer => layer.IsCeiling).Select(layer => (int?)layer.BaseFeet).Min()
            : null;
        var isStale = DateTime.UtcNow - decoded.ObservationTimeUtc > TimeSpan.FromMinutes(90);
        var ceilingCover = decoded.CloudLayers.FirstOrDefault(layer => layer.IsCeiling)?.Code;
        return new MetarData(icao, report, decoded.ObservationTimeUtc, decoded.WindDirectionDegrees, decoded.WindSpeedKnots,
            decoded.WindGustKnots, visibilityMiles.HasValue ? decoded.VisibilityMeters : null, ceiling, ceilingKnown, ceilingCover, null, decoded.TemperatureCelsius,
            decoded.DewPointCelsius, decoded.QnhHpa, decoded.FlightCategory, provider, isStale);
    }

    private static double? ParseSmiles(string value)
    {
        if (value.StartsWith('P')) return double.TryParse(value[1..], NumberStyles.Float, CultureInfo.InvariantCulture, out var greater) ? greater : null;
        var parts = value.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var total = 0.0;
        foreach (var part in parts)
        {
            if (part.Contains('/'))
            {
                var fraction = part.Split('/');
                if (fraction.Length == 2 && double.TryParse(fraction[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var n) && double.TryParse(fraction[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var d) && d != 0) total += n / d;
            }
            else if (double.TryParse(part, NumberStyles.Float, CultureInfo.InvariantCulture, out var whole)) total += whole;
        }
        return total;
    }

    private static double? ParseSigned(string value)
    {
        var negative = value.StartsWith('M');
        var number = negative ? value[1..] : value;
        return double.TryParse(number, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) ? (negative ? -parsed : parsed) : null;
    }

    private static string? StringProperty(JsonElement obj, string name) => obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    private static double? NumberProperty(JsonElement obj, string name) => obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number ? value.GetDouble() : null;
    private static int? ToInt(double? value) => value.HasValue ? (int)Math.Round(value.Value) : null;
    private static DateTime? DateProperty(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var value)) return null;
        if (value.ValueKind == JsonValueKind.String && DateTime.TryParse(value.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var date)) return date;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var unix))
        {
            try { return DateTimeOffset.FromUnixTimeSeconds(unix).UtcDateTime; } catch (ArgumentOutOfRangeException) { }
        }
        return null;
    }

    private sealed class AirportCache
    {
        public SemaphoreSlim Gate { get; } = new(1, 1);
        public MetarData? Latest { get; set; }
        public DateTimeOffset FetchedAtUtc { get; set; }
        public DateTimeOffset NextPollUtc { get; set; }
        public Dictionary<string, ProviderBackoff> ProviderBackoff { get; } = new(StringComparer.OrdinalIgnoreCase);
    }

    private sealed record ProviderBackoff(int Failures, DateTimeOffset NextAllowedUtc);
    private sealed record CachedCorridorCell(CorridorWeatherPoint Point, DateTimeOffset FetchedAtUtc);
    private sealed class ProviderHttpException(int statusCode, double retryAfterMinutes) : Exception($"HTTP {statusCode}")
    {
        public double RetryAfterMinutes { get; } = retryAfterMinutes;
    }
}
