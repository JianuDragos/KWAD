using System.Globalization;
using System.Net.Sockets;
using Aeris.PlanningEngine.Models;
using Microsoft.Extensions.Options;

namespace Aeris.PlanningEngine.Services;

public sealed class Sbs1Options
{
    public bool Enabled { get; set; }
    public string Host { get; set; } = "127.0.0.1";
    public int Port { get; set; } = 30003;
}

/// <summary>Optional read-only SBS-1 TCP input for a local dump1090/readsb receiver.</summary>
public sealed class Sbs1Listener : BackgroundService
{
    private readonly Sbs1Options _options;
    private readonly IVfrGeofenceService _store;
    private readonly ILogger<Sbs1Listener> _logger;
    public Sbs1Listener(IOptions<Sbs1Options> options, IVfrGeofenceService store, ILogger<Sbs1Listener> logger) { _options = options.Value; _store = store; _logger = logger; }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.Enabled) { _logger.LogInformation("SBS-1 listener disabled; configure SBS1:Enabled=true for a local receiver."); return; }
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await ReceiveAsync(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { _logger.LogWarning(ex, "SBS-1 receiver disconnected; retrying in 5 seconds."); }
            try { await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken); } catch (OperationCanceledException) { break; }
        }
    }

    private async Task ReceiveAsync(CancellationToken token)
    {
        using var client = new TcpClient();
        await client.ConnectAsync(_options.Host, _options.Port, token);
        using var reader = new StreamReader(client.GetStream());
        _logger.LogInformation("Connected to SBS-1 receiver {Host}:{Port}.", _options.Host, _options.Port);
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
        var f = line.Split(',');
        if (f.Length < 22 || !f[0].StartsWith("MSG", StringComparison.Ordinal)) return null;
        var onGround = f[21].Trim() is "1" or "true" or "True";
        if (onGround) return null;
        var hex = f[4].Trim();
        if (hex.Length == 0 || !double.TryParse(f[14], NumberStyles.Float, CultureInfo.InvariantCulture, out var lat) || !double.TryParse(f[15], NumberStyles.Float, CultureInfo.InvariantCulture, out var lon)) return null;
        double? number(int i) => double.TryParse(f[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : null;
        var callsign = f[10].Trim();
        if (callsign.Length == 0) callsign = hex.ToUpperInvariant();
        var squawk = f[17].Trim();
        var rules = squawk switch { "1200" or "7000" => FlightRules.VFR, _ => FlightRules.IFR };
        var altitudeFeet = number(11);
        return new VfrTrackState($"SBS:{hex}", callsign, lat, lon, altitudeFeet * 0.3048,
            number(12), number(13), squawk, rules, VfrTrackSource.Sbs1, DateTime.UtcNow);
    }
}
