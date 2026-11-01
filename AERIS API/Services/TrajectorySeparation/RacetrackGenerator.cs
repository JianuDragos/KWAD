using Aeris.PlanningEngine.Models.TrajectorySeparation;

namespace Aeris.PlanningEngine.Services.TrajectorySeparation;

/// <summary>
/// Generator de circuite standard de așteptare de tip hipodrom (ICAO Racetrack Holding Pattern).
/// Înlocuiește cercurile arbitrare prin trasee aeronautice standard compuse din:
/// - Punct fix de referință (Holding Fix)
/// - Viraj 1 (180° viraj de rată 1 / 3° pe secundă, 60s)
/// - Ramură de îndepărtare (Outbound Leg, 60s)
/// - Viraj 2 (180° viraj de rată 1 / 3° pe secundă, 60s)
/// - Ramură de apropiere (Inbound Leg spre Fix, 60s)
/// </summary>
public static class RacetrackGenerator
{
    private const double StandardTurnRateDegPerSec = 3.0; // Rata 1: 3 grade/secundă (180° în 60s)
    private const double TurnDurationSeconds = 60.0;

    /// <summary>
    /// Generează o listă de puncte de traiectorie corespunzătoare circuitului de hipodrom.
    /// </summary>
    public static List<TrajectoryPoint> Generate(HoldingRacetrackConfig config, double samplingIntervalSeconds = 2.0)
    {
        var points = new List<TrajectoryPoint>();
        bool isRightTurn = !string.Equals(config.TurnDirection, "Left", StringComparison.OrdinalIgnoreCase);

        double speedNmPerSec = config.SpeedKnots / 3600.0;
        // Raza virajului de rată 1: R = V / (60 * pi) NM
        double turnRadiusNm = Math.Max(0.4, config.SpeedKnots / (60.0 * Math.PI));
        double outboundLegDistanceNm = speedNmPerSec * config.LegDurationSeconds;
        double inboundCourse = (config.InboundHeadingDegrees % 360.0 + 360.0) % 360.0;
        double outboundCourse = (inboundCourse + 180.0) % 360.0;

        // Centrul virajului 1 (la 90° la dreapta sau la stânga față de azimutul de sosire)
        double turn1CenterBearing = isRightTurn ? (inboundCourse + 90.0) % 360.0 : (inboundCourse - 90.0 + 360.0) % 360.0;
        var (turn1CenterLat, turn1CenterLon) = GeoMath.Destination(config.FixLatitude, config.FixLongitude, turn1CenterBearing, turnRadiusNm);

        // Capătul ramurii de îndepărtare
        double turnSideBearing = isRightTurn ? (inboundCourse + 90.0) % 360.0 : (inboundCourse - 90.0 + 360.0) % 360.0;
        var (outboundStartLat, outboundStartLon) = GeoMath.Destination(config.FixLatitude, config.FixLongitude, turnSideBearing, 2.0 * turnRadiusNm);
        var (outboundEndLat, outboundEndLon) = GeoMath.Destination(outboundStartLat, outboundStartLon, outboundCourse, outboundLegDistanceNm);

        // Centrul virajului 2
        double turn2CenterBearing = isRightTurn ? (outboundCourse + 90.0) % 360.0 : (outboundCourse - 90.0 + 360.0) % 360.0;
        var (turn2CenterLat, turn2CenterLon) = GeoMath.Destination(outboundEndLat, outboundEndLon, turn2CenterBearing, turnRadiusNm);

        // Începutul ramurii de apropiere (inbound start)
        var (inboundStartLat, inboundStartLon) = GeoMath.Destination(config.FixLatitude, config.FixLongitude, outboundCourse, outboundLegDistanceNm);

        double lapDurationSeconds = (TurnDurationSeconds * 2.0) + (config.LegDurationSeconds * 2.0);
        double totalDuration = Math.Max(lapDurationSeconds, config.DurationSeconds);
        double tStart = config.EntryTimeSeconds;
        double tEnd = tStart + totalDuration;

        for (double t = tStart; t <= tEnd; t += samplingIntervalSeconds)
        {
            double elapsedInLap = (t - tStart) % lapDurationSeconds;
            double currentLat, currentLon, currentHeading;

            if (elapsedInLap < TurnDurationSeconds)
            {
                // FAZA 1: Viraj 1 (180° de la inboundCourse la outboundCourse)
                double turnFraction = elapsedInLap / TurnDurationSeconds;
                double sweepAngle = turnFraction * 180.0;
                double currentBearing = isRightTurn
                    ? (turn1CenterBearing + 180.0 + sweepAngle) % 360.0
                    : (turn1CenterBearing + 180.0 - sweepAngle + 360.0) % 360.0;

                (currentLat, currentLon) = GeoMath.Destination(turn1CenterLat, turn1CenterLon, currentBearing, turnRadiusNm);
                currentHeading = isRightTurn
                    ? (inboundCourse + sweepAngle) % 360.0
                    : (inboundCourse - sweepAngle + 360.0) % 360.0;
            }
            else if (elapsedInLap < TurnDurationSeconds + config.LegDurationSeconds)
            {
                // FAZA 2: Ramură de îndepărtare (Outbound Leg pe capul outboundCourse)
                double legElapsed = elapsedInLap - TurnDurationSeconds;
                double legFraction = legElapsed / config.LegDurationSeconds;
                double distanceOnLeg = legFraction * outboundLegDistanceNm;

                (currentLat, currentLon) = GeoMath.Destination(outboundStartLat, outboundStartLon, outboundCourse, distanceOnLeg);
                currentHeading = outboundCourse;
            }
            else if (elapsedInLap < (TurnDurationSeconds * 2.0) + config.LegDurationSeconds)
            {
                // FAZA 3: Viraj 2 (180° de la outboundCourse înapoi la inboundCourse)
                double turnElapsed = elapsedInLap - (TurnDurationSeconds + config.LegDurationSeconds);
                double turnFraction = turnElapsed / TurnDurationSeconds;
                double sweepAngle = turnFraction * 180.0;
                double currentBearing = isRightTurn
                    ? (turn2CenterBearing + 180.0 + sweepAngle) % 360.0
                    : (turn2CenterBearing + 180.0 - sweepAngle + 360.0) % 360.0;

                (currentLat, currentLon) = GeoMath.Destination(turn2CenterLat, turn2CenterLon, currentBearing, turnRadiusNm);
                currentHeading = isRightTurn
                    ? (outboundCourse + sweepAngle) % 360.0
                    : (outboundCourse - sweepAngle + 360.0) % 360.0;
            }
            else
            {
                // FAZA 4: Ramură de apropiere (Inbound Leg spre Fix pe capul inboundCourse)
                double legElapsed = elapsedInLap - (TurnDurationSeconds * 2.0 + config.LegDurationSeconds);
                double legFraction = legElapsed / config.LegDurationSeconds;
                double distanceOnLeg = legFraction * outboundLegDistanceNm;

                (currentLat, currentLon) = GeoMath.Destination(inboundStartLat, inboundStartLon, inboundCourse, distanceOnLeg);
                currentHeading = inboundCourse;
            }

            points.Add(new TrajectoryPoint(
                TimeSeconds: t,
                Latitude: currentLat,
                Longitude: currentLon,
                AltitudeFeet: config.AltitudeFeet,
                SpeedKnots: config.SpeedKnots,
                HeadingDegrees: currentHeading,
                Phase: FlightPhase.Holding,
                WaypointId: elapsedInLap < 2.0 ? config.FixId : null
            ));
        }

        return points;
    }
}
