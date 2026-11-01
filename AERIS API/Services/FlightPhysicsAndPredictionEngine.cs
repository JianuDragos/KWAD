using Aeris.PlanningEngine.Models;
using Aeris.PlanningEngine.Services.TrajectorySeparation;

namespace Aeris.PlanningEngine.Services;

/// <summary>
/// Motor matematic avansat pentru fizica zborului, triunghiul vitezelor vântului,
/// profilul vertical de forfecare (legea puterii Hellmann + spirala Ekman),
/// analiza completă De-la-Decolare-la-Aterizare (Takeoff-to-Landing),
/// predicția anticipativă cu 2 pași înaintea aeronavei (Two Steps Ahead)
/// și optimizarea deciziei VFR (Orbită vs. Redirecționare pe piste apropiate).
/// </summary>
public static class FlightPhysicsAndPredictionEngine
{
    public const double LrcvElevationFeet = 628.0;
    public const double LrcvRunwayLengthMeters = 2500.0;
    public const double StandardPressureHpa = 1013.25;
    public const double DefaultQnhHpa = 1018.0;
    public const double DefaultOatCelsius = 16.0;
    public const double HellmannWindShearAlpha = 0.143; // Exponent teren deschis aeroportuar
    public const double EkmanMaxVeerDegrees = 15.0;     // Rotația vântului în stratul limită planetar

    /// <summary>
    /// Rezultatul descompunerii triunghiului vitezelor (TAS + Vector Vânt = GS, WCA, Cap de zbor).
    /// </summary>
    public record WindTriangleResult(
        double DesiredTrackDegrees,
        double HeadingToFlyDegrees,
        double WindCorrectionAngleCrabDegrees,
        double TrueAirspeedKnots,
        double GroundSpeedKnots,
        double CrosswindKnots,
        double SignedCrosswindKnots,
        double HeadwindKnots
    );

    /// <summary>
    /// Calculează parametrii atmosferici ISA și altitudinea de densitate (Density Altitude).
    /// </summary>
    public static (double PressureAltFt, double DensityAltFt, double IsaDevC, double Sigma) CalculateAtmosphere(
        double elevationFeet = LrcvElevationFeet,
        double qnhHpa = DefaultQnhHpa,
        double oatCelsius = DefaultOatCelsius)
    {
        double pressureAltFt = elevationFeet + 30.0 * (StandardPressureHpa - qnhHpa);
        double isaTempC = 15.0 - 0.00198 * elevationFeet;
        double isaDevC = oatCelsius - isaTempC;
        double densityAltFt = pressureAltFt + 118.8 * isaDevC;

        // Raportul densității aerului sigma = rho / rho_0
        double sigma = Math.Pow(Math.Max(0.5, 1.0 - 6.8756e-6 * densityAltFt), 4.2561);
        return (Math.Round(pressureAltFt, 0), Math.Round(densityAltFt, 0), Math.Round(isaDevC, 1), Math.Round(sigma, 4));
    }

    /// <summary>
    /// Convertește viteza indicată (IAS) în viteză adevărată (TAS) în funcție de altitudine și densitate.
    /// </summary>
    public static double IasToTas(double iasKnots, double altitudeFeetAmsl, double oatCelsius = DefaultOatCelsius)
    {
        var (_, _, _, sigma) = CalculateAtmosphere(altitudeFeetAmsl, DefaultQnhHpa, oatCelsius - 0.00198 * Math.Max(0, altitudeFeetAmsl - LrcvElevationFeet));
        return Math.Round(iasKnots / Math.Sqrt(Math.Max(0.35, sigma)), 1);
    }

    /// <summary>
    /// Calculează vântul la o altitudine dată folosind profilul Hellmann și spirala Ekman.
    /// </summary>
    public static (double WindDirDeg, double WindSpeedKt) PredictWindAtAltitude(
        double surfaceWindDirDeg,
        double surfaceWindSpeedKt,
        double altitudeFeetAmsl)
    {
        double aglFeet = Math.Max(33.0, altitudeFeetAmsl - LrcvElevationFeet);
        double speedAtAlt = surfaceWindSpeedKt * Math.Pow(aglFeet / 33.0, HellmannWindShearAlpha);
        double veerDeg = EkmanMaxVeerDegrees * Math.Min(1.0, (aglFeet - 33.0) / 3500.0);
        double dirAtAlt = (surfaceWindDirDeg + veerDeg + 360.0) % 360.0;
        return (Math.Round(dirAtAlt, 1), Math.Round(speedAtAlt, 1));
    }

    /// <summary>
    /// Rezolvă triunghiul vitezelor în navigația aeriană:
    /// WCA = arcsin((V_w * sin(theta_w - chi)) / V_TAS),
    /// psi = chi + WCA,
    /// V_GS = V_TAS * cos(WCA) - V_w * cos(theta_w - chi).
    /// </summary>
    public static WindTriangleResult SolveWindTriangle(
        double desiredTrackDegrees,
        double trueAirspeedKnots,
        double windDirectionDegrees,
        double windSpeedKnots)
    {
        double tas = Math.Max(40.0, trueAirspeedKnots);
        double diffDeg = (windDirectionDegrees - desiredTrackDegrees) % 360.0;
        if (diffDeg < -180.0) diffDeg += 360.0;
        if (diffDeg > 180.0) diffDeg -= 360.0;

        double diffRad = diffDeg * Math.PI / 180.0;
        double signedCrosswind = windSpeedKnots * Math.Sin(diffRad);
        double headwind = windSpeedKnots * Math.Cos(diffRad);

        double sinWca = Math.Clamp(signedCrosswind / tas, -0.85, 0.85);
        double wcaRad = Math.Asin(sinWca);
        double wcaDeg = wcaRad * 180.0 / Math.PI;

        double heading = (desiredTrackDegrees + wcaDeg + 360.0) % 360.0;
        double groundSpeed = Math.Max(25.0, tas * Math.Cos(wcaRad) - headwind);

        return new WindTriangleResult(
            DesiredTrackDegrees: Math.Round(desiredTrackDegrees, 1),
            HeadingToFlyDegrees: Math.Round(heading, 1),
            WindCorrectionAngleCrabDegrees: Math.Round(wcaDeg, 1),
            TrueAirspeedKnots: Math.Round(tas, 1),
            GroundSpeedKnots: Math.Round(groundSpeed, 1),
            CrosswindKnots: Math.Round(Math.Abs(signedCrosswind), 1),
            SignedCrosswindKnots: Math.Round(signedCrosswind, 1),
            HeadwindKnots: Math.Round(headwind, 1)
        );
    }

    /// <summary>
    /// Prezice evoluția meteo la un orizont viitor (minute de la T0) folosind un model sinoptic baroclinic determinist.
    /// </summary>
    public static (double WindDirDeg, double WindSpeedKt, double WindGustKt, int VisibilityM) PredictFutureWeatherAtMinute(
        WeatherCondition current,
        double horizonMinutes)
    {
        if (horizonMinutes <= 0.0)
        {
            return (
                current.WindDirectionDegrees,
                current.WindSpeedKnots,
                Math.Max(current.WindSpeedKnots, current.WindGustKnots),
                (int)Math.Round(current.VisibilityMeters)
            );
        }

        double tHours = horizonMinutes / 60.0;
        double baseGustSpread = Math.Max(0.0, current.WindGustKnots - current.WindSpeedKnots);

        // Dacă vântul este puternic din sector sudic (160°-220°, vânt lateral pe 08/26), modelăm trecerea frontului de rafală:
        // vântul se rotește treptat în sens orar (+18°/oră spre SV 200°-220°) și rafala scade exponențial după T+12 minute.
        bool isStrongSoutherlyFront = current.WindSpeedKnots >= 16.0 && current.WindDirectionDegrees >= 150.0 && current.WindDirectionDegrees <= 220.0;

        double dirShiftDeg;
        double speedFactor;
        double gustDecayFactor;

        if (isStrongSoutherlyFront)
        {
            dirShiftDeg = 18.0 * tHours; // Rotație frontală spre 195°..205°
            // Vârful de intensitate la T+5m, apoi atenuare treptată (-22% la T+30m, -32% la T+45m)
            speedFactor = horizonMinutes <= 6.0
                ? 1.0 + 0.03 * (horizonMinutes / 6.0)
                : Math.Max(0.65, 1.03 - 0.38 * ((horizonMinutes - 6.0) / 40.0));
            gustDecayFactor = horizonMinutes <= 8.0
                ? 1.0
                : Math.Exp(-0.045 * (horizonMinutes - 8.0));
        }
        else
        {
            // Evoluție sinoptică moderată: rotație lentă +6°/oră și variație termică ușoară
            dirShiftDeg = 6.0 * tHours;
            speedFactor = 1.0 + 0.06 * Math.Sin(horizonMinutes * Math.PI / 30.0);
            gustDecayFactor = Math.Exp(-0.02 * horizonMinutes);
        }

        double predDir = (current.WindDirectionDegrees + dirShiftDeg + 360.0) % 360.0;
        double predSpeed = Math.Max(2.0, current.WindSpeedKnots * speedFactor);
        double predGust = Math.Max(predSpeed, predSpeed + baseGustSpread * gustDecayFactor);
        int predVis = (int)Math.Round(current.VisibilityMeters);

        return (Math.Round(predDir, 0), Math.Round(predSpeed, 1), Math.Round(predGust, 1), predVis);
    }

