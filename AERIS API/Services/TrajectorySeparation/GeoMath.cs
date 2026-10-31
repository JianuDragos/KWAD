namespace Aeris.PlanningEngine.Services.TrajectorySeparation;

/// <summary>
/// Calcule geodezice sferice WGS-84 (Haversine, azimut direct și destinație la distanță).
/// </summary>
public static class GeoMath
{
    private const double EarthRadiusNm = 3440.065; // Raza Pământului în mile marine (6371 km)
    private const double DegToRad = Math.PI / 180.0;
    private const double RadToDeg = 180.0 / Math.PI;

    /// <summary>
    /// Calculează distanța pe cerc mare între două puncte geografice în mile marine (NM).
    /// </summary>
    public static double DistanceNm(double lat1, double lon1, double lat2, double lon2)
    {
        double phi1 = lat1 * DegToRad;
        double phi2 = lat2 * DegToRad;
        double deltaPhi = (lat2 - lat1) * DegToRad;
        double deltaLambda = (lon2 - lon1) * DegToRad;

        double a = Math.Sin(deltaPhi / 2.0) * Math.Sin(deltaPhi / 2.0) +
                   Math.Cos(phi1) * Math.Cos(phi2) *
                   Math.Sin(deltaLambda / 2.0) * Math.Sin(deltaLambda / 2.0);

        double c = 2.0 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1.0 - a));
        return EarthRadiusNm * c;
    }

    /// <summary>
    /// Calculează azimutul inițial (bearing) de la punctul 1 la punctul 2 în grade [0, 360).
    /// </summary>
    public static double BearingDegrees(double lat1, double lon1, double lat2, double lon2)
    {
        double phi1 = lat1 * DegToRad;
        double phi2 = lat2 * DegToRad;
        double deltaLambda = (lon2 - lon1) * DegToRad;

        double y = Math.Sin(deltaLambda) * Math.Cos(phi2);
        double x = Math.Cos(phi1) * Math.Sin(phi2) -
                   Math.Sin(phi1) * Math.Cos(phi2) * Math.Cos(deltaLambda);

        double bearing = Math.Atan2(y, x) * RadToDeg;
        return (bearing + 360.0) % 360.0;
    }

    /// <summary>
    /// Calculează coordonatele punctului de destinație deplasat din (lat, lon) pe azimutul bearingDeg la distanța distanceNm.
    /// </summary>
    public static (double Latitude, double Longitude) Destination(double lat, double lon, double bearingDeg, double distanceNm)
    {
        double delta = distanceNm / EarthRadiusNm;
        double theta = bearingDeg * DegToRad;
        double phi1 = lat * DegToRad;
        double lambda1 = lon * DegToRad;

        double sinPhi2 = Math.Sin(phi1) * Math.Cos(delta) +
                         Math.Cos(phi1) * Math.Sin(delta) * Math.Cos(theta);
        double phi2 = Math.Asin(sinPhi2);

        double y = Math.Sin(theta) * Math.Sin(delta) * Math.Cos(phi1);
        double x = Math.Cos(delta) - Math.Sin(phi1) * sinPhi2;
        double lambda2 = lambda1 + Math.Atan2(y, x);

        double latOut = phi2 * RadToDeg;
        double lonOut = (lambda2 * RadToDeg + 540.0) % 360.0 - 180.0;

        return (latOut, lonOut);
    }
}
