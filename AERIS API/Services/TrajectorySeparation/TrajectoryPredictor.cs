using Aeris.PlanningEngine.Models;
using Aeris.PlanningEngine.Models.TrajectorySeparation;

namespace Aeris.PlanningEngine.Services.TrajectorySeparation;

/// <summary>
/// Motor de predicție a traiectoriilor 4D în spațiu și timp (latitudine, longitudine, altitudine, viteză, cap)
/// pe baza procedurilor AIP oficiale, sloturilor de aterizare, circuitelor de așteptare și ratărilor.
/// </summary>
public class TrajectoryPredictor
{
    private const double RolloutDistanceNm = 0.7; // Rulare pe pistă după touchdown

    /// <summary>
    /// Prezice traiectoria completă a unei aeronave care execută apropierea și aterizarea pe pista desemnată.
    /// </summary>
    public AircraftTrajectory PredictApproachTrajectory(
        CraiovaAircraft aircraft,
        string runwayId,
        double landingTimeSeconds,
        string? preferredIaf = null,
        double samplingIntervalSeconds = 2.0)
    {
        string rwy = RunwayConfiguration.Normalize(runwayId);
        var thr = rwy == RunwayConfiguration.Runway26 ? AipAirwayData.Thr26 : AipAirwayData.Thr08;

        List<AipAirwayData.WaypointInfo> routeFixes;

        if (aircraft.FlightRules == FlightRules.IFR)
        {
            string iaf = preferredIaf ?? "PEMOK";
            routeFixes = AipAirwayData.GetArrivalFixes(rwy, iaf);
        }
        else
        {
            // Rută VFR: Punct de intrare VFR -> Punct aliniere finală (3 NM de prag) -> Prag pistă
            routeFixes = GetVfrArrivalFixes(rwy, aircraft.Id);
        }

        // Calcul durată fiecare segment și timpii la puncte
        var legs = new List<(AipAirwayData.WaypointInfo From, AipAirwayData.WaypointInfo To, double DistanceNm, double SpeedKnots, double DurationSeconds)>();
        double baseSpeed = aircraft.SpeedKnots > 0 ? aircraft.SpeedKnots : (aircraft.FlightRules == FlightRules.IFR ? 180.0 : 90.0);

        for (int i = 0; i < routeFixes.Count - 1; i++)
        {
            var from = routeFixes[i];
            var to = routeFixes[i + 1];
            double dist = GeoMath.DistanceNm(from.Latitude, from.Longitude, to.Latitude, to.Longitude);
            
            // Profil viteză: mai mare la intrare, redusă pe finală
            double legSpeed = (i == routeFixes.Count - 2) ? Math.Min(baseSpeed, 140.0) : baseSpeed;
            double duration = (dist / legSpeed) * 3600.0;
            legs.Add((from, to, dist, legSpeed, duration));
        }

        // Lucrăm invers de la timpul de aterizare pentru a calcula timestamp-ul la fiecare fix
        var fixArrivalTimes = new double[routeFixes.Count];
        fixArrivalTimes[^1] = landingTimeSeconds;

        for (int i = legs.Count - 1; i >= 0; i--)
        {
            fixArrivalTimes[i] = fixArrivalTimes[i + 1] - legs[i].DurationSeconds;
        }

        var points = new List<TrajectoryPoint>();

        // Eșantionare de-a lungul segmentelor de apropiere
        for (int i = 0; i < legs.Count; i++)
        {
            var leg = legs[i];
            double tFrom = fixArrivalTimes[i];
            double tTo = fixArrivalTimes[i + 1];
            double heading = GeoMath.BearingDegrees(leg.From.Latitude, leg.From.Longitude, leg.To.Latitude, leg.To.Longitude);
            var phase = (i == legs.Count - 1) ? FlightPhase.Final : FlightPhase.Approach;

            for (double t = tFrom; t < tTo; t += samplingIntervalSeconds)
            {
                double fraction = (t - tFrom) / leg.DurationSeconds;
                double lat = leg.From.Latitude + (leg.To.Latitude - leg.From.Latitude) * fraction;
                double lon = leg.From.Longitude + (leg.To.Longitude - leg.From.Longitude) * fraction;
                double alt = leg.From.AltitudeFt + (leg.To.AltitudeFt - leg.From.AltitudeFt) * fraction;

                points.Add(new TrajectoryPoint(
                    TimeSeconds: t,
                    Latitude: lat,
                    Longitude: lon,
                    AltitudeFeet: alt,
                    SpeedKnots: leg.SpeedKnots,
                    HeadingDegrees: heading,
                    Phase: phase,
                    WaypointId: fraction < 0.05 ? leg.From.Id : null
                ));
            }
        }

        // Punctul exact de touchdown la pragul pistei
        points.Add(new TrajectoryPoint(
            TimeSeconds: landingTimeSeconds,
            Latitude: thr.Lat,
            Longitude: thr.Lon,
            AltitudeFeet: thr.AltFt,
            SpeedKnots: Math.Min(baseSpeed, 130.0),
            HeadingDegrees: thr.HeadingDeg,
            Phase: FlightPhase.LandingRollout,
            WaypointId: routeFixes[^1].Id
        ));

        // Rulare pe pistă (Rollout) până la viteza de degajare / eliberare pistă
        double rolloutDuration = aircraft.Category == AircraftCategory.CommercialJet ? 50.0 : 35.0;
        var (rolloutEndLat, rolloutEndLon) = GeoMath.Destination(thr.Lat, thr.Lon, thr.HeadingDeg, RolloutDistanceNm);

        for (double t = landingTimeSeconds + samplingIntervalSeconds; t <= landingTimeSeconds + rolloutDuration; t += samplingIntervalSeconds)
        {
            double f = (t - landingTimeSeconds) / rolloutDuration;
            double lat = thr.Lat + (rolloutEndLat - thr.Lat) * f;
            double lon = thr.Lon + (rolloutEndLon - thr.Lon) * f;
            double speed = Math.Max(20.0, 120.0 * (1.0 - f));

            points.Add(new TrajectoryPoint(
                TimeSeconds: t,
                Latitude: lat,
                Longitude: lon,
                AltitudeFeet: thr.AltFt,
                SpeedKnots: speed,
                HeadingDegrees: thr.HeadingDeg,
                Phase: FlightPhase.LandingRollout,
                WaypointId: f >= 0.95 ? "VACATED" : null
            ));
        }

        return new AircraftTrajectory(
            AircraftId: aircraft.Id,
            Callsign: aircraft.Callsign,
            FlightRules: aircraft.FlightRules,
            Category: aircraft.Category,
            Points: points
        );
    }

