using Aeris.PlanningEngine.Models;
using Aeris.PlanningEngine.Models.TrajectorySeparation;
using Aeris.PlanningEngine.Services.TrajectorySeparation;

namespace Aeris.PlanningEngine.Services;

public class CraiovaAdvisoryEngine : ICraiovaAdvisoryEngine
{
    private readonly IPlanningService _planningService;
    private readonly ITrajectorySeparationEngine _separationEngine;

    public CraiovaAdvisoryEngine(IPlanningService planningService, ITrajectorySeparationEngine? separationEngine = null)
    {
        _planningService = planningService;
        _separationEngine = separationEngine ?? new TrajectorySeparationEngine();
    }

    public CraiovaSimulationResult EvaluateSimulation(
        List<CraiovaAircraft> aircrafts,
        WeatherCondition weather,
        string dataSource = "OpenSky Live / Craiova Simulation",
        bool useTrajectoryEngine = true)
    {
        // 1. Calcul componente vânt pe pista de referință Craiova (08/26)
        double effectiveWindSpeed = Math.Max(weather.WindSpeedKnots, weather.WindGustKnots);
        string activeRwyId;
        double activeRwyHeading;
        double crosswindCraiova;
        double headwindCraiova;

        if (!string.IsNullOrWhiteSpace(weather.ForceRunwayInUse))
        {
            activeRwyId = RunwayConfiguration.Normalize(weather.ForceRunwayInUse);
            activeRwyHeading = CrosswindCalculator.GetRunwayHeading(activeRwyId);
            (crosswindCraiova, headwindCraiova) = CrosswindCalculator.Calculate(weather.WindDirectionDegrees, effectiveWindSpeed, activeRwyHeading);
        }
        else
        {
            (activeRwyId, activeRwyHeading, crosswindCraiova, headwindCraiova) =
                CrosswindCalculator.DetermineActiveRunwayCraiova(weather.WindDirectionDegrees, effectiveWindSpeed);
        }

        bool isCrosswindCriticalForLight = crosswindCraiova > 12.0;

        var advisories = new List<AircraftAdvisory>();
        var clearedForLandingInputs = new List<AircraftInput>();
        int ifrHoldingCount = 0;
        int vfrHoldingCount = 0;

        // Verificăm dacă există trafic comercial IFR activ pe pista principală
        bool hasCommercialTrafficOnPrimary = aircrafts.Any(a =>
            (a.Category == AircraftCategory.CommercialJet || a.Category == AircraftCategory.RegionalTurboprop) &&
            crosswindCraiova <= a.MaxCrosswindKnots);

        // 2. Evaluare fiecare aeronavă conform priorităților, vântului de spate și limitelor meteo
        foreach (var ac in aircrafts)
        {
            // REGULA DE PRIORITATE: Aeronavele comerciale IFR (A320/B737)
            if (ac.Category == AircraftCategory.CommercialJet || ac.Category == AircraftCategory.RegionalTurboprop)
            {
                bool isCrosswindExceeded = crosswindCraiova > ac.MaxCrosswindKnots;
                bool isTailwindSevere = headwindCraiova < -10.0; // Peste 10-15 kts vânt de spate este limită pentru avioane mari

                if (!isCrosswindExceeded && !isTailwindSevere)
                {
                    string tailwindNote = headwindCraiova < 0
                        ? $" (Vânt de spate ușor de {Math.Abs(headwindCraiova)} kts, în limita certificată IFR de 10 kts)."
                        : $" (Vânt de față de +{headwindCraiova} kts).";

                    advisories.Add(new AircraftAdvisory(
                        AircraftId: ac.Id,
                        Callsign: ac.Callsign,
                        ModelName: ac.ModelName,
                        Category: ac.Category,
                        FlightRules: ac.FlightRules,
                        HasInstrumentAvionics: ac.HasInstrumentAvionics,
                        AssignedRunway: activeRwyId,
                        CurrentCrosswindKnots: crosswindCraiova,
                        CurrentHeadwindKnots: headwindCraiova,
                        MaxCrosswindLimitKnots: ac.MaxCrosswindKnots,
                        IsOppositeDirectionLanding: false,
                        OppositeDirectionAdvice: null,
                        AdvisoryStatus: AdvisoryStatus.ClearedForApproach,
                        AdvisoryReason: $"Zbor comercial IFR prioritar. Vânt lateral ({crosswindCraiova} kts) în limitele de siguranță ({ac.MaxCrosswindKnots} kts). Liber apropiere pista {activeRwyId}{tailwindNote}"
                    ));

                    clearedForLandingInputs.Add(new AircraftInput(
                        ac.Id,
                        ac.FlightRules,
                        ac.EtaSeconds,
                        ac.EarliestSeconds,
                        ac.LatestSeconds,
                        ac.FrozenTimeSeconds
                    ));
                }
                else
                {
                    double ifrHoldAlt = useTrajectoryEngine ? 4000.0 + (ifrHoldingCount * 1000.0) : 4000.0;
                    string ifrFix = RunwayConfiguration.Normalize(activeRwyId) == RunwayConfiguration.Runway26 ? "OZZET" : "NECCO";
                    var ifrFixWp = AipAirwayData.Waypoints[ifrFix];
                    ifrHoldingCount++;

                    var ifrRacetrack = useTrajectoryEngine ? new HoldingRacetrackConfig(
                        FixId: ifrFix,
                        FixLatitude: ifrFixWp.Latitude,
                        FixLongitude: ifrFixWp.Longitude,
                        InboundHeadingDegrees: activeRwyHeading,
                        TurnDirection: "Right",
                        LegDurationSeconds: 60.0,
                        SpeedKnots: ac.SpeedKnots > 0 ? ac.SpeedKnots : 210.0,
                        AltitudeFeet: ifrHoldAlt,
                        EntryTimeSeconds: ac.EtaSeconds,
                        DurationSeconds: 15 * 60
                    ) : null;

                    advisories.Add(new AircraftAdvisory(
                        AircraftId: ac.Id,
                        Callsign: ac.Callsign,
                        ModelName: ac.ModelName,
                        Category: ac.Category,
                        FlightRules: ac.FlightRules,
                        HasInstrumentAvionics: ac.HasInstrumentAvionics,
                        AssignedRunway: activeRwyId,
                        CurrentCrosswindKnots: crosswindCraiova,
                        CurrentHeadwindKnots: headwindCraiova,
                        MaxCrosswindLimitKnots: ac.MaxCrosswindKnots,
                        IsOppositeDirectionLanding: false,
                        OppositeDirectionAdvice: null,
                        AdvisoryStatus: AdvisoryStatus.HoldInOrbitRecommended,
                        AdvisoryReason: isTailwindSevere
                            ? $"Vânt de spate excesiv ({Math.Abs(headwindCraiova)} kts > 10 kts). Se recomandă holding IFR sau schimbarea pistei în uz."
                            : $"Vânt lateral sever ({crosswindCraiova} kts > {ac.MaxCrosswindKnots} kts). Holding IFR standard.",
                        OrbitAdvice: new OrbitPatternAdvice(
                            PatternName: useTrajectoryEngine
                                ? $"Hipodrom IFR {ifrFix} ({ifrHoldAlt:F0} ft QNH)"
                                : "Standard IFR Holding Craiova (VOR/DME CRA)",
                            RecommendedAltitudeFeet: ifrHoldAlt,
                            HoldingDurationMinutes: 15,
                            RemainingFuelMarginMinutes: ac.RemainingFuelMinutes - 20,
                            SafetyInstructions: useTrajectoryEngine
                                ? $"Mențineți hipodromul publicat la {ifrFix}, nivelul {ifrHoldAlt:F0} ft (eșalonat vertical la 1.000 ft) până la stabilizarea condițiilor de vânt."
                                : "Așteptare în holding standard până la stabilizarea condițiilor de vânt.",
                            Racetrack: ifrRacetrack
                        )
                    ));
                }
            }
            else
            {
                // Aeronave mici de agrement (ICP Savannah, PZL-104 Wilga, Cessna 172)
                double baseLdr = ac.Id == "YR-SAV" ? 95.0 : (ac.Id == "YR-WILG" ? 125.0 : 160.0);
                var alternates = FlightPhysicsAndPredictionEngine.EvaluateAlternatesWithMath(
                    weather,
                    ac.SpeedKnots,
                    ac.MaxCrosswindKnots,
                    ac.RemainingFuelMinutes,
                    baseLdr);

                // REGULA VÂNTULUI DE SPATE PENTRU AERONAVELE VFR:
                // Dacă pe pista curentă există vânt de spate (headwind < 0), se execută manevra în sens invers (reciprocal runway)
                string vfrRunway = activeRwyId;
                double vfrRunwayHeading = activeRwyHeading;
                double vfrCrosswind = crosswindCraiova;
                double vfrHeadwind = headwindCraiova;
                bool isOppositeLanding = false;
                string? oppositeAdvice = null;

                if (headwindCraiova < 0)
                {
                    // Vânt de spate detectat! Inversăm sensul de aterizare pentru a avea vânt de față
                    isOppositeLanding = true;
                    vfrRunway = CrosswindCalculator.GetReciprocalRunway(activeRwyId);
                    vfrRunwayHeading = CrosswindCalculator.GetRunwayHeading(vfrRunway);
                    (vfrCrosswind, vfrHeadwind) = CrosswindCalculator.Calculate(weather.WindDirectionDegrees, effectiveWindSpeed, vfrRunwayHeading);

                    double tailwindAvoided = Math.Abs(headwindCraiova);
                    oppositeAdvice = $"VÂNT DE SPATE DETECTAT pe pista {activeRwyId} ({tailwindAvoided} kts). " +
                                     $"Pentru siguranță, aeronava VFR execută manevra de aterizare în SENS INVERS pe Pista {vfrRunway} (cap {vfrRunwayHeading}°), " +
                                     $"asigurând un vânt de față de +{vfrHeadwind} kts.";
                }

                bool isCrosswindExceeded = vfrCrosswind > ac.MaxCrosswindKnots;
                var vfrRedirection = FlightPhysicsAndPredictionEngine.BuildVfrRedirectionAnalysis(
                    ac,
                    activeRwyId,
                    vfrRunway,
                    vfrCrosswind,
                    vfrHeadwind,
                    isOppositeLanding,
                    hasCommercialTrafficOnPrimary,
                    weather,
                    alternates);

                if (isCrosswindExceeded)
                {
                    // Vântul lateral depășește limita avionului mic chiar și pe sensul optim
                    bool canHoldInOrbit = ac.RemainingFuelMinutes > 40;
                    var status = canHoldInOrbit ? AdvisoryStatus.HoldInOrbitRecommended : AdvisoryStatus.DivertRecommended;

                    double vfrHoldAlt = useTrajectoryEngine ? 1500.0 + (vfrHoldingCount * 1000.0) : 1500.0;
                    vfrHoldingCount++;

                    var vfrRacetrack = useTrajectoryEngine ? new HoldingRacetrackConfig(
                        FixId: "CARCEA",
                        FixLatitude: 44.2764,
                        FixLongitude: 23.8886,
                        InboundHeadingDegrees: activeRwyHeading,
                        TurnDirection: "Right",
                        LegDurationSeconds: 60.0,
                        SpeedKnots: ac.SpeedKnots > 0 ? ac.SpeedKnots : 90.0,
                        AltitudeFeet: vfrHoldAlt,
                        EntryTimeSeconds: ac.EtaSeconds,
                        DurationSeconds: 12 * 60
                    ) : null;

                    var orbitAdvice = new OrbitPatternAdvice(
                        PatternName: useTrajectoryEngine
                            ? $"Circuit hipodrom VFR latura sudică pista {vfrRunway} (Cârcea la {vfrHoldAlt:F0} ft)"
                            : $"Orbită de așteptare paralelă cu latura sudică a pistei {vfrRunway} (Cârcea - Pielești)",
                        RecommendedAltitudeFeet: vfrHoldAlt,
                        HoldingDurationMinutes: 12,
                        RemainingFuelMarginMinutes: ac.RemainingFuelMinutes - 15,
                        SafetyInstructions: useTrajectoryEngine
                            ? $"Mențineți circuit hipodrom VFR la {vfrHoldAlt:F0} ft QNH (separare verticală 1.000 ft, PNR={vfrRedirection.PointOfNoReturnMinutes:F0} min), în afara zonei de turbulență de siaj. Alternativa optimă: {vfrRedirection.BestAlternateName} (pista {vfrRedirection.BestAlternateRunway}, cap {vfrRedirection.RedirectionHeadingToFlyDegrees:F0}°)."
                            : "Mențineți zbor vizual (VFR) la 1500 ft QNH paralel cu axul pistei, în afara zonei de turbulență de siaj. Cedați prioritatea traficului comercial.",
                        Racetrack: vfrRacetrack
                    );

                    string reason = $"Vântul lateral ({vfrCrosswind} kts) depășește limita maximă admisă pentru {ac.ModelName} ({ac.MaxCrosswindKnots} kts). " +
                                    (oppositeAdvice != null ? $"[{oppositeAdvice}] " : "") +
                                    (canHoldInOrbit
                                        ? $"Se recomandă orbită de așteptare (PNR {vfrRedirection.PointOfNoReturnMinutes:F0} min) sau redirecționare către {vfrRedirection.BestAlternateName} (pista {vfrRedirection.BestAlternateRunway}, cap {vfrRedirection.RedirectionHeadingToFlyDegrees:F0}°, scor {vfrRedirection.BestAlternateScore:F1}/100)."
                                        : $"Rezervele de combustibil impun devierea imediată către {vfrRedirection.BestAlternateName} (pista {vfrRedirection.BestAlternateRunway}, cap {vfrRedirection.RedirectionHeadingToFlyDegrees:F0}°).");

                    advisories.Add(new AircraftAdvisory(
                        AircraftId: ac.Id,
                        Callsign: ac.Callsign,
                        ModelName: ac.ModelName,
                        Category: ac.Category,
                        FlightRules: ac.FlightRules,
                        HasInstrumentAvionics: ac.HasInstrumentAvionics,
                        AssignedRunway: vfrRunway,
                        CurrentCrosswindKnots: vfrCrosswind,
                        CurrentHeadwindKnots: vfrHeadwind,
                        MaxCrosswindLimitKnots: ac.MaxCrosswindKnots,
                        IsOppositeDirectionLanding: isOppositeLanding,
                        OppositeDirectionAdvice: oppositeAdvice,
                        AdvisoryStatus: status,
                        AdvisoryReason: reason,
                        OrbitAdvice: orbitAdvice,
                        RecommendedAlternates: alternates,
                        VfrRedirection: vfrRedirection
                    ));
                }
                else
                {
                    // Vântul lateral este acceptabil. Verificăm deconflictualizarea dacă aterizează din sens opus cu zboruri IFR comerciale
                    if (isOppositeLanding && hasCommercialTrafficOnPrimary)
                    {
                        // Există zbor comercial care aterizează pe sensul opus; avionul mic așteaptă în orbită până se eliberează pista
                        double vfrHoldAlt = useTrajectoryEngine ? 1500.0 + (vfrHoldingCount * 1000.0) : 1500.0;
                        vfrHoldingCount++;

                        var vfrRacetrack = useTrajectoryEngine ? new HoldingRacetrackConfig(
                            FixId: "CARCEA",
                            FixLatitude: 44.2764,
                            FixLongitude: 23.8886,
                            InboundHeadingDegrees: activeRwyHeading,
                            TurnDirection: "Right",
                            LegDurationSeconds: 60.0,
                            SpeedKnots: ac.SpeedKnots > 0 ? ac.SpeedKnots : 90.0,
                            AltitudeFeet: vfrHoldAlt,
                            EntryTimeSeconds: ac.EtaSeconds,
                            DurationSeconds: 5 * 60
                        ) : null;

                        var orbitAdvice = new OrbitPatternAdvice(
                            PatternName: useTrajectoryEngine
                                ? $"Circuit hipodrom deconflictualizare (Latura sudică, Cârcea, {vfrHoldAlt:F0} ft)"
                                : "Orbită de așteptare deconflictualizare (Latura sudică, Cârcea, 1500 ft)",
                            RecommendedAltitudeFeet: vfrHoldAlt,
                            HoldingDurationMinutes: 5,
                            RemainingFuelMarginMinutes: ac.RemainingFuelMinutes - 10,
                            SafetyInstructions: useTrajectoryEngine
                                ? $"Așteptați în circuit hipodrom la {vfrHoldAlt:F0} ft până când zborul comercial IFR din sens opus (pista {activeRwyId}) aterizează și eliberează pista. Ulterior, liber pentru aterizare în sens invers pe pista {vfrRunway} cu vânt de față (+{vfrHeadwind} kts)."
                                : $"Așteptați în orbită la Cârcea până când zborul comercial IFR din sens opus (pista {activeRwyId}) aterizează și eliberează pista. Ulterior, liber pentru aterizare în sens invers pe pista {vfrRunway} cu vânt de față (+{vfrHeadwind} kts).",
                            Racetrack: vfrRacetrack
                        );

                        advisories.Add(new AircraftAdvisory(
                            AircraftId: ac.Id,
                            Callsign: ac.Callsign,
                            ModelName: ac.ModelName,
                            Category: ac.Category,
                            FlightRules: ac.FlightRules,
                            HasInstrumentAvionics: ac.HasInstrumentAvionics,
                            AssignedRunway: vfrRunway,
                            CurrentCrosswindKnots: vfrCrosswind,
                            CurrentHeadwindKnots: vfrHeadwind,
                            MaxCrosswindLimitKnots: ac.MaxCrosswindKnots,
                            IsOppositeDirectionLanding: true,
                            OppositeDirectionAdvice: oppositeAdvice,
                            AdvisoryStatus: AdvisoryStatus.HoldInOrbitRecommended,
                            AdvisoryReason: $"Manevră în sens invers aprobată pe Pista {vfrRunway} (vânt de față +{vfrHeadwind} kts), dar se recomandă orbită scurtă de așteptare pentru a permite aeronavei comerciale din sens opus ({activeRwyId}) să elibereze pista.",
                            OrbitAdvice: orbitAdvice,
                            RecommendedAlternates: alternates,
                            VfrRedirection: vfrRedirection
                        ));
                    }
                    else
                    {
                        // Liber pentru aterizare
                        string reasonDesc = isOppositeLanding
                            ? $"Aterizare autorizată pe sens invers (Pista {vfrRunway}): vântul de spate de pe pista {activeRwyId} a fost transformat în vânt de față de +{vfrHeadwind} kts. Vânt lateral ({vfrCrosswind} kts) în limitele de siguranță."
                            : $"Vânt lateral ({vfrCrosswind} kts) și vânt de față (+{vfrHeadwind} kts) acceptabile pe pista {vfrRunway}. Liber pentru apropiere.";

                        advisories.Add(new AircraftAdvisory(
                            AircraftId: ac.Id,
                            Callsign: ac.Callsign,
                            ModelName: ac.ModelName,
                            Category: ac.Category,
                            FlightRules: ac.FlightRules,
                            HasInstrumentAvionics: ac.HasInstrumentAvionics,
                            AssignedRunway: vfrRunway,
                            CurrentCrosswindKnots: vfrCrosswind,
                            CurrentHeadwindKnots: vfrHeadwind,
                            MaxCrosswindLimitKnots: ac.MaxCrosswindKnots,
                            IsOppositeDirectionLanding: isOppositeLanding,
                            OppositeDirectionAdvice: oppositeAdvice,
                            AdvisoryStatus: AdvisoryStatus.ClearedForApproach,
                            AdvisoryReason: reasonDesc,
                            RecommendedAlternates: alternates,
                            VfrRedirection: vfrRedirection
                        ));

                        clearedForLandingInputs.Add(new AircraftInput(
                            ac.Id,
                            ac.FlightRules,
                            ac.EtaSeconds,
                            ac.EarliestSeconds,
                            ac.LatestSeconds,
                            ac.FrozenTimeSeconds
                        ));
                    }
                }
            }
        }

        // 3. Calcul orare optime pentru aeronavele permise la aterizare
        PlanningResponse? landingSequences = null;
        SafetyAssessmentResult? safetyAssessment = null;

        if (clearedForLandingInputs.Count > 0)
        {
            var rules = new ScenarioRules(MinimumGapSeconds: 120, AllowVfr: true, BaseTimeOffsetSeconds: 50400);
            landingSequences = _planningService.EvaluateScenario(clearedForLandingInputs, rules);

            var bestVariant = landingSequences.ValidVariants.FirstOrDefault();
            if (bestVariant != null)
            {
                if (useTrajectoryEngine)
                {
                    var clearedAircraftList = aircrafts.Where(a => clearedForLandingInputs.Any(ci => ci.Id == a.Id)).ToList();
                    safetyAssessment = _separationEngine.ValidateSchedule(clearedAircraftList, bestVariant.Schedule, activeRwyId);

                    // Replanificare automată dacă planul este nesigur (ex: încălcare siaj Light după Medium sau ocupare pistă)
                    if (!safetyAssessment.IsSafe)
                    {
                        bool hasWakeOrRotConflict = safetyAssessment.Conflicts.Any(c =>
                            c.Type == SeparationConflictType.WakeTurbulenceViolation ||
                            c.Type == SeparationConflictType.RunwayOccupancyViolation);

                        if (hasWakeOrRotConflict)
                        {
                            var safeRules = rules with { MinimumGapSeconds = 180 };
                            var replannedSeq = _planningService.EvaluateScenario(clearedForLandingInputs, safeRules);
                            var replannedBest = replannedSeq.ValidVariants.FirstOrDefault();
                            if (replannedBest != null)
                            {
                                var reAss = _separationEngine.ValidateSchedule(clearedAircraftList, replannedBest.Schedule, activeRwyId);
                                if (reAss.IsSafe || reAss.Conflicts.Count < safetyAssessment.Conflicts.Count)
                                {
                                    landingSequences = replannedSeq;
                                    bestVariant = replannedBest;
                                    safetyAssessment = reAss;
                                }
                            }
                        }
                    }
                }

                for (int i = 0; i < advisories.Count; i++)
                {
                    var adv = advisories[i];
                    var slot = bestVariant.Schedule.FirstOrDefault(s => s.AircraftId == adv.AircraftId);
                    if (slot != null)
                    {
                        advisories[i] = adv with { AssignedLandingSlot = slot };
                    }
                }
            }
        }

        // Validăm și aeronavele aflate în holding ca să raportăm eventuale conflicte în circuitele de așteptare
        var holdingInputs = advisories
            .Where(a => a.AdvisoryStatus == AdvisoryStatus.HoldInOrbitRecommended && a.OrbitAdvice?.Racetrack != null)
            .Select(a => (aircrafts.First(ac => ac.Id == a.AircraftId), a.OrbitAdvice!.Racetrack!))
            .ToList();

        if (holdingInputs.Count > 0)
        {
            var predictor = new TrajectoryPredictor();
            var holdingTrajs = holdingInputs.Select(h => predictor.PredictHoldingTrajectory(h.Item1, h.Item2)).ToList();
            if (safetyAssessment == null)
            {
                safetyAssessment = _separationEngine.ValidateSeparation(holdingTrajs);
            }
        }

        // 4. Atașăm analiza completă Takeoff-to-Landing și Predicția cu 2 Pași Înainte (Two Steps Ahead) pentru fiecare aeronavă
        for (int i = 0; i < advisories.Count; i++)
        {
            var adv = advisories[i];
            var ac = aircrafts.First(a => a.Id == adv.AircraftId);
            double landingTimeSec = adv.AssignedLandingSlot?.CalculatedTimeSeconds ?? ac.EtaSeconds;

            var ttl = FlightPhysicsAndPredictionEngine.BuildTakeoffToLanding(ac, adv.AssignedRunway, weather, landingTimeSec);
            var twoSteps = FlightPhysicsAndPredictionEngine.BuildTwoStepsAhead(ac, adv, weather, ttl);

            advisories[i] = adv with
            {
                TakeoffToLanding = ttl,
                TwoStepsAhead = twoSteps
            };
        }

        // 5. Predicția globală a viitorului (T+0 .. T+45m)
        var futurePrediction = FlightPhysicsAndPredictionEngine.BuildFuturePrediction(
            weather,
            aircrafts,
            advisories,
            activeRwyId);

        // 6. Statistici sumare
        var stats = new SimulationTrafficStats(
            TotalInbounds: aircrafts.Count,
            CommercialAirlinersCount: aircrafts.Count(a => a.Category == AircraftCategory.CommercialJet || a.Category == AircraftCategory.RegionalTurboprop),
            LightAircraftCount: aircrafts.Count(a => a.Category == AircraftCategory.GeneralAviation || a.Category == AircraftCategory.UltralightAndGlider),
            ClearedToLandCount: advisories.Count(a => a.AdvisoryStatus == AdvisoryStatus.ClearedForApproach),
            HoldingInOrbitCount: advisories.Count(a => a.AdvisoryStatus == AdvisoryStatus.HoldInOrbitRecommended),
            DivertAdvisedCount: advisories.Count(a => a.AdvisoryStatus == AdvisoryStatus.DivertRecommended)
        );

        return new CraiovaSimulationResult(
            Airport: new CraiovaAirportInfo(),
            Weather: weather,
            ActiveRunway: activeRwyId,
            ActiveRunwayCrosswindKnots: crosswindCraiova,
            ActiveRunwayHeadwindKnots: headwindCraiova,
            IsCrosswindCriticalForLightAircraft: isCrosswindCriticalForLight,
            Advisories: advisories,
            ClearedLandingSequences: landingSequences,
            Stats: stats,
            DataSource: dataSource,
            GeneratedAtUtc: DateTime.UtcNow,
            SafetyAssessment: safetyAssessment,
            FuturePrediction: futurePrediction
        );
    }

    public List<AlternateAerodrome> GetAlternateAerodromes(WeatherCondition weather, double aircraftCruiseSpeedKnots = 70)
    {
        return FlightPhysicsAndPredictionEngine.EvaluateAlternatesWithMath(weather, aircraftCruiseSpeedKnots);
    }
}
