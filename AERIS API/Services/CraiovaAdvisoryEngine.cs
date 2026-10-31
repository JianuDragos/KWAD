using Aeris.PlanningEngine.Models;

namespace Aeris.PlanningEngine.Services;

public class CraiovaAdvisoryEngine : ICraiovaAdvisoryEngine
{
    private readonly IPlanningService _planningService;

    public CraiovaAdvisoryEngine(IPlanningService planningService)
    {
        _planningService = planningService;
    }

    public CraiovaSimulationResult EvaluateSimulation(
        List<CraiovaAircraft> aircrafts,
        WeatherCondition weather,
        string dataSource = "OpenSky Live / Craiova Simulation")
    {
        // 1. Calcul componente vânt pe pista de referință Craiova (09/27)
        double effectiveWindSpeed = Math.Max(weather.WindSpeedKnots, weather.WindGustKnots);
        string activeRwyId;
        double activeRwyHeading;
        double crosswindCraiova;
        double headwindCraiova;

        if (!string.IsNullOrWhiteSpace(weather.ForceRunwayInUse))
        {
            activeRwyId = weather.ForceRunwayInUse;
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
                            PatternName: "Standard IFR Holding Craiova (VOR/DME CRA)",
                            RecommendedAltitudeFeet: 4000,
                            HoldingDurationMinutes: 15,
                            RemainingFuelMarginMinutes: ac.RemainingFuelMinutes - 20,
                            SafetyInstructions: "Așteptare în holding standard până la stabilizarea condițiilor de vânt."
                        )
                    ));
                }
            }
            else
            {
                // Aeronave mici de agrement (ICP Savannah, PZL-104 Wilga, Cessna 172)
                var alternates = GetAlternateAerodromes(weather, ac.SpeedKnots);

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

                if (isCrosswindExceeded)
                {
                    // Vântul lateral depășește limita avionului mic chiar și pe sensul optim
                    bool canHoldInOrbit = ac.RemainingFuelMinutes > 40;
                    var status = canHoldInOrbit ? AdvisoryStatus.HoldInOrbitRecommended : AdvisoryStatus.DivertRecommended;

                    var orbitAdvice = new OrbitPatternAdvice(
                        PatternName: $"Orbită de așteptare paralelă cu latura sudică a pistei {vfrRunway} (Cârcea - Pielești)",
                        RecommendedAltitudeFeet: 1500,
                        HoldingDurationMinutes: 12,
                        RemainingFuelMarginMinutes: ac.RemainingFuelMinutes - 15,
                        SafetyInstructions: "Mențineți zbor vizual (VFR) la 1500 ft QNH paralel cu axul pistei, în afara zonei de turbulență de siaj. Cedați prioritatea traficului comercial."
                    );

                    string reason = $"Vântul lateral ({vfrCrosswind} kts) depășește limita maximă admisă pentru {ac.ModelName} ({ac.MaxCrosswindKnots} kts). " +
                                    (oppositeAdvice != null ? $"[{oppositeAdvice}] " : "") +
                                    (canHoldInOrbit
                                        ? "Se recomandă orbită de așteptare sau deviere la Balta Verde / Podari unde vântul este mult mai favorabil."
                                        : "Rezervele de combustibil impun devierea imediată către Podari sau Balta Verde.");

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
                        RecommendedAlternates: alternates
                    ));
                }
                else
                {
                    // Vântul lateral este acceptabil. Verificăm deconflictualizarea dacă aterizează din sens opus cu zboruri IFR comerciale
                    if (isOppositeLanding && hasCommercialTrafficOnPrimary)
                    {
                        // Există zbor comercial care aterizează pe sensul opus; avionul mic așteaptă în orbită până se eliberează pista
                        var orbitAdvice = new OrbitPatternAdvice(
                            PatternName: $"Orbită de așteptare deconflictualizare (Latura sudică, Cârcea, 1500 ft)",
                            RecommendedAltitudeFeet: 1500,
                            HoldingDurationMinutes: 5,
                            RemainingFuelMarginMinutes: ac.RemainingFuelMinutes - 10,
                            SafetyInstructions: $"Așteptați în orbită la Cârcea până când zborul comercial IFR din sens opus (pista {activeRwyId}) aterizează și eliberează pista. Ulterior, liber pentru aterizare în sens invers pe pista {vfrRunway} cu vânt de față (+{vfrHeadwind} kts)."
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
                            RecommendedAlternates: alternates
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
                            RecommendedAlternates: alternates
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
        if (clearedForLandingInputs.Count > 0)
        {
            var rules = new ScenarioRules(MinimumGapSeconds: 120, AllowVfr: true, BaseTimeOffsetSeconds: 50400);
            landingSequences = _planningService.EvaluateScenario(clearedForLandingInputs, rules);

            var bestVariant = landingSequences.ValidVariants.FirstOrDefault();
            if (bestVariant != null)
            {
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

        // 4. Statistici sumare
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
            GeneratedAtUtc: DateTime.UtcNow
        );
    }

    public List<AlternateAerodrome> GetAlternateAerodromes(WeatherCondition weather, double aircraftCruiseSpeedKnots = 70)
    {
        double speed = (aircraftCruiseSpeedKnots <= 0) ? 70 : aircraftCruiseSpeedKnots;
        double effectiveWind = Math.Max(weather.WindSpeedKnots, weather.WindGustKnots);
        var alternates = new List<AlternateAerodrome>();

        // 1. Aerodromul Balta Verde Craiova
        var (crossBV13, headBV13) = CrosswindCalculator.Calculate(weather.WindDirectionDegrees, effectiveWind, 130.0);
        var (crossBV31, headBV31) = CrosswindCalculator.Calculate(weather.WindDirectionDegrees, effectiveWind, 310.0);
        string bestRwyBV = (headBV31 > headBV13) ? "31 (310°)" : "13 (130°)";
        double bestCrossBV = (headBV31 > headBV13) ? crossBV31 : crossBV13;
        double bestHeadBV = (headBV31 > headBV13) ? headBV31 : headBV13;
        double timeBV = Math.Round((11.8 / (speed * 1.852)) * 60, 1);

        alternates.Add(new AlternateAerodrome(
            Name: "Aerodromul Balta Verde Craiova",
            Code: "LRBV",
            DistanceKm: 11.8,
            BearingDegrees: 245,
            RunwayHeadingDegrees: (headBV31 > headBV13) ? 310 : 130,
            BestRunway: bestRwyBV,
            CalculatedCrosswindKnots: bestCrossBV,
            CalculatedHeadwindKnots: bestHeadBV,
            EstimatedFlightMinutes: timeBV,
            SuitabilityReason: $"Pistă înierbată 600m. La vânt din {weather.WindDirectionDegrees}°, vântul de față pe pista {bestRwyBV} este de {bestHeadBV} kts, iar cel lateral este de {bestCrossBV} kts."
        ));

        // 2. Aerodrom Podari
        var (crossPod02, headPod02) = CrosswindCalculator.Calculate(weather.WindDirectionDegrees, effectiveWind, 20.0);
        var (crossPod20, headPod20) = CrosswindCalculator.Calculate(weather.WindDirectionDegrees, effectiveWind, 200.0);
        string bestRwyPod = (headPod20 > headPod02) ? "20 (200°)" : "02 (020°)";
        double bestCrossPod = (headPod20 > headPod02) ? crossPod20 : crossPod02;
        double bestHeadPod = (headPod20 > headPod02) ? headPod20 : headPod02;
        double timePod = Math.Round((14.5 / (speed * 1.852)) * 60, 1);

        alternates.Add(new AlternateAerodrome(
            Name: "Aerodrom Podari (ULM Field)",
            Code: "PODARI",
            DistanceKm: 14.5,
            BearingDegrees: 225,
            RunwayHeadingDegrees: (headPod20 > headPod02) ? 200 : 20,
            BestRunway: bestRwyPod,
            CalculatedCrosswindKnots: bestCrossPod,
            CalculatedHeadwindKnots: bestHeadPod,
            EstimatedFlightMinutes: timePod,
            SuitabilityReason: $"Teren dedicat ULM/Savannah. Pista {bestRwyPod} oferă vânt de față de +{bestHeadPod} kts și vânt lateral minim de {bestCrossPod} kts."
        ));

        // 3. Aerodrom Slatina (Găneasa)
        var (crossSlat08, headSlat08) = CrosswindCalculator.Calculate(weather.WindDirectionDegrees, effectiveWind, 80.0);
        var (crossSlat26, headSlat26) = CrosswindCalculator.Calculate(weather.WindDirectionDegrees, effectiveWind, 260.0);
        string bestRwySlat = (headSlat26 > headSlat08) ? "26 (260°)" : "08 (080°)";
        double bestCrossSlat = (headSlat26 > headSlat08) ? crossSlat26 : crossSlat08;
        double bestHeadSlat = (headSlat26 > headSlat08) ? headSlat26 : headSlat08;
        double timeSlat = Math.Round((46.0 / (speed * 1.852)) * 60, 1);

        alternates.Add(new AlternateAerodrome(
            Name: "Aerodrom Slatina",
            Code: "SLATINA",
            DistanceKm: 46.0,
            BearingDegrees: 75,
            RunwayHeadingDegrees: (headSlat26 > headSlat08) ? 260 : 80,
            BestRunway: bestRwySlat,
            CalculatedCrosswindKnots: bestCrossSlat,
            CalculatedHeadwindKnots: bestHeadSlat,
            EstimatedFlightMinutes: timeSlat,
            SuitabilityReason: $"Aerodrom de rezervă estic la {timeSlat} minute zbor."
        ));

        return alternates;
    }
}