    /// <summary>
    /// Prezice traiectoria în circuitul de așteptare de tip hipodrom (Racetrack holding).
    /// </summary>
    public AircraftTrajectory PredictHoldingTrajectory(
        CraiovaAircraft aircraft,
        HoldingRacetrackConfig config,
        double samplingIntervalSeconds = 2.0)
    {
        var points = RacetrackGenerator.Generate(config, samplingIntervalSeconds);

        return new AircraftTrajectory(
            AircraftId: aircraft.Id,
            Callsign: aircraft.Callsign,
            FlightRules: aircraft.FlightRules,
            Category: aircraft.Category,
            Points: points
        );
    }

    /// <summary>
    /// Prezice traiectoria de ratare a aterizării (Missed Approach / Go-Around) conform procedurii publicate în AIP.
    /// </summary>
    public AircraftTrajectory PredictMissedApproachTrajectory(
        CraiovaAircraft aircraft,
        string runwayId,
        double initiationTimeSeconds,
        double samplingIntervalSeconds = 2.0)
    {
        string rwy = RunwayConfiguration.Normalize(runwayId);
        var maFixes = AipAirwayData.GetMissedApproachFixes(rwy);
        double speed = aircraft.SpeedKnots > 0 ? aircraft.SpeedKnots : 180.0;
        double currentTime = initiationTimeSeconds;

        var points = new List<TrajectoryPoint>();

        for (int i = 0; i < maFixes.Count - 1; i++)
        {
            var from = maFixes[i];
            var to = maFixes[i + 1];
            double dist = GeoMath.DistanceNm(from.Latitude, from.Longitude, to.Latitude, to.Longitude);
            double duration = (dist / speed) * 3600.0;
            double heading = GeoMath.BearingDegrees(from.Latitude, from.Longitude, to.Latitude, to.Longitude);

            for (double t = currentTime; t < currentTime + duration; t += samplingIntervalSeconds)
            {
                double f = (t - currentTime) / duration;
                double lat = from.Latitude + (to.Latitude - from.Latitude) * f;
                double lon = from.Longitude + (to.Longitude - from.Longitude) * f;
                double alt = from.AltitudeFt + (to.AltitudeFt - from.AltitudeFt) * f;

                points.Add(new TrajectoryPoint(
                    TimeSeconds: t,
                    Latitude: lat,
                    Longitude: lon,
                    AltitudeFeet: alt,
                    SpeedKnots: speed,
                    HeadingDegrees: heading,
                    Phase: FlightPhase.MissedApproach,
                    WaypointId: f < 0.05 ? from.Id : null
                ));
            }

            currentTime += duration;
        }

        var last = maFixes[^1];
        points.Add(new TrajectoryPoint(
            TimeSeconds: currentTime,
            Latitude: last.Latitude,
            Longitude: last.Longitude,
            AltitudeFeet: last.AltitudeFt,
            SpeedKnots: speed,
            HeadingDegrees: 0,
            Phase: FlightPhase.Holding,
            WaypointId: last.Id
        ));

        return new AircraftTrajectory(
            AircraftId: aircraft.Id,
            Callsign: aircraft.Callsign,
            FlightRules: aircraft.FlightRules,
            Category: aircraft.Category,
            Points: points
        );
    }

    private static List<AipAirwayData.WaypointInfo> GetVfrArrivalFixes(string runwayId, string aircraftId)
    {
        string rwy = RunwayConfiguration.Normalize(runwayId);
        var thr = rwy == RunwayConfiguration.Runway26 ? AipAirwayData.Thr26 : AipAirwayData.Thr08;

        // Selectăm punct de intrare VFR în funcție de hash-ul aeronavei (distribuție realistă între VFR-S, VFR-N, VFR-W)
        int hash = Math.Abs(aircraftId.GetHashCode());
        string entryId = (hash % 3) switch
        {
            0 => "VFR-S",
            1 => "VFR-N",
            _ => "VFR-W"
        };

        var entry = AipAirwayData.Waypoints[entryId];
        
        // Punct de aliniere finală la 3 NM de prag pe axul reciproc
        double reciprocalHeading = (thr.HeadingDeg + 180.0) % 360.0;
        var (joinLat, joinLon) = GeoMath.Destination(thr.Lat, thr.Lon, reciprocalHeading, 3.0);
        var finalJoin = new AipAirwayData.WaypointInfo($"F{rwy}-3NM", joinLat, joinLon, 1000.0, "VFR Final Join");

        var thrWp = new AipAirwayData.WaypointInfo($"THR{rwy}", thr.Lat, thr.Lon, thr.AltFt, "Threshold");

        return new List<AipAirwayData.WaypointInfo> { entry, finalJoin, thrWp };
    }
}
