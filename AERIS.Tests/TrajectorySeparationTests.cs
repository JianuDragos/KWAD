using Aeris.PlanningEngine.Models;
using Aeris.PlanningEngine.Models.TrajectorySeparation;
using Aeris.PlanningEngine.Services;
using Aeris.PlanningEngine.Services.TrajectorySeparation;
using Xunit;

namespace AERIS.Tests;

public class TrajectorySeparationTests
{
    private readonly ITrajectorySeparationEngine _engine;
    private readonly TrajectoryPredictor _predictor;

    public TrajectorySeparationTests()
    {
        _predictor = new TrajectoryPredictor();
        _engine = new TrajectorySeparationEngine(_predictor);
    }

    [Fact]
    public void Test_1_TwoIfr_SamePositionAndAltitude_IsUnsafe()
    {
        // Două zboruri IFR la aceeași poziție (PEMOK) și aceeași altitudine (5000 ft)
        var s1 = new Aircraft3DState(
            AircraftId: "IFR1",
            Callsign: "WZZ3751",
            FlightRules: FlightRules.IFR,
            Category: AircraftCategory.CommercialJet,
            Latitude: 44.364694,
            Longitude: 24.348472,
            AltitudeFeet: 5000,
            SpeedKnots: 210,
            HeadingDegrees: 260,
            TimestampSeconds: 100
        );

        var s2 = new Aircraft3DState(
            AircraftId: "IFR2",
            Callsign: "ROT641",
            FlightRules: FlightRules.IFR,
            Category: AircraftCategory.CommercialJet,
            Latitude: 44.364694,
            Longitude: 24.348472,
            AltitudeFeet: 5000,
            SpeedKnots: 210,
            HeadingDegrees: 260,
            TimestampSeconds: 100
        );

        var result = _engine.ValidateDirectStates(new List<Aircraft3DState> { s1, s2 });

        Assert.False(result.IsSafe);
        Assert.Equal(SafetyStatus.Unsafe, result.Status);
        Assert.Contains(result.Conflicts, c => c.Type == SeparationConflictType.LossOfSeparation_IFR_IFR);
    }

    [Fact]
    public void Test_2_TwoIfr_HorizontallyClose_VerticallySeparated_StandardModeSafe()
    {
        // Două zboruri IFR la distanță orizontală de ~1 NM (< 5 NM), dar separate vertical la 1.000 ft (5000 ft vs 6000 ft)
        var (lat2, lon2) = GeoMath.Destination(44.364694, 24.348472, 90, 1.0);

        var s1 = new Aircraft3DState("IFR1", "WZZ3751", FlightRules.IFR, AircraftCategory.CommercialJet, 44.364694, 24.348472, 5000, 210, 260, 100);
        var s2 = new Aircraft3DState("IFR2", "ROT641", FlightRules.IFR, AircraftCategory.CommercialJet, lat2, lon2, 6000, 210, 260, 100);

        var settings = new SeparationSettings(StrictMode: false);
        var result = _engine.ValidateDirectStates(new List<Aircraft3DState> { s1, s2 }, settings);

        // În modul standard EASA, separarea verticală de 1.000 ft este conformă
        Assert.True(result.IsSafe);
        Assert.Equal(SafetyStatus.Safe, result.Status);
        Assert.Empty(result.Conflicts);
    }

    [Fact]
    public void Test_3_TwoIfr_HorizontallyClose_VerticallySeparated_StrictModeUnsafe()
    {
        // Aceleași două zboruri, dar cu StrictMode = true: respinge suprapunerea orizontală chiar dacă altitudinile diferă!
        var (lat2, lon2) = GeoMath.Destination(44.364694, 24.348472, 90, 1.0);

        var s1 = new Aircraft3DState("IFR1", "WZZ3751", FlightRules.IFR, AircraftCategory.CommercialJet, 44.364694, 24.348472, 5000, 210, 260, 100);
        var s2 = new Aircraft3DState("IFR2", "ROT641", FlightRules.IFR, AircraftCategory.CommercialJet, lat2, lon2, 6000, 210, 260, 100);

        var settings = new SeparationSettings(StrictMode: true, StrictModeHorizontalThresholdNm: 3.0);
        var result = _engine.ValidateDirectStates(new List<Aircraft3DState> { s1, s2 }, settings);

        Assert.False(result.IsSafe);
        Assert.Equal(SafetyStatus.Unsafe, result.Status);
        Assert.Contains(result.Conflicts, c => c.Type == SeparationConflictType.StrictHorizontalOverlap);
    }

