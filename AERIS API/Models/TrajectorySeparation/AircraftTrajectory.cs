namespace Aeris.PlanningEngine.Models.TrajectorySeparation;

/// <summary>
/// Traiectoria 4D completă prezisă pentru o aeronavă.
/// </summary>
public record AircraftTrajectory(
    string AircraftId,
    string Callsign,
    FlightRules FlightRules,
    AircraftCategory Category,
    List<TrajectoryPoint> Points
)
{
    public WakeCategory WakeCategory => Category switch
    {
        AircraftCategory.CommercialJet => WakeCategory.Medium,
        AircraftCategory.RegionalTurboprop => WakeCategory.Medium,
        AircraftCategory.GeneralAviation => WakeCategory.Light,
        AircraftCategory.UltralightAndGlider => WakeCategory.Light,
        _ => WakeCategory.Light
    };

    public double? StartTimeSeconds => Points.Count > 0 ? Points[0].TimeSeconds : null;
    public double? EndTimeSeconds => Points.Count > 0 ? Points[^1].TimeSeconds : null;

    /// <summary>
    /// Obține starea interpolată la timpul t. Returnează null dacă t este în afara domeniului traiectoriei.
    /// </summary>
    public TrajectoryPoint? GetPositionAt(double t)
    {
        if (Points.Count == 0 || t < Points[0].TimeSeconds || t > Points[^1].TimeSeconds)
            return null;

        int lo = 0;
        int hi = Points.Count - 1;

        while (hi - lo > 1)
        {
            int mid = (lo + hi) / 2;
            if (Points[mid].TimeSeconds <= t)
                lo = mid;
            else
                hi = mid;
        }

        var pA = Points[lo];
        var pB = Points[hi];
        double dt = pB.TimeSeconds - pA.TimeSeconds;

        if (dt <= 0.0001)
            return pA;

        double fraction = (t - pA.TimeSeconds) / dt;

        double lat = pA.Latitude + (pB.Latitude - pA.Latitude) * fraction;
        double lon = pA.Longitude + (pB.Longitude - pA.Longitude) * fraction;
        double alt = pA.AltitudeFeet + (pB.AltitudeFeet - pA.AltitudeFeet) * fraction;
        double speed = pA.SpeedKnots + (pB.SpeedKnots - pA.SpeedKnots) * fraction;
        double heading = pA.HeadingDegrees;

        // Dacă există mișcare între puncte, calculăm azimutul
        if (Math.Abs(pB.Latitude - pA.Latitude) > 1e-6 || Math.Abs(pB.Longitude - pA.Longitude) > 1e-6)
        {
            heading = CalculateBearing(pA.Latitude, pA.Longitude, pB.Latitude, pB.Longitude);
        }

        return new TrajectoryPoint(
            TimeSeconds: t,
            Latitude: lat,
            Longitude: lon,
            AltitudeFeet: alt,
            SpeedKnots: speed,
            HeadingDegrees: heading,
            Phase: fraction > 0.5 ? pB.Phase : pA.Phase,
            WaypointId: fraction < 0.1 ? pA.WaypointId : (fraction > 0.9 ? pB.WaypointId : null)
        );
    }

    private static double CalculateBearing(double lat1, double lon1, double lat2, double lon2)
    {
        double r = Math.PI / 180.0;
        double phi1 = lat1 * r;
        double phi2 = lat2 * r;
        double deltaLambda = (lon2 - lon1) * r;

        double y = Math.Sin(deltaLambda) * Math.Cos(phi2);
        double x = Math.Cos(phi1) * Math.Sin(phi2) - Math.Sin(phi1) * Math.Cos(phi2) * Math.Cos(deltaLambda);

        return (Math.Atan2(y, x) * 180.0 / Math.PI + 360.0) % 360.0;
    }
}