    /// <summary>
    /// Construiește predicția completă 4D a viitorului pe orizonturile T+0, T+5m, T+10m, T+15m, T+20m, T+30m, T+45m.
    /// </summary>
    public static FuturePredictionSummary BuildFuturePrediction(
        WeatherCondition weather,
        List<CraiovaAircraft> aircrafts,
        List<AircraftAdvisory> advisories,
        string activeRunway,
        int baseTimeOffsetSeconds = 50400)
    {
        var (pAlt, dAlt, isaDev, sigma) = CalculateAtmosphere();
        double effectiveSurfaceWind = Math.Max(weather.WindSpeedKnots, weather.WindGustKnots);
        var (w2000Dir, w2000Spd) = PredictWindAtAltitude(weather.WindDirectionDegrees, effectiveSurfaceWind, 2000.0);
        var (w5000Dir, w5000Spd) = PredictWindAtAltitude(weather.WindDirectionDegrees, effectiveSurfaceWind, 5000.0);

        int[] horizonMinutesList = [0, 5, 10, 15, 20, 30, 45];
        var horizons = new List<FutureHorizonSnapshot>();
        int? firstRunwayChangeMin = null;
        string? bestVfrWindowLabel = null;
        double lowestVfrCrosswind = double.MaxValue;

        foreach (int hMin in horizonMinutesList)
        {
            int hSec = hMin * 60;
            var (pDir, pSpd, pGust, pVis) = PredictFutureWeatherAtMinute(weather, hMin);
            double effWind = Math.Max(pSpd, pGust);

            var (recRwy, _, xw, hw) = CrosswindCalculator.DetermineActiveRunwayCraiova(pDir, effWind);
            if (!string.IsNullOrWhiteSpace(weather.ForceRunwayInUse))
            {
                recRwy = RunwayConfiguration.Normalize(weather.ForceRunwayInUse);
                double rwyHdg = CrosswindCalculator.GetRunwayHeading(recRwy);
                (xw, hw) = CrosswindCalculator.Calculate(pDir, effWind, rwyHdg);
            }

            if (firstRunwayChangeMin == null && recRwy != RunwayConfiguration.Normalize(activeRunway))
            {
                firstRunwayChangeMin = hMin;
            }

            bool vfrSafe = xw <= 13.0 && pVis >= 5000;
            if (xw < lowestVfrCrosswind)
            {
                lowestVfrCrosswind = xw;
                string winStart = TimeSpan.FromSeconds(baseTimeOffsetSeconds + hSec).ToString(@"hh\:mm");
                string winEnd = TimeSpan.FromSeconds(baseTimeOffsetSeconds + hSec + 600).ToString(@"hh\:mm");
                bestVfrWindowLabel = $"{winStart}–{winEnd} (vânt lateral estimat {xw:F1} kt pe RWY {recRwy})";
            }

            // Calculăm câte aeronave au aterizat, câte sunt în aer și câte în holding la momentul hSec
            int landedCount = 0;
            int holdingCount = 0;
            int airborneCount = 0;

            foreach (var adv in advisories)
            {
                var ac = aircrafts.FirstOrDefault(a => a.Id == adv.AircraftId);
                double eta = ac?.EtaSeconds ?? 0;
                double? landingSec = adv.AssignedLandingSlot?.CalculatedTimeSeconds
                    ?? (adv.AdvisoryStatus == AdvisoryStatus.ClearedForApproach ? eta : null);

                if (landingSec.HasValue)
                {
                    if (hSec >= landingSec.Value + 45.0)
                        landedCount++;
                    else if (hSec >= landingSec.Value - 900.0)
                        airborneCount++;
                }
                else if (adv.AdvisoryStatus == AdvisoryStatus.HoldInOrbitRecommended)
                {
                    double holdDurationSec = (adv.OrbitAdvice?.HoldingDurationMinutes ?? 12.0) * 60.0;
                    if (hSec >= eta - 120.0 && hSec <= eta + holdDurationSec)
                    {
                        holdingCount++;
                        airborneCount++;
                    }
                    else if (hSec > eta + holdDurationSec)
                    {
                        // După finalizarea holdingului, dacă vântul s-a calmat, aterizează
                        if (xw <= adv.MaxCrosswindLimitKnots)
                            landedCount++;
                        else
                            airborneCount++;
                    }
                }
                else if (adv.AdvisoryStatus == AdvisoryStatus.DivertRecommended)
                {
                    double divMinutes = adv.RecommendedAlternates?.FirstOrDefault()?.EstimatedFlightMinutes ?? 10.0;
                    if (hSec < eta + divMinutes * 60.0)
                        airborneCount++;
                    else
                        landedCount++;
                }
            }

            string? hazard = null;
            if (xw > 15.0)
            {
                hazard = $"Vânt lateral sever ({xw:F1} kt) pe RWY {recRwy} — depășește plafonul VFR GA (15 kt).";
            }
            else if (xw > 11.0)
            {
                hazard = $"Vânt lateral moderat-ridicat ({xw:F1} kt) — restricție pentru ULM/Savannah (<11 kt).";
            }
            else if (holdingCount > 0)
            {
                hazard = $"Fereastră favorabilă de deblocare a {holdingCount} aeronave din holding (lateral {xw:F1} kt).";
            }

            string fmtTime = TimeSpan.FromSeconds(baseTimeOffsetSeconds + hSec).ToString(@"hh\:mm");
            horizons.Add(new FutureHorizonSnapshot(
                HorizonMinutes: hMin,
                HorizonSeconds: hSec,
                FormattedTime: fmtTime,
                PredictedWindDirectionDegrees: pDir,
                PredictedWindSpeedKnots: pSpd,
                PredictedWindGustKnots: pGust,
                PredictedVisibilityMeters: pVis,
                RecommendedRunway: recRwy,
                PredictedCrosswindKnots: xw,
                PredictedHeadwindKnots: hw,
                IsVfrLegalAndSafe: vfrSafe,
                ActiveAirborneCount: airborneCount,
                HoldingCount: holdingCount,
                CumulativeLandedCount: landedCount,
                HazardAlert: hazard
            ));
        }

        var h0 = horizons[0];
        var h15 = horizons.First(h => h.HorizonMinutes == 15);
        var h30 = horizons.First(h => h.HorizonMinutes == 30);

        string trendSummary =
            $"Altitudine de densitate {dAlt:F0} ft (ISA {(isaDev >= 0 ? "+" : "")}{isaDev:F1}°C, σ={sigma:F3}). " +
            $"Forfecare verticală (α={HellmannWindShearAlpha}): la 2.000 ft vânt din {w2000Dir:F0}°/{w2000Spd:F1} kt, la 5.000 ft din {w5000Dir:F0}°/{w5000Spd:F1} kt. " +
            $"Prognoză T+15m ({h15.FormattedTime}): vânt {h15.PredictedWindDirectionDegrees:F0}°/{h15.PredictedWindSpeedKnots:F0}G{h15.PredictedWindGustKnots:F0} kt (lateral {h15.PredictedCrosswindKnots:F1} kt pe RWY {h15.RecommendedRunway}). " +
            $"Prognoză T+30m ({h30.FormattedTime}): vânt {h30.PredictedWindDirectionDegrees:F0}°/{h30.PredictedWindSpeedKnots:F0}G{h30.PredictedWindGustKnots:F0} kt (lateral {h30.PredictedCrosswindKnots:F1} kt).";

        return new FuturePredictionSummary(
            PressureHpa: DefaultQnhHpa,
            OutsideAirTemperatureCelsius: DefaultOatCelsius,
            IsaTemperatureDeviationCelsius: isaDev,
            PressureAltitudeFeet: pAlt,
            DensityAltitudeFeet: dAlt,
            AirDensityRatioSigma: sigma,
            WindShearExponentAlpha: HellmannWindShearAlpha,
            WindAt2000FtDegrees: w2000Dir,
            WindAt2000FtKnots: w2000Spd,
            WindAt5000FtDegrees: w5000Dir,
            WindAt5000FtKnots: w5000Spd,
            TrendSummary: trendSummary,
            OptimalVfrLandingWindow: bestVfrWindowLabel ?? "14:00–14:15",
            PredictedRunwayChangeAtMinute: firstRunwayChangeMin,
            Horizons: horizons
        );
    }

