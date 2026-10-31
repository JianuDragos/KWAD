using Aeris.PlanningEngine.Models;
using System.Collections.Concurrent;

namespace Aeris.PlanningEngine.Services;

public class VfrGeofenceEngine : IVfrGeofenceService
{
    private const double AirportLat = 44.318056;
    private const double AirportLon = 23.888611;

    // Synthetic training points, aligned with the UI's existing VFR entry points.
    private static readonly VfrReportingPoint[] DefaultPoints =
    [
        Destination(AirportLat, AirportLon, 180, 12 * 1852, 926),
        Destination(AirportLat, AirportLon, 0, 12 * 1852, 926),
        Destination(AirportLat, AirportLon, 250, 12 * 1852, 926)
    ];

    private readonly HashSet<string> _inside = new(StringComparer.OrdinalIgnoreCase);
    private readonly object _sync = new();
    private readonly ConcurrentDictionary<string, VfrTrackState> _tracks = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, VfrFlightPlan> _flightPlans = new(StringComparer.OrdinalIgnoreCase);
    private VfrReportingPoint[] _points = DefaultPoints;

    public event Action<VfrPointEnteredEventArgs>? OnVfrPointEntered;
    public IReadOnlyList<VfrReportingPoint> ReportingPoints => Volatile.Read(ref _points);
    public IReadOnlyList<VfrTrackState> Tracks => _tracks.Values
        .Where(t => t.LastContactUtc >= DateTime.UtcNow.AddMinutes(-2))
        .OrderBy(t => t.Callsign).ToArray();
    public IReadOnlyList<VfrFlightPlan> FlightPlans => _flightPlans.Values.Where(p => p.ExpiresUtc > DateTime.UtcNow).ToArray();

    public void ReplaceReportingPoints(IEnumerable<VfrReportingPoint> points)
    {
        var valid = points.Where(p => !string.IsNullOrWhiteSpace(p.Code) && p.Lat is >= -90 and <= 90 && p.Long is >= -180 and <= 180 && p.RadiusMeters > 0).ToArray();
        if (valid.Length > 0) Volatile.Write(ref _points, valid);
    }

    public void UpsertTrack(VfrTrackState track)
    {
        if (track.LastContactUtc < DateTime.UtcNow.AddMinutes(-10)) return;
        var matchingPlan = FlightPlans.FirstOrDefault(p => p.Callsign.Equals(track.Callsign, StringComparison.OrdinalIgnoreCase));
        if (matchingPlan is not null) track = track with { CorrelatedFlightPlanId = matchingPlan.FlightPlanId, CorrelatedCallsign = matchingPlan.Callsign };
        _tracks.AddOrUpdate(track.FlightId, track, (_, old) => track.LastContactUtc >= old.LastContactUtc ? track : old);
    }

    public void RegisterFlightPlan(VfrFlightPlan flightPlan)
    {
        if (flightPlan.FlightRules is not (FlightRules.VFR or FlightRules.SVFR) || string.IsNullOrWhiteSpace(flightPlan.Callsign) || flightPlan.ExpiresUtc <= DateTime.UtcNow) return;
        _flightPlans[flightPlan.FlightPlanId] = flightPlan;
        foreach (var track in _tracks.Values.Where(t => t.Callsign.Equals(flightPlan.Callsign, StringComparison.OrdinalIgnoreCase)))
            _tracks[track.FlightId] = track with { CorrelatedFlightPlanId = flightPlan.FlightPlanId, CorrelatedCallsign = flightPlan.Callsign };
    }

    public bool TryCorrelate(string trackId, string flightPlanId, string callsign)
    {
        if (!_tracks.TryGetValue(trackId, out var track)) return false;
        _tracks[trackId] = track with { CorrelatedFlightPlanId = flightPlanId, CorrelatedCallsign = callsign };
        return true;
    }

    public IReadOnlyList<VfrTrackingState> Evaluate(LivePositionsResponse positions, MetarDecoded metar, string runway)
    {
        var vmc = VmcChecker.IsVmcValid(metar);
        var threshold = Destination(AirportLat, AirportLon, runway == "27" ? 88.93 : 268.93, 2500);
        var states = new List<VfrTrackingState>();
        var currentKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var flight in positions.Flights.Where(f => !f.OnGround && f.Latitude.HasValue && f.Longitude.HasValue && (f.FlightRules is FlightRules.VFR or FlightRules.SVFR)))
        {
            var state = new VfrTrackState(flight.Icao24, flight.Callsign, flight.Latitude!.Value, flight.Longitude!.Value,
                flight.BaroAltitudeMeters, flight.VelocityKnots, flight.TrueTrackDegrees, flight.Squawk, flight.FlightRules,
                VfrTrackSource.OpenSky, DateTimeOffset.FromUnixTimeSeconds(flight.LastContact).UtcDateTime);
            UpsertTrack(state);
        }

