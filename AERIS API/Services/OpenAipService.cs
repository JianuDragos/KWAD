using System.Text.Json;
using Aeris.PlanningEngine.Models;

namespace Aeris.PlanningEngine.Services;

public sealed class OpenAipOptions
{
    public string ApiKey { get; set; } = "";
    public string LocalGeoJsonPath { get; set; } = "data/vfr-reporting-points.geojson";
    public string Country { get; set; } = "RO";
    public int RefreshHours { get; set; } = 24;
}

public sealed record VfrAirspace(string Id, string Name, string AirspaceClass, JsonElement Geometry);

public interface IOpenAipService
{
    Task RefreshAsync(CancellationToken cancellationToken = default);
    IReadOnlyList<VfrReportingPoint> ReportingPoints { get; }
    IReadOnlyList<VfrAirspace> Airspaces { get; }
    string DataSource { get; }
}

/// <summary>OpenAIP cache with local GeoJSON fallback. OpenAIP requires a key; local data works offline.</summary>
public sealed class OpenAipService : BackgroundService, IOpenAipService
{
    private readonly HttpClient _http;
    private readonly OpenAipOptions _options;
    private readonly IVfrGeofenceService _geofence;
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<OpenAipService> _logger;
    private VfrAirspace[] _airspaces = [];
    private string _dataSource = "synthetic fallback";

    public OpenAipService(HttpClient http, Microsoft.Extensions.Options.IOptions<OpenAipOptions> options,
        IVfrGeofenceService geofence, IWebHostEnvironment environment, ILogger<OpenAipService> logger)
    {
        _http = http;
        _options = options.Value;
        _geofence = geofence;
        _environment = environment;
        _logger = logger;
        _http.BaseAddress = new Uri("https://api.core.openaip.net/api/");
        _http.Timeout = TimeSpan.FromSeconds(15);
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("AERIS-VFR-Training/1.0");
        LoadLocalCache();
    }