    [Fact]
    public void Test_4_TwoVfr_CloseInClassC_BreachesVfrThreshold()
    {
        // Două zboruri VFR în CTR Craiova la distanță de 0.8 NM (< 1.5 NM prag AERIS) și diferență 200 ft (< 500 ft)
        var (lat2, lon2) = GeoMath.Destination(44.25, 23.85, 45, 0.8);

        var v1 = new Aircraft3DState("VFR1", "YR-SAV", FlightRules.VFR, AircraftCategory.UltralightAndGlider, 44.25, 23.85, 1500, 80, 80, 50);
        var v2 = new Aircraft3DState("VFR2", "YR-5012", FlightRules.VFR, AircraftCategory.GeneralAviation, lat2, lon2, 1700, 90, 80, 50);

        var result = _engine.ValidateDirectStates(new List<Aircraft3DState> { v1, v2 });

        Assert.False(result.IsSafe);
        Assert.Contains(result.Conflicts, c => c.Type == SeparationConflictType.LossOfSeparation_VFR_VFR);
    }

    [Fact]
    public void Test_5_RunwayOccupancyViolation_WhenConsecutiveLandingsTooClose()
    {
        // Două avioane cu aterizări programate la doar 30 de secunde diferență
        // Prima aeronavă este CommercialJet (ocupare 60s + 15s marjă = 75s necesar)
        var landings = new List<(string AircraftId, AircraftCategory Category, FlightRules Rules, double LandingTimeSeconds)>
        {
            ("AC1", AircraftCategory.CommercialJet, FlightRules.IFR, 100.0),
            ("AC2", AircraftCategory.CommercialJet, FlightRules.IFR, 130.0) // 30s < 75s
        };

        var conflicts = _engine.CheckRunwaySafety(landings, new SeparationSettings());

        Assert.NotEmpty(conflicts);
        Assert.Contains(conflicts, c => c.Type == SeparationConflictType.RunwayOccupancyViolation);
    }

    [Fact]
    public void Test_6_WakeTurbulence_LightBehindMedium_Requires3Minutes()
    {
        // Lider: CommercialJet (Medium) la T=100s
        // Urmăritor: Ultralight / Savannah (Light) la T=220s (interval = 120s)
        // Regula EASA / ICAO: minim 180s (3 minute) pentru LIGHT după MEDIUM
        var landings = new List<(string AircraftId, AircraftCategory Category, FlightRules Rules, double LandingTimeSeconds)>
        {
            ("WZZ3751", AircraftCategory.CommercialJet, FlightRules.IFR, 100.0),
            ("YR-SAV",  AircraftCategory.UltralightAndGlider, FlightRules.VFR, 220.0) // 120s < 180s
        };

        var conflicts = _engine.CheckRunwaySafety(landings, new SeparationSettings());

        Assert.NotEmpty(conflicts);
        Assert.Contains(conflicts, c => c.Type == SeparationConflictType.WakeTurbulenceViolation);

        // Dacă intervalul este mărit la 280s (180s diferență)
        var safeLandings = new List<(string AircraftId, AircraftCategory Category, FlightRules Rules, double LandingTimeSeconds)>
        {
            ("WZZ3751", AircraftCategory.CommercialJet, FlightRules.IFR, 100.0),
            ("YR-SAV",  AircraftCategory.UltralightAndGlider, FlightRules.VFR, 280.0) // 180s diferență exactă
        };

        var safeConflicts = _engine.CheckRunwaySafety(safeLandings, new SeparationSettings());
        Assert.Empty(safeConflicts);
    }