        foreach (var track in Tracks.Where(t => t.Source != VfrTrackSource.OpenSky && t.LastContactUtc >= DateTime.UtcNow.AddMinutes(-2)))
        {
            var nearestTrackPoint = ReportingPoints.Select(p => (Point: p, Distance: DistanceMeters(track.Latitude, track.Longitude, p.Lat, p.Long)))
                .OrderBy(x => x.Distance).FirstOrDefault();
            var speedMps = Math.Max(1, (track.GroundSpeedKnots ?? 0) / 1.94384);
            var remaining = nearestTrackPoint.Point is null ? 0 : nearestTrackPoint.Distance + DistanceMeters(nearestTrackPoint.Point.Lat, nearestTrackPoint.Point.Long, threshold.Lat, threshold.Lon);
            var key = $"{track.FlightId}:{nearestTrackPoint.Point?.Code ?? "DIRECT"}";
            if (nearestTrackPoint.Point is not null && nearestTrackPoint.Distance <= nearestTrackPoint.Point.RadiusMeters)
            {
                currentKeys.Add(key);
                bool entered;
                lock (_sync) entered = _inside.Add(key);
                if (entered) OnVfrPointEntered?.Invoke(new VfrPointEnteredEventArgs(track.FlightId, nearestTrackPoint.Point.Code, DateTime.UtcNow));
            }
            states.Add(new VfrTrackingState(track.FlightId, track.Callsign, nearestTrackPoint.Point?.Code ?? "DIRECT",
                Math.Round(nearestTrackPoint.Distance), Math.Round(remaining / speedMps / 60, 1), vmc,
                vmc ? VmcChecker.GetStatus(metar) : "VFR SUSPENDED — IMC"));
        }

        foreach (var flight in positions.Flights.Where(f => (f.FlightRules is FlightRules.VFR or FlightRules.SVFR) && !f.OnGround && f.Latitude.HasValue && f.Longitude.HasValue))
        {
            var nearest = ReportingPoints.Select(p => (Point: p, Distance: DistanceMeters(flight.Latitude!.Value, flight.Longitude!.Value, p.Lat, p.Long)))
                .OrderBy(x => x.Distance).First();
            var key = $"{flight.Icao24}:{nearest.Point.Code}";
            if (nearest.Distance <= nearest.Point.RadiusMeters)
            {
                currentKeys.Add(key);
                bool entered;
                lock (_sync) entered = _inside.Add(key);
                if (entered) OnVfrPointEntered?.Invoke(new VfrPointEnteredEventArgs(flight.Icao24, nearest.Point.Code, DateTime.UtcNow));
            }

            var speedMps = Math.Max(1, (flight.VelocityMs ?? 0));
            var distanceToPoint = nearest.Distance;
            var distanceViaPoint = distanceToPoint + DistanceMeters(nearest.Point.Lat, nearest.Point.Long, threshold.Lat, threshold.Lon);
            var eta = distanceViaPoint / speedMps / 60.0;
            states.Add(new VfrTrackingState(flight.Icao24, flight.Callsign, nearest.Point.Code,
                Math.Round(distanceToPoint), Math.Round(eta, 1), vmc,
                vmc ? VmcChecker.GetStatus(metar) : "VFR SUSPENDED — IMC"));
        }

        lock (_sync) _inside.IntersectWith(currentKeys);
        return states;
    }

    private static double DistanceMeters(double lat1, double lon1, double lat2, double lon2)
    {
        const double earth = 6371000;
        var dLat = DegreesToRadians(lat2 - lat1);
        var dLon = DegreesToRadians(lon2 - lon1);
        var a = Math.Pow(Math.Sin(dLat / 2), 2) + Math.Cos(DegreesToRadians(lat1)) * Math.Cos(DegreesToRadians(lat2)) * Math.Pow(Math.Sin(dLon / 2), 2);
        return 2 * earth * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }

    private static (double Lat, double Lon) Destination(double lat, double lon, double bearing, double distanceMeters)
    {
        const double earth = 6371000;
        var angular = distanceMeters / earth;
        var bearingRad = DegreesToRadians(bearing);
        var latRad = DegreesToRadians(lat);
        var lonRad = DegreesToRadians(lon);
        var targetLat = Math.Asin(Math.Sin(latRad) * Math.Cos(angular) + Math.Cos(latRad) * Math.Sin(angular) * Math.Cos(bearingRad));
        var targetLon = lonRad + Math.Atan2(Math.Sin(bearingRad) * Math.Sin(angular) * Math.Cos(latRad), Math.Cos(angular) - Math.Sin(latRad) * Math.Sin(targetLat));
        return (targetLat * 180 / Math.PI, targetLon * 180 / Math.PI);
    }

    private static VfrReportingPoint Destination(double lat, double lon, double bearing, double distanceMeters, double radiusMeters)
    {
        var point = Destination(lat, lon, bearing, distanceMeters);
        var code = bearing switch { 180 => "VFR-S", 0 => "VFR-N", _ => "VFR-W" };
        return new VfrReportingPoint(code, point.Lat, point.Lon, radiusMeters, code, "synthetic-training-fallback");
    }

    private static double DegreesToRadians(double degrees) => degrees * Math.PI / 180;
}

/// <summary>Compatibility alias for the existing service name.</summary>
public sealed class VfrGeofenceService : VfrGeofenceEngine { }
