using Aeris.PlanningEngine.Models;

namespace Aeris.PlanningEngine.Services.TrajectorySeparation;

/// <summary>
/// Date oficiale de navigație aeriană pentru Aeroportul Craiova (LRCV) conform AIP România (AIRAC).
/// </summary>
public static class AipAirwayData
{
    public static readonly (double Lat, double Lon) Arp = (44.318056, 23.888611);
    public const double ElevationFt = 628.0;

    public static readonly (double Lat, double Lon, double AltFt, double HeadingDeg) Thr08 =
        (RunwayConfiguration.Threshold08Latitude, RunwayConfiguration.Threshold08Longitude, RunwayConfiguration.Runway08ElevationFt, RunwayConfiguration.Runway08TrueBearingDeg);

    public static readonly (double Lat, double Lon, double AltFt, double HeadingDeg) Thr26 =
        (RunwayConfiguration.Threshold26Latitude, RunwayConfiguration.Threshold26Longitude, RunwayConfiguration.Runway26ElevationFt, RunwayConfiguration.Runway26TrueBearingDeg);

    public static readonly (double Lat, double Lon, double AltFt, double HeadingDeg) Thr09 = Thr08;
    public static readonly (double Lat, double Lon, double AltFt, double HeadingDeg) Thr27 = Thr26;

    public record WaypointInfo(string Id, double Latitude, double Longitude, double AltitudeFt, string Role);

    public static readonly Dictionary<string, WaypointInfo> Waypoints = new()
    {
        ["TITEK"] = new("TITEK", 44.493278, 23.573861, 6000, "IAF"),
        ["PEMOK"] = new("PEMOK", 44.364694, 24.348472, 5000, "IAF"),
        ["PANZU"] = new("PANZU", 44.036667, 24.136944, 6000, "IAF"),
        ["OZZET"] = new("OZZET", 44.321611, 24.176917, 2500, "IF RWY26"),
        ["CV508"] = new("CV508", 44.320028, 24.037639, 2500, "FAF RWY26"),
        ["SDF"]   = new("SDF",   44.318944, 23.950611, 1500, "SDF RWY26"),
        ["CV514"] = new("CV514", 44.421611, 24.174806, 4000, "WP"),
        ["CV516"] = new("CV516", 44.221639, 24.179000, 2500, "WP"),
        ["CV518"] = new("CV518", 44.315750, 23.718528, 2000, "MA RWY26"),
        ["CV520"] = new("CV520", 44.418583, 23.920222, 4000, "WP"),
        ["NECCO"] = new("NECCO", 44.314306, 23.623944, 2500, "IF RWY08"),
        ["CV408"] = new("CV408", 44.316083, 23.740000, 2500, "FAF RWY08"),
        ["CV412"] = new("CV412", 44.414278, 23.620917, 4000, "WP"),
        ["CV414"] = new("CV414", 44.214333, 23.627000, 2500, "WP"),
        ["CV420"] = new("CV420", 44.320278, 24.058556, 2000, "MA RWY08"),
        ["LRCW"]  = new("LRCW",  44.286389, 23.791111, 450,  "Craiova-Sud AIP"),
        ["VFR-S"] = new("VFR-S", 44.118056, 23.888611, 1500, "VFR South Entry"),
        ["VFR-N"] = new("VFR-N", 44.518056, 23.888611, 1500, "VFR North Entry"),
        ["VFR-W"] = new("VFR-W", 44.249453, 23.626749, 1500, "VFR West Entry")
    };

    /// <summary>
    /// Returnează secvența oficială de waypoint-uri de la IAF până la prag pentru pista solicitată.
    /// </summary>
    public static List<WaypointInfo> GetArrivalFixes(string runwayId, string iafId)
    {
        string rwy = RunwayConfiguration.Normalize(runwayId);
        var result = new List<WaypointInfo>();

        if (rwy == RunwayConfiguration.Runway26)
        {
            if (iafId == "PEMOK")
                AddFixes(result, "PEMOK", "OZZET", "CV508");
            else if (iafId == "PANZU")
                AddFixes(result, "PANZU", "CV516", "OZZET", "CV508");
            else // TITEK
                AddFixes(result, "TITEK", "CV520", "CV514", "OZZET", "CV508");

            result.Add(new WaypointInfo("THR26", Thr26.Lat, Thr26.Lon, Thr26.AltFt, "Threshold 26"));
        }
        else
        {
            if (iafId == "PEMOK")
                AddFixes(result, "PEMOK", "CV514", "CV520", "CV412", "NECCO", "CV408");
            else if (iafId == "PANZU")
                AddFixes(result, "PANZU", "CV414", "NECCO", "CV408");
            else // TITEK
                AddFixes(result, "TITEK", "CV412", "NECCO", "CV408");

            result.Add(new WaypointInfo("THR08", Thr08.Lat, Thr08.Lon, Thr08.AltFt, "Threshold 08"));
        }

        return result;
    }

    /// <summary>
    /// Procedura oficială de ratare a aterizării (Missed Approach Procedure) conform AIP România.
    /// RWY 26 (27): Urcare pe ax până la CV518, viraj dreapta la CV520, CV514, OZZET la 4.000 ft.
    /// RWY 08 (09): Urcare pe ax până la CV420, viraj stânga la CV520, CV412, NECCO la 4.000 ft.
    /// </summary>
    public static List<WaypointInfo> GetMissedApproachFixes(string runwayId)
    {
        string rwy = RunwayConfiguration.Normalize(runwayId);
        var result = new List<WaypointInfo>();

        if (rwy == RunwayConfiguration.Runway26)
        {
            result.Add(new WaypointInfo("THR26", Thr26.Lat, Thr26.Lon, Thr26.AltFt, "Missed Approach Point"));
            AddFixes(result, "CV518", "CV520", "CV514", "OZZET");
        }
        else
        {
            result.Add(new WaypointInfo("THR08", Thr08.Lat, Thr08.Lon, Thr08.AltFt, "Missed Approach Point"));
            AddFixes(result, "CV420", "CV520", "CV412", "NECCO");
        }

        return result;
    }

    private static void AddFixes(List<WaypointInfo> list, params string[] ids)
    {
        foreach (var id in ids)
        {
            if (Waypoints.TryGetValue(id, out var wp))
                list.Add(wp);
        }
    }
}
