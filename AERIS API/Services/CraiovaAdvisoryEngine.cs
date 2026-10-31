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
        // 1. Calcul componente vânt pe pista Craiova (09/27)
        double effectiveWindSpeed = Math.Max(weather.WindSpeedKnots, weather.WindGustKnots);
        var (activeRwyId, activeRwyHeading, crosswindCraiova, headwindCraiova) =
            CrosswindCalculator.DetermineActiveRunwayCraiova(weather.WindDirectionDegrees, effectiveWindSpeed);

        bool isCrosswindCriticalForLight = crosswindCraiova > 12.0;

        var advisories = new List<AircraftAdvisory>();
        var clearedForLandingInputs = new List<AircraftInput>();

        // 2. Evaluare fiecare aeronavă conform priorităților și limitelor meteo
        foreach (var ac in aircrafts)
        {
            double aircraftCrosswind = crosswindCraiova;
            bool isCrosswindExceeded = aircraftCrosswind > ac.MaxCrosswindKnots;

            // REGULA DE PRIORITATE: Aeronavele comerciale IFR (A320/B737) au prioritate absolută
            if (ac.Category == AircraftCategory.CommercialJet || ac.Category == AircraftCategory.RegionalTurboprop)
            {
                if (!isCrosswindExceeded)
                {
                    advisories.Add(new AircraftAdvisory(
                        AircraftId: ac.Id,
                        Callsign: ac.Callsign,
                        ModelName: ac.ModelName,
                        Category: ac.Category,
                        FlightRules: ac.FlightRules,
                        HasInstrumentAvionics: ac.HasInstrumentAvionics,
                        CurrentCrosswindKnots: aircraftCrosswind,
                        MaxCrosswindLimitKnots: ac.MaxCrosswindKnots,
                        AdvisoryStatus: AdvisoryStatus.ClearedForApproach,
                        AdvisoryReason: $"Zbor comercial IFR prioritar. Vântul lateral ({aircraftCrosswind} kts) este în limita operațională ({ac.MaxCrosswindKnots} kts). Liber pentru apropiere pe pista {activeRwyId}."
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
                    // Chiar și un avion comercial are o limită maximă (33-35 kts)
                    advisories.Add(new AircraftAdvisory(
                        AircraftId: ac.Id,
                        Callsign: ac.Callsign,
                        ModelName: ac.ModelName,
                        Category: ac.Category,
                        FlightRules: ac.FlightRules,
                        HasInstrumentAvionics: ac.HasInstrumentAvionics,
                        CurrentCrosswindKnots: aircraftCrosswind,
                        MaxCrosswindLimitKnots: ac.MaxCrosswindKnots,
                        AdvisoryStatus: AdvisoryStatus.HoldInOrbitRecommended,
                        AdvisoryReason: $"Vânt lateral sever ({aircraftCrosswind} kts) ce depășește limita maximă admisă ({ac.MaxCrosswindKnots} kts). Se recomandă holding standard IFR.",
                        OrbitAdvice: new OrbitPatternAdvice(
                            PatternName: "Standard IFR Holding Craiova (VOR/DME CRA)",
                            RecommendedAltitudeFeet: 4000,
                            HoldingDurationMinutes: 15,
                            RemainingFuelMarginMinutes: ac.RemainingFuelMinutes - 20,
                            SafetyInstructions: "Așteptare în holding standard până la scăderea vitezei rafalelor sub 30 kts."
                        )
                    ));
                }
            }
            else
            {
                // Aeronave mici / agrement (ICP Savannah, PZL-104 Wilga, Cessna 172)
                var alternates = GetAlternateAerodromes(weather, ac.SpeedKnots);

                if (isCrosswindExceeded)
                {
                    // Vântul lateral este prea puternic pentru aeronava mică!
                    bool canHoldInOrbit = ac.RemainingFuelMinutes > 40;
                    var status = canHoldInOrbit ? AdvisoryStatus.HoldInOrbitRecommended : AdvisoryStatus.DivertRecommended;

                    var orbitAdvice = new OrbitPatternAdvice(
                        PatternName: $"Orbită de așteptare paralelă cu latura sudică a pistei {activeRwyId} (Cârcea - Pielești)",
                        RecommendedAltitudeFeet: 1500,
                        HoldingDurationMinutes: 12,
                        RemainingFuelMarginMinutes: ac.RemainingFuelMinutes - 15,
                        SafetyInstructions: "Mențineți zbor vizual (VFR) la 1500 ft QNH paralel cu axul pistei, în afara zonei de turbulență de siaj generată de aeronavele grele. Cedați prioritatea traficului comercial."
                    );

                    string reason = $"Vântul lateral calculat la sol ({aircraftCrosswind} kts) depășește limita demonstrată a aeronavei {ac.ModelName} ({ac.MaxCrosswindKnots} kts). " +
                                    (canHoldInOrbit
                                        ? "Se recomandă menținerea în orbită de așteptare sau devierea către aerodromurile Balta Verde / Podari unde vântul oferă o orientare mai favorabilă."
                                        : "Rezervele de combustibil impun devierea imediată către Podari sau Balta Verde.");

                    advisories.Add(new AircraftAdvisory(
                        AircraftId: ac.Id,
                        Callsign: ac.Callsign,
                        ModelName: ac.ModelName,
                        Category: ac.Category,
                        FlightRules: ac.FlightRules,
                        HasInstrumentAvionics: ac.HasInstrumentAvionics,
                        CurrentCrosswindKnots: aircraftCrosswind,
                        MaxCrosswindLimitKnots: ac.MaxCrosswindKnots,
                        AdvisoryStatus: status,
                        AdvisoryReason: reason,
                        OrbitAdvice: orbitAdvice,
                        RecommendedAlternates: alternates
                    ));
                }
                else
                {
                    // Vântul lateral este acceptabil pentru aeronava mică
                    advisories.Add(new AircraftAdvisory(
                        AircraftId: ac.Id,
                        Callsign: ac.Callsign,
                        ModelName: ac.ModelName,
                        Category: ac.Category,
                        FlightRules: ac.FlightRules,
                        HasInstrumentAvionics: ac.HasInstrumentAvionics,
                        CurrentCrosswindKnots: aircraftCrosswind,
                        MaxCrosswindLimitKnots: ac.MaxCrosswindKnots,
                        AdvisoryStatus: AdvisoryStatus.ClearedForApproach,
                        AdvisoryReason: $"Vânt lateral acceptabil ({aircraftCrosswind} kts <= {ac.MaxCrosswindKnots} kts). Integrat în secvențierea de aterizare, cedând pasul zborurilor IFR grele.",
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

        // 3. Calcul orare optime pentru aeronavele permise la aterizare
        PlanningResponse? landingSequences = null;
        if (clearedForLandingInputs.Count > 0)
        {
            var rules = new ScenarioRules(MinimumGapSeconds: 120, AllowVfr: true, BaseTimeOffsetSeconds: 50400);
            landingSequences = _planningService.EvaluateScenario(clearedForLandingInputs, rules);

            // Corelăm sloturile calculate înapoi în advisory
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
        // Distanță: ~11.8 km (6.4 NM), Cap magnetic: 245°, Piste disponibile: 13 / 31 (130° / 310°)
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
            SuitabilityReason: $"Pistă înierbată 600m. La vânt din {weather.WindDirectionDegrees}°, vântul lateral pe pista {bestRwyBV} este de {bestCrossBV} kts (mult redus față de Craiova)."
        ));

        // 2. Aerodrom Podari
        // Distanță: ~14.5 km (7.8 NM), Cap magnetic: 225°, Piste disponibile: 02 / 20 (020° / 200°)
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
            SuitabilityReason: $"Teren dedicat ULM/Savannah. Pista {bestRwyPod} este orientată aproape pe axul vântului de sud, oferind un vânt lateral minim de doar {bestCrossPod} kts."
        ));

        // 3. Aerodrom Slatina (Găneasa)
        // Distanță: ~46.0 km (25 NM), Cap: 075°, Piste: 08 / 26
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