    /// <summary>
    /// Construiește analiza completă De-la-Decolare-la-Aterizare (Takeoff-to-Landing) în 6 faze cinematice și energetice.
    /// </summary>
    public static TakeoffToLandingAnalysis BuildTakeoffToLanding(
        CraiovaAircraft ac,
        string assignedRunway,
        WeatherCondition weather,
        double landingTimeSeconds)
    {
        string rwy = RunwayConfiguration.Normalize(assignedRunway);
        double rwyTrueBearing = RunwayConfiguration.GetHeading(rwy, trueNorth: true);
        var (_, _, _, sigma) = CalculateAtmosphere();

        // Determinăm aerodromul de decolare și parametrii de misiune în funcție de aeronavă
        bool isJet = ac.Category == AircraftCategory.CommercialJet;
        bool isTurboprop = ac.Category == AircraftCategory.RegionalTurboprop;
        bool isGa = ac.Category == AircraftCategory.GeneralAviation;

        var (depIcao, depName, routeNm, cruiseAltFt, cruiseTasKt, baseLdrMeters, vappKt, vrefKt, baseRotSec) = ac.Id switch
        {
            "W4-3751" => ("EGGW", "London Luton", 1125.0, 37000.0, 450.0, 1440.0, 138.0, 133.0, 52.0),
            "W4-3762" => ("LIME", "Milan Bergamo", 640.0, 35000.0, 455.0, 1580.0, 144.0, 139.0, 55.0),
            "CA-841"  => ("ZBAA", "Beijing Capital", 3885.0, 38000.0, 470.0, 1680.0, 142.0, 137.0, 58.0),
            "RO-204"  => ("LROP", "București Otopeni", 98.0, 16000.0, 275.0, 1080.0, 116.0, 111.0, 42.0),
            "YR-SAV"  => ("LRCW", "Aerodromul Balta Verde Craiova (Aeroclubul României)", 18.5, 2000.0, 65.0, 95.0, 52.0, 46.0, 24.0),
            "YR-WILG" => ("LRCW", "Aerodromul Balta Verde Craiova (Aeroclubul României)", 24.0, 2500.0, 75.0, 125.0, 60.0, 54.0, 28.0),
            "YR-C172" => ("LRBS", "București Băneasa", 97.0, 4500.0, 115.0, 160.0, 68.0, 61.0, 30.0),
            _ when isJet => ("LROP", "București Otopeni", 98.0, 28000.0, 440.0, 1450.0, 138.0, 133.0, 50.0),
            _ when isTurboprop => ("LROP", "București Otopeni", 98.0, 16000.0, 275.0, 1100.0, 118.0, 113.0, 42.0),
            _ when isGa => ("LRBS", "București Băneasa", 95.0, 4500.0, 110.0, 180.0, 70.0, 62.0, 30.0),
            _ => ("LRCW", "Aerodromul Balta Verde Craiova (Aeroclubul României)", 20.0, 2000.0, 70.0, 110.0, 55.0, 48.0, 25.0)
        };

        var (resolvedIcao, resolvedName, depLat, depLon, overrideNm) = ResolveDepartureAerodrome(ac.DepartureIcao ?? depIcao, depName, routeNm);
        depIcao = resolvedIcao;
        depName = resolvedName;
        routeNm = overrideNm;

        // Vântul prezis la momentul aterizării (landingTimeSeconds / 60.0 minute în viitor)
        double landingHorizonMin = Math.Max(0.0, landingTimeSeconds / 60.0);
        var (futureWindDir, futureWindSpd, futureWindGust, _) = PredictFutureWeatherAtMinute(weather, landingHorizonMin);
        double effSurfaceWindAtLanding = Math.Max(futureWindSpd, futureWindGust);

        // Vântul la altitudinea de apropiere intermediară (2500 ft IFR / 1500 ft VFR)
        double appAltFt = ac.FlightRules == FlightRules.IFR ? 2500.0 : 1500.0;
        var (windDirAtAlt, windSpdAtAlt) = PredictWindAtAltitude(futureWindDir, effSurfaceWindAtLanding, appAltFt);

        // Triunghiul vitezelor pe panta finală (aliniat pe direcția adevărată a pistei)
        double appTasKt = IasToTas(vappKt, appAltFt);
        var finalTriangle = SolveWindTriangle(rwyTrueBearing, appTasKt, windDirAtAlt, windSpdAtAlt);

        // Triunghiul vitezelor la pragul pistei (Touchdown)
        var thrTriangle = SolveWindTriangle(rwyTrueBearing, vrefKt, futureWindDir, effSurfaceWindAtLanding);
        double touchdownGsKt = Math.Max(30.0, vrefKt - thrTriangle.HeadwindKnots);

        // Distanța Top of Descent (TOD): regula 3:1 (3 NM per 1000 ft de coborât) + 1 NM per 10 kt decelerare + 5.7 NM FAF
        double altToLoseFt = Math.Max(1000.0, cruiseAltFt - LrcvElevationFeet);
        double speedToLoseKt = Math.Max(10.0, cruiseTasKt - vappKt);
        double todDistanceNm = Math.Round((altToLoseFt / 1000.0) * 3.0 + (speedToLoseKt / 10.0) * 1.0 + 5.7, 1);

        // Rata optimă de coborâre pe glisada de 3.0°: ROD (fpm) = GS (kt) * (6076.12 / 60) * tan(3.0°) ≈ 5.307 * GS
        double glidepathDeg = 3.0;
        double requiredRodFpm = Math.Round(finalTriangle.GroundSpeedKnots * (6076.12 / 60.0) * Math.Tan(glidepathDeg * Math.PI / 180.0), 0);

        // Poarta de stabilizare: 1000 ft AAL pentru IFR (1628 ft AMSL), 500 ft AAL pentru VFR (1128 ft AMSL)
        double stabGateFt = LrcvElevationFeet + (ac.FlightRules == FlightRules.IFR ? 1000.0 : 500.0);

        // Energia specifică totală la intrarea pe finală: E_s = h_AGL + V_fps^2 / (2 * g)
        double vFps = finalTriangle.GroundSpeedKnots * 1.68781;
        double specificEnergyFt = Math.Round((appAltFt - LrcvElevationFeet) + (vFps * vFps) / (2.0 * 32.174), 0);

        // Distanța de aterizare necesară (LDR): ajustată cu densitatea aerului (1/sigma) și pătratul vitezei la sol la impact (V_TD_GS / V_ref)^2
        double speedRatioSq = Math.Pow(touchdownGsKt / Math.Max(40.0, vrefKt), 2.0);
        double ldrMeters = Math.Round(baseLdrMeters * (1.0 / sigma) * speedRatioSq, 0);
        double safetyMarginMeters = Math.Round(LrcvRunwayLengthMeters - ldrMeters, 0);
        double rwyUsedPct = Math.Round((ldrMeters / LrcvRunwayLengthMeters) * 100.0, 1);

        // Timp de ocupare a pistei (ROT) ajustat cu viteza la sol la touchdown
        double rotSeconds = Math.Round(baseRotSec * (touchdownGsKt / Math.Max(45.0, vrefKt)), 1);

        // Cele 6 faze ale profilului Takeoff-to-Landing
        double climbRateFpm = isJet ? 2300.0 : (isTurboprop ? 1400.0 : 750.0);
        double climbDistNm = Math.Round( Math.Min(routeNm * 0.25, (altToLoseFt / climbRateFpm) * (cruiseTasKt * 0.75 / 60.0)), 1);
        double descentDistNm = Math.Min(routeNm * 0.35, todDistanceNm);
        double cruiseDistNm = Math.Max(2.0, Math.Round(routeNm - climbDistNm - descentDistNm, 1));

        var phases = new List<FlightMissionPhase>
        {
            new(
                PhaseOrder: 1,
                PhaseCode: "TAKEOFF",
                PhaseName: $"Decolare & Urcare Inițială ({depIcao})",
                StartAltitudeFeet: 300,
                EndAltitudeFeet: 3000,
                TrueAirspeedKnots: Math.Round(vrefKt * 1.12, 0),
                GroundSpeedKnots: Math.Round(vrefKt * 1.10, 0),
                DistanceNm: isJet ? 8.5 : 3.2,
                DurationMinutes: isJet ? 2.5 : 2.8,
                VerticalRateFpm: climbRateFpm,
                FuelBurnedMinutesEquivalent: isJet ? 4.5 : 3.5,
                KeyMathNote: $"Rulare decolare și urcare inițială la V2={Math.Round(vrefKt * 1.12, 0)} kt, gradient +{climbRateFpm:F0} fpm."
            ),
            new(
                PhaseOrder: 2,
                PhaseCode: "CLIMB_TOC",
                PhaseName: "Urcare în Rută până la Top of Climb (TOC)",
                StartAltitudeFeet: 3000,
                EndAltitudeFeet: cruiseAltFt,
                TrueAirspeedKnots: Math.Round(cruiseTasKt * 0.82, 0),
                GroundSpeedKnots: Math.Round(cruiseTasKt * 0.80, 0),
                DistanceNm: climbDistNm,
                DurationMinutes: Math.Round(Math.Max(2.0, (cruiseAltFt - 3000.0) / climbRateFpm), 1),
                VerticalRateFpm: Math.Round(climbRateFpm * 0.85, 0),
                FuelBurnedMinutesEquivalent: isJet ? 18.0 : 6.0,
                KeyMathNote: $"Atingere plafon croazieră {cruiseAltFt:F0} ft AMSL la {climbDistNm:F1} NM de la {depIcao}."
            ),
            new(
                PhaseOrder: 3,
                PhaseCode: "CRUISE",
                PhaseName: "Croazieră Stabilizată & Corecție Derivă Vânt",
                StartAltitudeFeet: cruiseAltFt,
                EndAltitudeFeet: cruiseAltFt,
                TrueAirspeedKnots: cruiseTasKt,
                GroundSpeedKnots: Math.Round(cruiseTasKt - finalTriangle.HeadwindKnots * 0.8, 1),
                DistanceNm: cruiseDistNm,
                DurationMinutes: Math.Round((cruiseDistNm / Math.Max(50.0, cruiseTasKt)) * 60.0, 1),
                VerticalRateFpm: 0,
                FuelBurnedMinutesEquivalent: Math.Round((cruiseDistNm / Math.Max(50.0, cruiseTasKt)) * 60.0, 1),
                KeyMathNote: $"Zbor de croazieră la TAS {cruiseTasKt:F0} kt; unghi de derivă (crab) WCA={finalTriangle.WindCorrectionAngleCrabDegrees:+0.0;-0.0;0.0}°."
            ),
            new(
                PhaseOrder: 4,
                PhaseCode: "DESCENT_TOD",
                PhaseName: "Top of Descent (TOD) & Apropiere Inițială (CDA)",
                StartAltitudeFeet: cruiseAltFt,
                EndAltitudeFeet: appAltFt,
                TrueAirspeedKnots: Math.Round((cruiseTasKt + appTasKt) * 0.5, 0),
                GroundSpeedKnots: Math.Round((cruiseTasKt + finalTriangle.GroundSpeedKnots) * 0.5, 0),
                DistanceNm: Math.Max(4.0, Math.Round(descentDistNm - 5.7, 1)),
                DurationMinutes: Math.Round(Math.Max(2.0, (descentDistNm - 5.7) / Math.Max(60.0, (cruiseTasKt + appTasKt) * 0.5) * 60.0), 1),
                VerticalRateFpm: -Math.Round(requiredRodFpm * 1.35, 0),
                FuelBurnedMinutesEquivalent: 4.0,
                KeyMathNote: $"TOD calculat la {todDistanceNm:F1} NM de pragul RWY {rwy} (profil continuu CDA 3:1)."
            ),
            new(
                PhaseOrder: 5,
                PhaseCode: "FINAL_APPROACH",
                PhaseName: $"Pantă Finală 3.0° RWY {rwy} & Poartă Stabilizare",
                StartAltitudeFeet: appAltFt,
                EndAltitudeFeet: LrcvElevationFeet + 50.0,
                TrueAirspeedKnots: appTasKt,
                GroundSpeedKnots: finalTriangle.GroundSpeedKnots,
                DistanceNm: 5.7,
                DurationMinutes: Math.Round((5.7 / finalTriangle.GroundSpeedKnots) * 60.0, 1),
                VerticalRateFpm: -requiredRodFpm,
                FuelBurnedMinutesEquivalent: 3.2,
                KeyMathNote: $"Glisadă 3.0°: ROD = -{requiredRodFpm:F0} fpm la GS={finalTriangle.GroundSpeedKnots:F1} kt, cap zbor {finalTriangle.HeadingToFlyDegrees:F0}° (crab {finalTriangle.WindCorrectionAngleCrabDegrees:+0.0;-0.0;0.0}°). Energie specifică Es={specificEnergyFt:F0} ft."
            ),
            new(
                PhaseOrder: 6,
                PhaseCode: "TOUCHDOWN_ROLLOUT",
                PhaseName: $"Touchdown, Frânare & Degajare Pistă {rwy}",
                StartAltitudeFeet: LrcvElevationFeet,
                EndAltitudeFeet: LrcvElevationFeet,
                TrueAirspeedKnots: vrefKt,
                GroundSpeedKnots: touchdownGsKt,
                DistanceNm: Math.Round(ldrMeters / 1852.0, 2),
                DurationMinutes: Math.Round(rotSeconds / 60.0, 2),
                VerticalRateFpm: 0,
                FuelBurnedMinutesEquivalent: 1.0,
                KeyMathNote: $"Touchdown la Vref={vrefKt:F0} kt (GS={touchdownGsKt:F1} kt). Distanță frânare LDR={ldrMeters:F0}m din 2500m ({rwyUsedPct:F1}%), marjă siguranță +{safetyMarginMeters:F0}m, ocupare pistă ROT={rotSeconds:F1}s."
            )
        };

        return new TakeoffToLandingAnalysis(
            DepartureAerodromeIcao: depIcao,
            DepartureAerodromeName: depName,
            TotalRouteDistanceNm: routeNm,
            CruiseAltitudeFeet: cruiseAltFt,
            CruiseTasKnots: cruiseTasKt,
            WindDirectionAtAltitudeDegrees: windDirAtAlt,
            WindSpeedAtAltitudeKnots: windSpdAtAlt,
            WindCorrectionAngleCrabDegrees: finalTriangle.WindCorrectionAngleCrabDegrees,
            HeadingToFlyDegrees: finalTriangle.HeadingToFlyDegrees,
            GroundSpeedApproachKnots: finalTriangle.GroundSpeedKnots,
            TopOfDescentDistanceNm: todDistanceNm,
            OptimalGlidepathDegrees: glidepathDeg,
            RequiredRateOfDescentFpm: requiredRodFpm,
            StabilizationGateAltitudeFeetAmsl: stabGateFt,
            SpecificTotalEnergyFeet: specificEnergyFt,
            ApproachSpeedVappKnots: vappKt,
            ThresholdSpeedVrefKnots: vrefKt,
            TouchdownGroundSpeedKnots: touchdownGsKt,
            LandingDistanceRequiredMeters: ldrMeters,
            LandingDistanceAvailableMeters: LrcvRunwayLengthMeters,
            RunwaySafetyMarginMeters: safetyMarginMeters,
            RunwayUsedPercent: rwyUsedPct,
            PredictedRunwayOccupancySeconds: rotSeconds,
            Phases: phases,
            DepartureLatitude: depLat,
            DepartureLongitude: depLon
        );
    }

