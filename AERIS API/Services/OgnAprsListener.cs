using System.Globalization;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using Aeris.PlanningEngine.Models;
using Microsoft.Extensions.Options;

namespace Aeris.PlanningEngine.Services;

public sealed class OgnAprsOptions
{
    public bool Enabled { get; set; }
    public string Host { get; set; } = "aprs.glidernet.org";
    public int Port { get; set; } = 14580;
    public string Callsign { get; set; } = "AERIS";
    public double CenterLat { get; set; } = 44.318056;
    public double CenterLon { get; set; } = 23.888611;
    public int RadiusKm { get; set; } = 60;
}

/// <summary>Optional OGN APRS-IS read-only listener. Public community feed; coverage depends on nearby receivers.</summary>
public sealed class OgnAprsListener : BackgroundService
{
    private readonly OgnAprsOptions _options;
    private readonly IVfrGeofenceService _store;
    private readonly ILogger<OgnAprsListener> _logger;
    private static readonly Regex Position = new(@"(?<lat>\d{4}\.\d{2})(?<ns>[NS])(?<table>[!/])(?<lon>\d{5}\.\d{2})(?<ew>[EW])(?<symbol>.)(?<course>\d{3})/(?<speed>\d{3})", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex Altitude = new(@"/A=(?<alt>\d{6})", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public OgnAprsListener(IOptions<OgnAprsOptions> options, IVfrGeofenceService store, ILogger<OgnAprsListener> logger)
    { _options = options.Value; _store = store; _logger = logger; }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.Enabled) { _logger.LogInformation("OGN APRS listener disabled; set OGN:Enabled=true to connect."); return; }
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await ReceiveSessionAsync(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { _logger.LogWarning(ex, "OGN APRS feed disconnected; retrying in 10 seconds."); }
            try { await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task ReceiveSessionAsync(CancellationToken token)
    {
        using var client = new TcpClient();
        await client.ConnectAsync(_options.Host, _options.Port, token);
        using var stream = client.GetStream();
        using var reader = new StreamReader(stream, Encoding.ASCII);
        var login = $"user {_options.Callsign} pass -1 vers AERIS 1.0 filter r/{_options.CenterLat.ToString(CultureInfo.InvariantCulture)}/{_options.CenterLon.ToString(CultureInfo.InvariantCulture)}/{Math.Clamp(_options.RadiusKm, 1, 250)}\r\n";
        await stream.WriteAsync(Encoding.ASCII.GetBytes(login), token);
        _logger.LogInformation("Connected to OGN APRS-IS {Host}:{Port}, radius {Radius} km.", _options.Host, _options.Port, _options.RadiusKm);

        while (!token.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(token);
            if (line is null) break;
            var track = Parse(line);
            if (track is not null) _store.UpsertTrack(track);
        }
    }

    public static VfrTrackState? Parse(string line)
    {
        var separator = line.IndexOf('>');
        var colon = line.IndexOf(':');
        if (separator <= 0 || colon <= separator) return null;
        var callsign = line[..separator].Trim();
        var payload = line[(colon + 1)..];
        var match = Position.Match(payload);
        if (!match.Success || !double.TryParse(match.Groups["lat"].Value, CultureInfo.InvariantCulture, out var latRaw) || !double.TryParse(match.Groups["lon"].Value, CultureInfo.InvariantCulture, out var lonRaw)) return null;
        var lat = Math.Floor(latRaw / 100) + latRaw % 100 / 60;
        var lon = Math.Floor(lonRaw / 100) + lonRaw % 100 / 60;
        if (match.Groups["ns"].Value == "S") lat = -lat;
        if (match.Groups["ew"].Value == "W") lon = -lon;
        double? course = double.TryParse(match.Groups["course"].Value, out var c) ? c : null;
        double? speedKnots = double.TryParse(match.Groups["speed"].Value, out var s) ? s : null;
        var altMatch = Altitude.Match(payload);
        double? altitude = altMatch.Success && double.TryParse(altMatch.Groups["alt"].Value, out var alt) ? alt * 0.3048 : null;
        return new VfrTrackState($"OGN:{callsign}", callsign, lat, lon, altitude, speedKnots, course, null,
            FlightRules.VFR, VfrTrackSource.OgnAprs, DateTime.UtcNow);
    }
}