    [Fact]
    public void Test_7_HoldingPattern_Racetrack_SameAltitude_IsUnsafe()
    {
        // Două aeronave în circuitul de așteptare hipodrom la fixul OZZET, ambele la 4.000 ft
        var ac1 = new CraiovaAircraft("IFR1", "WZZ3751", "A320", AircraftCategory.CommercialJet, FlightRules.IFR, true, 33, 100, 0, 500);
        var ac2 = new CraiovaAircraft("IFR2", "ROT641", "B737", AircraftCategory.CommercialJet, FlightRules.IFR, true, 33, 150, 0, 500);

        var ozzet = AipAirwayData.Waypoints["OZZET"];
        var holdCfg1 = new HoldingRacetrackConfig("OZZET", ozzet.Latitude, ozzet.Longitude, 268.95, "Right", 60, 180, 4000, 100, 300);
        var holdCfg2 = new HoldingRacetrackConfig("OZZET", ozzet.Latitude, ozzet.Longitude, 268.95, "Right", 60, 180, 4000, 120, 300);

        var traj1 = _predictor.PredictHoldingTrajectory(ac1, holdCfg1);
        var traj2 = _predictor.PredictHoldingTrajectory(ac2, holdCfg2);

        var result = _engine.ValidateSeparation(new List<AircraftTrajectory> { traj1, traj2 });

        Assert.False(result.IsSafe);
        Assert.Contains(result.Conflicts, c => c.Type == SeparationConflictType.HoldingPatternConflict);
    }

    [Fact]
    public void Test_8_HoldingPattern_Racetrack_StackedAltitudes_StandardModeSafe_StrictModeUnsafe()
    {
        // Două aeronave la OZZET, dar cu niveluri eșalonate conform procedurii: 4.000 ft și 5.000 ft (separare 1.000 ft)
        var ac1 = new CraiovaAircraft("IFR1", "WZZ3751", "A320", AircraftCategory.CommercialJet, FlightRules.IFR, true, 33, 100, 0, 500);
        var ac2 = new CraiovaAircraft("IFR2", "ROT641", "B737", AircraftCategory.CommercialJet, FlightRules.IFR, true, 33, 100, 0, 500);

        var ozzet = AipAirwayData.Waypoints["OZZET"];
        var holdCfg1 = new HoldingRacetrackConfig("OZZET", ozzet.Latitude, ozzet.Longitude, 268.95, "Right", 60, 180, 4000, 100, 300);
        var holdCfg2 = new HoldingRacetrackConfig("OZZET", ozzet.Latitude, ozzet.Longitude, 268.95, "Right", 60, 180, 5000, 100, 300);

        var traj1 = _predictor.PredictHoldingTrajectory(ac1, holdCfg1);
        var traj2 = _predictor.PredictHoldingTrajectory(ac2, holdCfg2);

        // În mod standard (separare 3D): SAFE deoarece au 1.000 ft vertical
        var standardResult = _engine.ValidateSeparation(new List<AircraftTrajectory> { traj1, traj2 }, new SeparationSettings(StrictMode: false));
        Assert.True(standardResult.IsSafe);

        // În Strict Mode: UNSAFE deoarece proiecția orizontală este identică!
        var strictResult = _engine.ValidateSeparation(new List<AircraftTrajectory> { traj1, traj2 }, new SeparationSettings(StrictMode: true));
        Assert.False(strictResult.IsSafe);
        Assert.Contains(strictResult.Conflicts, c => c.Type == SeparationConflictType.HoldingPatternConflict || c.Type == SeparationConflictType.StrictHorizontalOverlap);
    }