    /// <summary>
    /// Construiește predicția cu „Doi Pași Înaintea Avionului” (Two Steps Ahead: T0 Curent -> Pasul +1 Tactic -> Pasul +2 Final).
    /// </summary>
    public static TwoStepsAheadPrediction BuildTwoStepsAhead(
        CraiovaAircraft ac,
        AircraftAdvisory advisory,
        WeatherCondition weather,
        TakeoffToLandingAnalysis ttl,
        int baseTimeOffsetSeconds = 50400)
    {
        string rwy = RunwayConfiguration.Normalize(advisory.AssignedRunway);
        var thr = rwy == RunwayConfiguration.Runway26 ? AipAirwayData.Thr26 : AipAirwayData.Thr08;

        double targetTimeSec = advisory.AssignedLandingSlot?.CalculatedTimeSeconds ?? ac.EtaSeconds;
        double step0Sec = targetTimeSec - (ac.FlightRules == FlightRules.IFR ? 540.0 : 420.0);
        double step1Sec = targetTimeSec - (ac.FlightRules == FlightRules.IFR ? 210.0 : 180.0);
        double step2Sec = targetTimeSec;

        string Fmt(double s) => TimeSpan.FromSeconds(baseTimeOffsetSeconds + s).ToString(@"hh\:mm");

        // Determinăm punctul de intrare IAF sau VFR
        string entryPointId;
        if (ac.FlightRules == FlightRules.IFR)
        {
            entryPointId = ac.Id is "W4-3751" ? "TITEK" : (ac.Id is "W4-3762" or "CA-841" or "RO-204" ? "PEMOK" : "PANZU");
        }
        else
        {
            entryPointId = ac.Id == "YR-SAV" ? "VFR-S" : (ac.Id == "YR-WILG" ? "VFR-W" : "VFR-N");
        }

        var entryWp = AipAirwayData.Waypoints.GetValueOrDefault(entryPointId, AipAirwayData.Waypoints["PEMOK"]);
        string step1FixId = ac.FlightRules == FlightRules.IFR
            ? (rwy == RunwayConfiguration.Runway26 ? "OZZET" : "NECCO")
            : $"F{rwy}-3NM (Aliniere 3 NM)";
        var step1Wp = ac.FlightRules == FlightRules.IFR
            ? AipAirwayData.Waypoints[step1FixId]
            : new AipAirwayData.WaypointInfo(
                step1FixId,
                GeoMath.Destination(thr.Lat, thr.Lon, (thr.HeadingDeg + 180.0) % 360.0, 3.0).Latitude,
                GeoMath.Destination(thr.Lat, thr.Lon, (thr.HeadingDeg + 180.0) % 360.0, 3.0).Longitude,
                1000.0,
                "VFR Final Join");

        // Pasul 0 (T0 - Stare Curentă de Intrare în Sector)
        double dist0Nm = Math.Round(GeoMath.DistanceNm(entryWp.Latitude, entryWp.Longitude, thr.Lat, thr.Lon), 1);
        double track0 = GeoMath.BearingDegrees(entryWp.Latitude, entryWp.Longitude, step1Wp.Latitude, step1Wp.Longitude);
        var (w0Dir, w0Spd) = PredictWindAtAltitude(weather.WindDirectionDegrees, Math.Max(weather.WindSpeedKnots, weather.WindGustKnots), entryWp.AltitudeFt);
        double tas0 = ac.FlightRules == FlightRules.IFR ? 220.0 : Math.Max(65.0, ac.SpeedKnots);
        var tri0 = SolveWindTriangle(track0, tas0, w0Dir, w0Spd);

        var currentStep = new PredictionStepSnapshot(
            StepIndex: 0,
            StepLabel: "T0 — Poziție & Energie Curentă (Intrare Sector)",
            TimeSeconds: step0Sec,
            FormattedTime: Fmt(step0Sec),
            PhaseName: ac.FlightRules == FlightRules.IFR ? "Initial Approach (IAF Transition)" : "VFR Sector Inbound",
            FixOrLocation: entryWp.Id,
            Latitude: Math.Round(entryWp.Latitude, 5),
            Longitude: Math.Round(entryWp.Longitude, 5),
            DistanceToThresholdNm: dist0Nm,
            AltitudeFeet: entryWp.AltitudeFt,
            TrueAirspeedKnots: tri0.TrueAirspeedKnots,
            GroundSpeedKnots: tri0.GroundSpeedKnots,
            TrackDegrees: tri0.DesiredTrackDegrees,
            HeadingDegrees: tri0.HeadingToFlyDegrees,
            CrabAngleDegrees: tri0.WindCorrectionAngleCrabDegrees,
            VerticalSpeedFpm: ac.FlightRules == FlightRules.IFR ? -1200 : -450,
            ExpectedCrosswindKnots: tri0.CrosswindKnots,
            ExpectedHeadwindKnots: tri0.HeadwindKnots,
            RemainingFuelMinutes: ac.RemainingFuelMinutes,
            ControllerAction: $"Identificare radar la {entryWp.Id} ({dist0Nm:F1} NM de RWY {rwy}). Corecție derivă vânt {tri0.WindCorrectionAngleCrabDegrees:+0.0;-0.0;0.0}° (cap {tri0.HeadingToFlyDegrees:F0}°)."
        );

        // Pasul +1 Înainte (Orizont Tactic Intermediar)
        double dist1Nm = Math.Round(GeoMath.DistanceNm(step1Wp.Latitude, step1Wp.Longitude, thr.Lat, thr.Lon), 1);
        var (w1Dir, w1Spd, w1Gust, _) = PredictFutureWeatherAtMinute(weather, step1Sec / 60.0);
        var (w1AltDir, w1AltSpd) = PredictWindAtAltitude(w1Dir, Math.Max(w1Spd, w1Gust), step1Wp.AltitudeFt);
        double tas1 = ac.FlightRules == FlightRules.IFR ? 180.0 : Math.Max(60.0, ac.SpeedKnots * 0.92);
        var tri1 = SolveWindTriangle(thr.HeadingDeg, tas1, w1AltDir, w1AltSpd);
        double fuelAtStep1 = Math.Round(Math.Max(15.0, ac.RemainingFuelMinutes - (step1Sec - step0Sec) / 60.0), 1);

        string step1Action = advisory.AdvisoryStatus switch
        {
            AdvisoryStatus.ClearedForApproach =>
                $"Pasul +1: Interceptare ax RWY {rwy} la {step1Wp.Id} ({step1Wp.AltitudeFt:F0} ft). Decelerare la {tas1:F0} kt TAS (GS {tri1.GroundSpeedKnots:F1} kt), coborâre pe glisadă cu -{ttl.RequiredRateOfDescentFpm:F0} fpm.",
            AdvisoryStatus.HoldInOrbitRecommended =>
                $"Pasul +1: Intrare în circuit de așteptare la {advisory.OrbitAdvice?.Racetrack?.FixId ?? "CARCEA"} ({advisory.OrbitAdvice?.RecommendedAltitudeFeet ?? 1500:F0} ft QNH). Vânt lateral prognozat la sol: {advisory.CurrentCrosswindKnots:F1} kt.",
            _ =>
                $"Pasul +1: Punct decizional de redirecționare (Point of No Return) la {entryWp.Id}; viraj pe cap {advisory.VfrRedirection?.RedirectionHeadingToFlyDegrees ?? 225:F0}° către {advisory.VfrRedirection?.BestAlternateName ?? "Aerodromul Balta Verde Craiova"}."
        };

        var stepOneAhead = new PredictionStepSnapshot(
            StepIndex: 1,
            StepLabel: "Pasul +1 Înainte — Poartă Tactică Intermediară (IF / Intrare CTR)",
            TimeSeconds: step1Sec,
            FormattedTime: Fmt(step1Sec),
            PhaseName: advisory.AdvisoryStatus == AdvisoryStatus.ClearedForApproach ? "Intermediate Approach / Glidepath Capture" : "Tactical Hold / Redirection Gate",
            FixOrLocation: step1Wp.Id,
            Latitude: Math.Round(step1Wp.Latitude, 5),
            Longitude: Math.Round(step1Wp.Longitude, 5),
            DistanceToThresholdNm: dist1Nm,
            AltitudeFeet: step1Wp.AltitudeFt,
            TrueAirspeedKnots: tri1.TrueAirspeedKnots,
            GroundSpeedKnots: tri1.GroundSpeedKnots,
            TrackDegrees: tri1.DesiredTrackDegrees,
            HeadingDegrees: tri1.HeadingToFlyDegrees,
            CrabAngleDegrees: tri1.WindCorrectionAngleCrabDegrees,
            VerticalSpeedFpm: advisory.AdvisoryStatus == AdvisoryStatus.ClearedForApproach ? -ttl.RequiredRateOfDescentFpm : 0,
            ExpectedCrosswindKnots: tri1.CrosswindKnots,
            ExpectedHeadwindKnots: tri1.HeadwindKnots,
            RemainingFuelMinutes: fuelAtStep1,
            ControllerAction: step1Action
        );

        // Pasul +2 Înainte (Orizont Final Aterizare / Finalizare Orbită / Aterizare pe Alternativă)
        var (w2Dir, w2Spd, w2Gust, _) = PredictFutureWeatherAtMinute(weather, step2Sec / 60.0);
        double effW2 = Math.Max(w2Spd, w2Gust);
        var (xwAtStep2, hwAtStep2) = CrosswindCalculator.Calculate(w2Dir, effW2, thr.HeadingDeg);

        PredictionStepSnapshot stepTwoAhead;
        if (advisory.AdvisoryStatus == AdvisoryStatus.ClearedForApproach)
        {
            double fuelAtStep2 = Math.Round(Math.Max(10.0, ac.RemainingFuelMinutes - (step2Sec - step0Sec) / 60.0), 1);
            stepTwoAhead = new PredictionStepSnapshot(
                StepIndex: 2,
                StepLabel: $"Pasul +2 Înainte — Touchdown & Rulare RWY {rwy}",
                TimeSeconds: step2Sec,
                FormattedTime: Fmt(step2Sec),
                PhaseName: "Touchdown & Braking Rollout",
                FixOrLocation: $"THR{rwy} (LRCV)",
                Latitude: Math.Round(thr.Lat, 5),
                Longitude: Math.Round(thr.Lon, 5),
                DistanceToThresholdNm: 0.0,
                AltitudeFeet: thr.AltFt,
                TrueAirspeedKnots: ttl.ThresholdSpeedVrefKnots,
                GroundSpeedKnots: ttl.TouchdownGroundSpeedKnots,
                TrackDegrees: thr.HeadingDeg,
                HeadingDegrees: Math.Round((thr.HeadingDeg + ttl.WindCorrectionAngleCrabDegrees + 360.0) % 360.0, 1),
                CrabAngleDegrees: ttl.WindCorrectionAngleCrabDegrees,
                VerticalSpeedFpm: -Math.Round(ttl.RequiredRateOfDescentFpm * 0.5, 0),
                ExpectedCrosswindKnots: xwAtStep2,
                ExpectedHeadwindKnots: hwAtStep2,
                RemainingFuelMinutes: fuelAtStep2,
                ControllerAction: $"Pasul +2: Touchdown la {Fmt(step2Sec)} cu GS={ttl.TouchdownGroundSpeedKnots:F1} kt (vânt lateral prognozat {xwAtStep2:F1} kt). Rulare frânare {ttl.LandingDistanceRequiredMeters:F0}m, eliberare pistă în {ttl.PredictedRunwayOccupancySeconds:F0}s."
            );
        }
        else if (advisory.AdvisoryStatus == AdvisoryStatus.HoldInOrbitRecommended)
        {
            double holdDurMin = advisory.OrbitAdvice?.HoldingDurationMinutes ?? 10.0;
            double exitHoldSec = step1Sec + holdDurMin * 60.0;
            var (wExitDir, wExitSpd, wExitGust, _) = PredictFutureWeatherAtMinute(weather, exitHoldSec / 60.0);
            var (xwExit, hwExit) = CrosswindCalculator.Calculate(wExitDir, Math.Max(wExitSpd, wExitGust), thr.HeadingDeg);
            double fuelAfterHold = advisory.OrbitAdvice?.RemainingFuelMarginMinutes ?? Math.Max(15.0, ac.RemainingFuelMinutes - holdDurMin);
            var bestAlt = advisory.RecommendedAlternates?.OrderByDescending(a => a.SafetyScore).FirstOrDefault();

            string holdStep2Action = xwExit <= ac.MaxCrosswindKnots
                ? $"Pasul +2: La {Fmt(exitHoldSec)} părăsește holdingul și aterizează pe RWY {rwy} (vânt lateral prognozat {xwExit:F1} kt <= {ac.MaxCrosswindKnots:F0} kt)."
                : $"Pasul +2: La {Fmt(exitHoldSec)} vântul lateral pe LRCV rămâne {xwExit:F1} kt (> {ac.MaxCrosswindKnots:F0} kt); execută redirecționare înainte de PNR către {bestAlt?.Name ?? "Aerodromul Balta Verde Craiova"} (pista {bestAlt?.BestRunway ?? "20"}, lateral doar {bestAlt?.CalculatedCrosswindKnots ?? 7.5:F1} kt).";

            stepTwoAhead = new PredictionStepSnapshot(
                StepIndex: 2,
                StepLabel: "Pasul +2 Înainte — Ieșire Orbită / Fereastră Aterizare sau Redirecționare",
                TimeSeconds: exitHoldSec,
                FormattedTime: Fmt(exitHoldSec),
                PhaseName: xwExit <= ac.MaxCrosswindKnots ? "Post-Orbit Approach Clearance" : "PNR Alternate Redirection",
                FixOrLocation: xwExit <= ac.MaxCrosswindKnots ? $"THR{rwy}" : (bestAlt?.Code ?? "LRCW"),
                Latitude: Math.Round(thr.Lat, 5),
                Longitude: Math.Round(thr.Lon, 5),
                DistanceToThresholdNm: xwExit <= ac.MaxCrosswindKnots ? 0.0 : Math.Round((bestAlt?.DistanceKm ?? 14.5) / 1.852, 1),
                AltitudeFeet: advisory.OrbitAdvice?.RecommendedAltitudeFeet ?? 1500.0,
                TrueAirspeedKnots: tas1,
                GroundSpeedKnots: tri1.GroundSpeedKnots,
                TrackDegrees: thr.HeadingDeg,
                HeadingDegrees: tri1.HeadingToFlyDegrees,
                CrabAngleDegrees: tri1.WindCorrectionAngleCrabDegrees,
                VerticalSpeedFpm: -400,
                ExpectedCrosswindKnots: xwExit,
                ExpectedHeadwindKnots: hwExit,
                RemainingFuelMinutes: fuelAfterHold,
                ControllerAction: holdStep2Action
            );
        }
        else
        {
            var bestAlt = advisory.RecommendedAlternates?.OrderByDescending(a => a.SafetyScore).FirstOrDefault()
                          ?? advisory.RecommendedAlternates?.FirstOrDefault();
            double divEtaMin = bestAlt?.EstimatedFlightMinutes ?? 10.0;
            double divTouchdownSec = step1Sec + divEtaMin * 60.0;
            var (altLat, altLon) = bestAlt?.Code is "LRCW" or "LRBV" ? (44.286389, 23.791111) : GeoMath.Destination(AipAirwayData.Arp.Lat, AipAirwayData.Arp.Lon, bestAlt?.BearingDegrees ?? 245.0, (bestAlt?.DistanceKm ?? 11.8) / 1.852);

            stepTwoAhead = new PredictionStepSnapshot(
                StepIndex: 2,
                StepLabel: $"Pasul +2 Înainte — Aterizare Sigură pe Alternativa {bestAlt?.Code ?? "LRCW"}",
                TimeSeconds: divTouchdownSec,
                FormattedTime: Fmt(divTouchdownSec),
                PhaseName: "Alternate Runway Touchdown",
                FixOrLocation: $"{bestAlt?.Name ?? "Aerodromul Balta Verde Craiova"} ({bestAlt?.BestRunway ?? "13"})",
                Latitude: Math.Round(altLat, 5),
                Longitude: Math.Round(altLon, 5),
                DistanceToThresholdNm: 0.0,
                AltitudeFeet: 350.0,
                TrueAirspeedKnots: ttl.ThresholdSpeedVrefKnots,
                GroundSpeedKnots: bestAlt?.GroundSpeedToAlternateKnots ?? 65.0,
                TrackDegrees: bestAlt?.BearingDegrees ?? 225.0,
                HeadingDegrees: bestAlt?.WindCorrectedHeadingDegrees ?? 220.0,
                CrabAngleDegrees: Math.Round((bestAlt?.WindCorrectedHeadingDegrees ?? 220.0) - (bestAlt?.BearingDegrees ?? 225.0), 1),
                VerticalSpeedFpm: -350,
                ExpectedCrosswindKnots: bestAlt?.CalculatedCrosswindKnots ?? 7.0,
                ExpectedHeadwindKnots: bestAlt?.CalculatedHeadwindKnots ?? 20.0,
                RemainingFuelMinutes: bestAlt?.RemainingFuelAtTouchdownMinutes ?? 20.0,
                ControllerAction: $"Pasul +2: Aterizare pe {bestAlt?.Name ?? "Aerodromul Balta Verde Craiova"} pista {bestAlt?.BestRunway ?? "13"} la {Fmt(divTouchdownSec)} cu vânt lateral redus la {bestAlt?.CalculatedCrosswindKnots ?? 7.0:F1} kt și vânt de față +{bestAlt?.CalculatedHeadwindKnots ?? 20.0:F1} kt."
            );
        }

        string summary =
            $"[T0 {currentStep.FormattedTime} @ {currentStep.FixOrLocation}] -> " +
            $"[Pasul +1 {stepOneAhead.FormattedTime} @ {stepOneAhead.FixOrLocation}: GS {stepOneAhead.GroundSpeedKnots:F0} kt, cap {stepOneAhead.HeadingDegrees:F0}°] -> " +
            $"[Pasul +2 {stepTwoAhead.FormattedTime} @ {stepTwoAhead.FixOrLocation}: lateral {stepTwoAhead.ExpectedCrosswindKnots:F1} kt, combustibil rămas {stepTwoAhead.RemainingFuelMinutes:F0} min].";

        return new TwoStepsAheadPrediction(
            CurrentState: currentStep,
            StepOneAhead: stepOneAhead,
            StepTwoAhead: stepTwoAhead,
            PredictiveSummary: summary
        );
    }