    public IReadOnlyList<VfrReportingPoint> ReportingPoints => _geofence.ReportingPoints;
    public IReadOnlyList<VfrAirspace> Airspaces => Volatile.Read(ref _airspaces);
    public string DataSource => _dataSource;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await RefreshAsync(stoppingToken);
        using var timer = new PeriodicTimer(TimeSpan.FromHours(Math.Clamp(_options.RefreshHours, 1, 168)));
        while (await timer.WaitForNextTickAsync(stoppingToken)) await RefreshAsync(stoppingToken);
    }

    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(_options.ApiKey))
        {
            _logger.LogInformation("OpenAIP API key not configured; using local GeoJSON reporting-point cache.");
            LoadLocalCache();
            return;
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, $"reporting-points?country={Uri.EscapeDataString(_options.Country)}&limit=1000&page=1");
            request.Headers.Add("x-openaip-api-key", _options.ApiKey);
            using var response = await _http.SendAsync(request, cancellationToken);
            response.EnsureSuccessStatusCode();
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            var points = new List<VfrReportingPoint>();
            if (TryItems(doc.RootElement, out var items))
            foreach (var item in items.EnumerateArray())
            {
                if (!TryCoordinates(item, out var lat, out var lon)) continue;
                var name = StringProp(item, "name") ?? StringProp(item, "description") ?? "VFR reporting point";
                var id = StringProp(item, "id") ?? StringProp(item, "identifier") ?? name;
                var code = StringProp(item, "icaoCode") ?? StringProp(item, "code") ?? id;
                points.Add(new VfrReportingPoint(code, lat, lon, 926, name, "OpenAIP"));
            }
            if (points.Count > 0)
            {
                _geofence.ReplaceReportingPoints(points);
                _dataSource = "OpenAIP (CC BY-NC 4.0; attribution required)";
            }

            using var airspaceRequest = new HttpRequestMessage(HttpMethod.Get, $"airspaces?country={Uri.EscapeDataString(_options.Country)}&limit=1000&page=1");
            airspaceRequest.Headers.Add("x-openaip-api-key", _options.ApiKey);
            using var airspaceResponse = await _http.SendAsync(airspaceRequest, cancellationToken);
            airspaceResponse.EnsureSuccessStatusCode();
            using var airspaceDoc = JsonDocument.Parse(await airspaceResponse.Content.ReadAsStringAsync(cancellationToken));
            if (TryItems(airspaceDoc.RootElement, out var airspaceItems))
            {
                var airspaces = airspaceItems.EnumerateArray().Where(x => x.TryGetProperty("geometry", out _))
                    .Select(x => new VfrAirspace(StringProp(x, "id") ?? "", StringProp(x, "name") ?? "",
                        StringProp(x, "icaoClass") ?? StringProp(x, "type") ?? "", x.GetProperty("geometry").Clone())).ToArray();
                Volatile.Write(ref _airspaces, airspaces);
            }
            if (points.Count == 0) LoadLocalCache();
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or InvalidOperationException)
        {
            _logger.LogWarning(ex, "OpenAIP refresh failed; retaining local/cached reporting points.");
            if (ReportingPoints.Count == 0) LoadLocalCache();
        }
    }

    private void LoadLocalCache()
    {
        var path = Path.IsPathRooted(_options.LocalGeoJsonPath)
            ? _options.LocalGeoJsonPath : Path.Combine(_environment.ContentRootPath, _options.LocalGeoJsonPath);
        if (!File.Exists(path)) return;
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            if (!doc.RootElement.TryGetProperty("features", out var features) || features.ValueKind != JsonValueKind.Array) return;
            var points = new List<VfrReportingPoint>();
            var airspaces = new List<VfrAirspace>();
            foreach (var feature in features.EnumerateArray())
            {
                var props = feature.TryGetProperty("properties", out var p) ? p : default;
                var kind = StringProp(props, "kind") ?? "point";
                if (kind.Equals("airspace", StringComparison.OrdinalIgnoreCase))
                {
                    if (feature.TryGetProperty("geometry", out var geometry)) airspaces.Add(new VfrAirspace(StringProp(props, "code") ?? "", StringProp(props, "name") ?? "", StringProp(props, "class") ?? "", geometry.Clone()));
                    continue;
                }
                if (!feature.TryGetProperty("geometry", out var pointGeometry) || !TryCoordinatePair(pointGeometry, out var lat, out var lon)) continue;
                var code = StringProp(props, "code") ?? StringProp(props, "name") ?? $"VFR-{points.Count + 1}";
                var radius = props.ValueKind == JsonValueKind.Object && props.TryGetProperty("radiusMeters", out var r) && r.TryGetDouble(out var radiusValue) ? radiusValue : 926;
                points.Add(new VfrReportingPoint(code, lat, lon, radius, StringProp(props, "name") ?? code, "local GeoJSON"));
            }
            if (points.Count > 0) { _geofence.ReplaceReportingPoints(points); _dataSource = "local GeoJSON"; }
            Volatile.Write(ref _airspaces, airspaces.ToArray());
        }
        catch (Exception ex) when (ex is IOException or JsonException)
        {
            _logger.LogWarning(ex, "Cannot load VFR GeoJSON cache at {Path}.", path);
        }
    }

    private static bool TryItems(JsonElement root, out JsonElement items) => root.ValueKind == JsonValueKind.Array
        ? (items = root).ValueKind == JsonValueKind.Array
        : root.TryGetProperty("items", out items) && items.ValueKind == JsonValueKind.Array;

    private static string? StringProp(JsonElement obj, string name) => obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static bool TryCoordinates(JsonElement feature, out double lat, out double lon)
    {
        if (feature.TryGetProperty("geometry", out var geometry) && TryCoordinatePair(geometry, out lat, out lon)) return true;
        if (feature.TryGetProperty("position", out var position) && TryCoordinatePair(position, out lat, out lon)) return true;
        lat = lon = 0; return false;
    }

    private static bool TryCoordinatePair(JsonElement item, out double lat, out double lon)
    {
        var coordinates = item.ValueKind == JsonValueKind.Object && item.TryGetProperty("coordinates", out var c) ? c : item;
        if (coordinates.ValueKind == JsonValueKind.Array && coordinates.GetArrayLength() >= 2 && coordinates[0].TryGetDouble(out lon) && coordinates[1].TryGetDouble(out lat)) return true;
        if (item.ValueKind == JsonValueKind.Object && item.TryGetProperty("lat", out var la) && item.TryGetProperty("lon", out var lo) && la.TryGetDouble(out lat) && lo.TryGetDouble(out lon)) return true;
        lat = lon = 0; return false;
    }
}