    [Fact]
    public void Test_9_MissedApproachConflict_DetectedWhenCrossingActiveApproach()
    {
        // O aeronavă care execută ratarea aterizării pe pista 27 (urcă spre CV518 și CV520)
        // în timp ce o altă aeronavă traversează ruta la același timp și altitudine
        var acMissed = new CraiovaAircraft("MA1", "WZZ100", "A320", AircraftCategory.CommercialJet, FlightRules.IFR, true, 33, 0, 0, 300, SpeedKnots: 180);
        var trajMissed = _predictor.PredictMissedApproachTrajectory(acMissed, "27", initiationTimeSeconds: 50.0);

        // Aeronavă pe traiectorie convergentă exact la momentul de trecere
        var targetPoint = trajMissed.Points[trajMissed.Points.Count / 2];
        var conflictingPoints = new List<TrajectoryPoint>
        {
            new TrajectoryPoint(TimeSeconds: targetPoint.TimeSeconds - 20, Latitude: targetPoint.Latitude + 0.05, Longitude: targetPoint.Longitude, AltitudeFeet: targetPoint.AltitudeFeet, SpeedKnots: 200, HeadingDegrees: 180, Phase: FlightPhase.Approach),
            new TrajectoryPoint(TimeSeconds: targetPoint.TimeSeconds, Latitude: targetPoint.Latitude, Longitude: targetPoint.Longitude, AltitudeFeet: targetPoint.AltitudeFeet, SpeedKnots: 200, HeadingDegrees: 180, Phase: FlightPhase.Approach),
            new TrajectoryPoint(TimeSeconds: targetPoint.TimeSeconds + 20, Latitude: targetPoint.Latitude - 0.05, Longitude: targetPoint.Longitude, AltitudeFeet: targetPoint.AltitudeFeet, SpeedKnots: 200, HeadingDegrees: 180, Phase: FlightPhase.Approach)
        };
        var trajConflicting = new AircraftTrajectory("IFR_CROSS", "ROT200", FlightRules.IFR, AircraftCategory.CommercialJet, conflictingPoints);

        var result = _engine.ValidateSeparation(new List<AircraftTrajectory> { trajMissed, trajConflicting });

        Assert.False(result.IsSafe);
        Assert.Contains(result.Conflicts, c => c.Type == SeparationConflictType.MissedApproachConflict);
    }

    [Fact]
    public void Test_10_IncompleteTrajectory_ReturnsIncomplete()
    {
        var emptyTraj = new AircraftTrajectory("TEST", "TEST1", FlightRules.IFR, AircraftCategory.CommercialJet, new List<TrajectoryPoint>());
        var result = _engine.ValidateSeparation(new List<AircraftTrajectory> { emptyTraj });

        Assert.Equal(SafetyStatus.Incomplete, result.Status);
        Assert.False(result.IsSafe);
    }

    [Fact]
    public void Test_11_SafePlanningCoordinator_AutoReplanning_ResolvesWakeConflict()
    {
        // Testăm fluxul complet de planificare cu replanificare automată:
        // Două aeronave: W4-3751 (A320 - Medium) și YR-SAV (Savannah - Light)
        // Initial rules: MinimumGapSeconds = 120 (insuficient pentru Light după Medium: necesită 180s)
        var planningService = new PlanningService();
        var coordinator = new SafePlanningCoordinator(planningService, _engine);

        var aircrafts = new List<CraiovaAircraft>
        {
            new("W4-3751", "WZZ3751", "A320", AircraftCategory.CommercialJet, FlightRules.IFR, true, 33, EtaSeconds: 0, EarliestSeconds: 0, LatestSeconds: 300, SpeedKnots: 145),
            new("YR-SAV",  "YR-5123", "Savannah", AircraftCategory.UltralightAndGlider, FlightRules.VFR, false, 11, EtaSeconds: 100, EarliestSeconds: 0, LatestSeconds: 600, SpeedKnots: 70)
        };

        var initialRules = new ScenarioRules(MinimumGapSeconds: 120, AllowVfr: true);
        var response = coordinator.PlanAndValidate(aircrafts, initialRules, runwayId: "09");

        // Coordonatorul trebuie să fi detectat conflictul inițial și să fi replanificat cu MinimumGapSeconds mărit
        Assert.True(response.ReplanningTriggered);
        Assert.True(response.SafetyAssessment.IsSafe);
        Assert.NotNull(response.SelectedVariant);

        var wzzSlot = response.SelectedVariant.Schedule.First(s => s.AircraftId == "W4-3751");
        var savSlot = response.SelectedVariant.Schedule.First(s => s.AircraftId == "YR-SAV");

        // Intervalul final de aterizare trebuie să fie de cel puțin 180 secunde (3 minute de siaj)
        double gap = savSlot.CalculatedTimeSeconds - wzzSlot.CalculatedTimeSeconds;
        Assert.True(gap >= 180.0, $"Gap-ul calculat ({gap}s) trebuie să fie cel puțin 180s");
    }
}