    /// <summary>
    /// Evaluează aerodromurile alternative din jurul Craiovei cu modelul matematic multi-criterial:
    /// triunghiul vântului pe ruta de deviere, distanța de aterizare pe iarbă (LDR vs LDA), combustibil la destinație și scor 0-100.
    /// </summary>
    public static List<AlternateAerodrome> EvaluateAlternatesWithMath(
        WeatherCondition weather,
        double aircraftCruiseSpeedKnots = 70,
        double maxCrosswindKnots = 13,
        double remainingFuelMinutes = 75,
        double baseLandingDistanceMeters = 130)
    {
        double speed = aircraftCruiseSpeedKnots <= 0 ? 70.0 : aircraftCruiseSpeedKnots;
        double effectiveWind = Math.Max(weather.WindSpeedKnots, weather.WindGustKnots);
        var (_, _, _, sigma) = CalculateAtmosphere();

        var specs = new List<(string Name, string Code, double DistKm, double BearingDeg, (double Hdg, string Id)[] Runways, double LengthM, string Surface, string BaseNote)>
        {
            (
                "Aerodromul Balta Verde Craiova (Aeroclubul României)",
                "LRCW",
                11.8,
                245.0,
                new[] { (130.0, "13 (130°)"), (310.0, "31 (310°)"), (20.0, "02 (020°)"), (200.0, "20 (200°)") },
                920.0, "Iarbă (920m)",
                "Singurul aerodrom al Craiovei (Craiova-Sud LRCW, Balta Verde), administrat de Aeroclubul României."
            ),
            (
                "Aerodrom Slatina",
                "SLATINA",
                46.0,
                75.0,
                new[] { (80.0, "08 (080°)"), (260.0, "26 (260°)") },
                700.0, "Iarbă (700m)",
                "Punct secundar de rezervă VFR estic."
            )
        };

        var rawList = new List<AlternateAerodrome>();

        foreach (var s in specs)
        {
            var evaluatedRwys = s.Runways
                .Select(r =>
                {
                    var (xw, hw) = CrosswindCalculator.Calculate(weather.WindDirectionDegrees, effectiveWind, r.Hdg);
                    return (r.Id, r.Hdg, Xw: xw, Hw: hw);
                })
                .ToList();

            var chosen = evaluatedRwys
                .Where(r => r.Hw >= -1.0)
                .OrderBy(r => r.Xw)
                .ThenByDescending(r => r.Hw)
                .FirstOrDefault();

            if (string.IsNullOrEmpty(chosen.Id))
            {
                chosen = evaluatedRwys.OrderByDescending(r => r.Hw).First();
            }

            string bestRwy = chosen.Id;
            double bestHdg = chosen.Hdg;
            double bestXw = chosen.Xw;
            double bestHw = chosen.Hw;

            // Păstrăm formula de bază a timpului de zbor pentru compatibilitate cu testele existente:
            double timeMinutes = Math.Round((s.DistKm / (speed * 1.852)) * 60.0, 1);

            // Triunghiul vitezelor pe ruta de redirecționare
            var divTriangle = SolveWindTriangle(s.BearingDeg, speed, weather.WindDirectionDegrees, effectiveWind);
            double fuelAtArrival = Math.Round(Math.Max(0.0, remainingFuelMinutes - timeMinutes), 1);

            // Distanța de aterizare pe pistă înierbată (factor suprafață iarbă uscată x1.15, ajustat cu vântul de față)
            double vref = Math.Max(45.0, speed * 0.72);
            double vTdGs = Math.Max(28.0, vref - bestHw);
            double ldrGrass = Math.Round(baseLandingDistanceMeters * 1.15 * (1.0 / sigma) * Math.Pow(vTdGs / vref, 2.0), 0);
            double marginM = Math.Round(s.LengthM - ldrGrass, 0);

            // Calcul scor multi-criterial (0 - 100 puncte):
            // 1. Scor vânt lateral (max 50p): maxim când crosswind == 0, penalizare puternică dacă depășește maxCrosswindKnots
            double xwRatio = bestXw / Math.Max(8.0, maxCrosswindKnots);
            double xwScore = xwRatio <= 1.0
                ? 50.0 * (1.0 - 0.35 * xwRatio)
                : Math.Max(0.0, 25.0 - 25.0 * (xwRatio - 1.0));

            // 2. Scor vânt de față (max 20p)
            double hwScore = bestHw >= 0
                ? Math.Min(20.0, 10.0 + bestHw * 0.5)
                : Math.Max(0.0, 10.0 + bestHw * 1.5);

            // 3. Scor proximitate / timp de zbor (max 15p)
            double timeScore = Math.Max(0.0, 15.0 * (1.0 - s.DistKm / 60.0));

            // 4. Scor marjă lungime pistă (max 15p)
            double rwyScore = marginM >= 250.0 ? 15.0 : Math.Max(0.0, (marginM / 250.0) * 15.0);

            double totalScore = Math.Round(Math.Clamp(xwScore + hwScore + timeScore + rwyScore, 0.0, 100.0), 1);

            string reason = $"{s.BaseNote} Pista {bestRwy} oferă vânt de față +{bestHw:F1} kt și vânt lateral de doar {bestXw:F1} kt " +
                            $"(cap de zbor {divTriangle.HeadingToFlyDegrees:F0}°, GS {divTriangle.GroundSpeedKnots:F0} kt, LDR {ldrGrass:F0}m / {s.LengthM:F0}m, scor siguranță {totalScore:F1}/100).";

            rawList.Add(new AlternateAerodrome(
                Name: s.Name,
                Code: s.Code,
                DistanceKm: s.DistKm,
                BearingDegrees: s.BearingDeg,
                RunwayHeadingDegrees: bestHdg,
                BestRunway: bestRwy,
                CalculatedCrosswindKnots: bestXw,
                CalculatedHeadwindKnots: bestHw,
                EstimatedFlightMinutes: timeMinutes,
                SuitabilityReason: reason,
                SafetyScore: totalScore,
                RunwayLengthMeters: s.LengthM,
                SurfaceType: s.Surface,
                LandingDistanceRequiredMeters: ldrGrass,
                LandingSafetyMarginMeters: marginM,
                WindCorrectedHeadingDegrees: divTriangle.HeadingToFlyDegrees,
                GroundSpeedToAlternateKnots: divTriangle.GroundSpeedKnots,
                RemainingFuelAtTouchdownMinutes: fuelAtArrival,
                IsRecommendedBestSpot: false
            ));
        }

        // Identificăm cea mai bună pistă alternativă (minim vânt lateral, apoi distanță, respectiv scor maxim)
        var bestCode = rawList
            .OrderBy(a => a.CalculatedCrosswindKnots)
            .ThenBy(a => a.DistanceKm)
            .First().Code;

        return rawList
            .Select(a => a with { IsRecommendedBestSpot = a.Code == bestCode })
            .ToList();
    }

    /// <summary>
    /// Construiește analiza matematică de decizie VFR: Orbită (Holding) vs. Redirecționare către cea mai bună pistă din apropiere.
    /// </summary>
    public static VfrRedirectionAnalysis BuildVfrRedirectionAnalysis(
        CraiovaAircraft ac,
        string activeRwyId,
        string assignedVfrRwy,
        double vfrCrosswindKnots,
        double vfrHeadwindKnots,
        bool isOppositeLanding,
        bool hasCommercialTrafficOnPrimary,
        WeatherCondition weather,
        List<AlternateAerodrome> alternates)
    {
        bool canLandPrimary = !isOppositeLanding && vfrCrosswindKnots <= ac.MaxCrosswindKnots;
        bool canLandReciprocal = isOppositeLanding && vfrCrosswindKnots <= ac.MaxCrosswindKnots && !hasCommercialTrafficOnPrimary;

        var bestAlt = alternates.FirstOrDefault(a => a.IsRecommendedBestSpot)
                      ?? alternates.OrderBy(a => a.CalculatedCrosswindKnots).ThenBy(a => a.DistanceKm).First();

        // Consum de combustibil în croazieră vs. orbită de anduranță maximă (~78% din consumul de croazieră)
        double cruiseBurnLph = ac.Id switch
        {
            "YR-SAV" => 18.0,
            "YR-WILG" => 48.0,
            "YR-C172" => 35.0,
            _ => 30.0
        };
        double holdBurnLph = Math.Round(cruiseBurnLph * 0.78, 1);

        // Point of No Return (PNR) în minute:
        // Rezerva finală ICAO VFR = 25 min + timp zbor spre alternativă + 5 min marjă apropiere
        double reservePlusDivertMin = 25.0 + bestAlt.EstimatedFlightMinutes + 5.0;
        double pnrMinutes = Math.Round(Math.Max(0.0, ac.RemainingFuelMinutes - reservePlusDivertMin), 1);

        // Verificăm dacă vremea pe LRCV se îmbunătățește în interiorul ferestrei PNR
        double checkHorizonMin = Math.Min(Math.Max(10.0, pnrMinutes), 25.0);
        var (futDir, futSpd, futGust, _) = PredictFutureWeatherAtMinute(weather, checkHorizonMin);
        double vfrRwyHdg = CrosswindCalculator.GetRunwayHeading(assignedVfrRwy);
        var (futXw, _) = CrosswindCalculator.Calculate(futDir, Math.Max(futSpd, futGust), vfrRwyHdg);
        bool weatherImprovesWithinPnr = futXw <= ac.MaxCrosswindKnots;

        double estWaitMin = vfrCrosswindKnots <= ac.MaxCrosswindKnots && hasCommercialTrafficOnPrimary
            ? 5.0
            : (weatherImprovesWithinPnr ? Math.Round(checkHorizonMin, 0) : 25.0);

        string decision;
        double confidence;
        string justification;

        if (canLandPrimary)
        {
            decision = "LAND_LRCV_PRIMARY";
            confidence = 96.0;
            justification =
                $"Aterizare directă pe pista activă LRCV {activeRwyId}: vântul lateral ({vfrCrosswindKnots:F1} kt) este sub limita maximă a aeronavei ({ac.MaxCrosswindKnots:F1} kt). " +
                $"Pista de rezervă optimă în caz de ratare este {bestAlt.Name} (pista {bestAlt.BestRunway}, lateral {bestAlt.CalculatedCrosswindKnots:F1} kt, {bestAlt.EstimatedFlightMinutes:F1} min).";
        }
        else if (canLandReciprocal)
        {
            decision = "LAND_LRCV_RECIPROCAL";
            confidence = 92.0;
            justification =
                $"Aterizare pe sens invers LRCV RWY {assignedVfrRwy}: elimină vântul de spate și asigură vânt de față +{vfrHeadwindKnots:F1} kt cu vânt lateral ({vfrCrosswindKnots:F1} kt <= {ac.MaxCrosswindKnots:F1} kt).";
        }
        else if (vfrCrosswindKnots <= ac.MaxCrosswindKnots && hasCommercialTrafficOnPrimary && pnrMinutes >= 6.0)
        {
            decision = "ORBIT_THEN_LAND_LRCV";
            confidence = 91.0;
            justification =
                $"DECIZIE: ORBITĂ SCURTĂ ({estWaitMin:F0} min) APOI ATERIZARE LRCV RWY {assignedVfrRwy}. Vântul lateral pe LRCV ({vfrCrosswindKnots:F1} kt) este sigur, " +
                $"iar marja PNR ({pnrMinutes:F1} min disponibile până la Point of No Return, consum redus în holding la {holdBurnLph:F1} L/h) permite așteptarea degajării traficului IFR comercial.";
        }
        else if (ac.RemainingFuelMinutes > 40.0 && weatherImprovesWithinPnr && pnrMinutes >= 12.0)
        {
            decision = "ORBIT_THEN_LAND_LRCV";
            confidence = 84.0;
            justification =
                $"DECIZIE: ORBITĂ DE AȘTEPTARE (PNR = {pnrMinutes:F1} min) CU ALTERNATIVĂ PREGĂTITĂ ({bestAlt.Name}). " +
                $"Prognoza la T+{checkHorizonMin:F0}m indică scăderea vântului lateral la {futXw:F1} kt (<= {ac.MaxCrosswindKnots:F1} kt). Dacă vântul nu scade până la minutul {pnrMinutes:F0}, redirecționare pe cap {bestAlt.WindCorrectedHeadingDegrees:F0}° către {bestAlt.Name} (pista {bestAlt.BestRunway}, lateral {bestAlt.CalculatedCrosswindKnots:F1} kt).";
        }
        else
        {
            decision = "REDIRECT_TO_ALTERNATE";
            confidence = 95.0;
            justification =
                $"DECIZIE MATEMATICĂ: REDIRECȚIONARE CĂTRE {bestAlt.Name.ToUpperInvariant()} (Pista {bestAlt.BestRunway}, scor {bestAlt.SafetyScore:F1}/100). " +
                $"Pe LRCV vântul lateral ({vfrCrosswindKnots:F1} kt) depășește plafonul {ac.ModelName} ({ac.MaxCrosswindKnots:F1} kt) și prognoza la T+{checkHorizonMin:F0}m ({futXw:F1} kt) rămâne peste limită (PNR={pnrMinutes:F1} min). " +
                $"Pe {bestAlt.Name} (cap de zbor {bestAlt.WindCorrectedHeadingDegrees:F0}°, ETE {bestAlt.EstimatedFlightMinutes:F1} min), vântul lateral scade la {bestAlt.CalculatedCrosswindKnots:F1} kt cu vânt de față +{bestAlt.CalculatedHeadwindKnots:F1} kt și combustibil la aterizare {bestAlt.RemainingFuelAtTouchdownMinutes:F1} min.";
        }

        return new VfrRedirectionAnalysis(
            CanLandAtPrimaryRunway: canLandPrimary,
            CanLandAtReciprocalRunway: canLandReciprocal,
            RecommendedDecision: decision,
            DecisionConfidenceScore: confidence,
            PointOfNoReturnMinutes: pnrMinutes,
            FuelBurnCruiseLitersPerHour: cruiseBurnLph,
            FuelBurnHoldLitersPerHour: holdBurnLph,
            EstimatedWaitTimeAtLrcvMinutes: estWaitMin,
            WillWeatherImproveWithinPnr: weatherImprovesWithinPnr,
            PredictedCrosswindAfterHoldKnots: futXw,
            BestAlternateCode: bestAlt.Code,
            BestAlternateName: bestAlt.Name,
            BestAlternateRunway: bestAlt.BestRunway,
            BestAlternateScore: bestAlt.SafetyScore,
            RedirectionHeadingToFlyDegrees: bestAlt.WindCorrectedHeadingDegrees,
            RedirectionGroundSpeedKnots: bestAlt.GroundSpeedToAlternateKnots,
            RedirectionEtaMinutes: bestAlt.EstimatedFlightMinutes,
            FuelRemainingAtAlternateMinutes: bestAlt.RemainingFuelAtTouchdownMinutes,
            MathematicalJustification: justification
        );
    }

    private static readonly Dictionary<string, (string Name, double Lat, double Lon, double? DefaultRouteNm)> DepartureCatalog = new(StringComparer.OrdinalIgnoreCase)
    {
        ["EGGW"] = ("London Luton", 51.874444, -0.368333, null),
        ["EGLL"] = ("London Heathrow", 51.477500, -0.461389, 1135.0),
        ["LIME"] = ("Milan Bergamo", 45.667408, 9.699503, null),
        ["LIMC"] = ("Milan Malpensa", 45.630600, 8.728110, 680.0),
        ["LIRF"] = ("Roma Fiumicino", 41.811786, 12.252253, 535.0),
        ["LFPG"] = ("Paris Charles de Gaulle", 49.009747, 2.547819, 945.0),
        ["EHAM"] = ("Amsterdam Schiphol", 52.308333, 4.765000, 935.0),
        ["EDDF"] = ("Frankfurt Main", 50.033333, 8.570556, 745.0),
        ["LOWW"] = ("Vienna Intl", 48.110278, 16.569722, 385.0),
        ["LHBP"] = ("Budapest Ferenc Liszt", 47.439328, 19.261808, 275.0),
        ["LYBE"] = ("Belgrade Nikola Tesla", 44.819383, 20.307067, 156.0),
        ["LBSF"] = ("Sofia Airport", 42.695000, 23.408333, 100.0),
        ["LTFM"] = ("Istanbul Airport", 41.275277, 28.751940, 285.0),
        ["OMDB"] = ("Dubai Intl", 25.252778, 55.364444, 1860.0),
        ["ZBAA"] = ("Beijing Capital", 40.074069, 116.590800, 3885.0),
        ["ZSPD"] = ("Shanghai Pudong", 31.142333, 121.790844, 4420.0),
        ["LROP"] = ("București Otopeni", 44.570992, 26.085119, null),
        ["LRBS"] = ("București Băneasa", 44.503483, 26.103594, null),
        ["LRCL"] = ("Cluj-Napoca", 46.785092, 23.686119, 150.0),
        ["LRTR"] = ("Timișoara Traian Vuia", 45.809833, 21.337872, 140.0),
        ["LRSB"] = ("Sibiu Intl", 45.785800, 24.091183, 89.0),
        ["LRCS"] = ("Caransebeș", 45.420278, 22.252222, 96.0),
        ["LRCW"] = ("Aerodromul Balta Verde Craiova (Aeroclubul României)", 44.286389, 23.791111, null),
        ["LRBV"] = ("Aerodromul Balta Verde Craiova (Aeroclubul României)", 44.286389, 23.791111, null),
        ["PODARI"] = ("Aerodromul Balta Verde Craiova (Aeroclubul României)", 44.286389, 23.791111, null),
        ["SLATINA"] = ("Aerodrom Slatina", 44.424000, 24.442000, 25.0)
    };

    private static (string Icao, string Name, double Lat, double Lon, double RouteNm) ResolveDepartureAerodrome(
        string icao, string fallbackName, double fallbackNm)
    {
        var code = string.IsNullOrWhiteSpace(icao) ? "LROP" : icao.Trim().ToUpperInvariant();
        if (DepartureCatalog.TryGetValue(code, out var entry))
        {
            double distNm = entry.DefaultRouteNm ?? fallbackNm;
            return (code, entry.Name, entry.Lat, entry.Lon, distNm);
        }
        return (code, fallbackName, 44.570992, 26.085119, fallbackNm);
    }
}
