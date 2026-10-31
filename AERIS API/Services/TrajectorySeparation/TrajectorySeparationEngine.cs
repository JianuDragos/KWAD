using Aeris.PlanningEngine.Models;
using Aeris.PlanningEngine.Models.TrajectorySeparation;

namespace Aeris.PlanningEngine.Services.TrajectorySeparation;

/// <summary>
/// Implementarea motorului de siguranță a traiectoriilor și deconflictualizare 3D (Trajectory &amp; Separation Engine).
/// Răspunde de:
/// - Verificarea separării 3D (IFR/IFR, IFR/VFR, VFR/VFR) în spațiul aerian Craiova (CTR Clasa C)
/// - Siguranța pistei (ocupare, degajare și intervale de siaj Wake Turbulence)
/// - Detectarea conflictelor în circuitele de așteptare hipodrom (Racetrack holding)
/// - Detectarea conflictelor pe procedurile de ratare a aterizării (Missed Approach)
/// - Suportul pentru Mod Strict (interzice suprapunerea orizontală chiar și cu separare verticală)
/// - Furnizarea de recomandări de replanificare atunci când o secvență este Unsafe.
/// </summary>
public class TrajectorySeparationEngine : ITrajectorySeparationEngine
{
    private readonly TrajectoryPredictor _predictor;

    public TrajectorySeparationEngine(TrajectoryPredictor? predictor = null)
    {
        _predictor = predictor ?? new TrajectoryPredictor();
    }

    public SafetyAssessmentResult ValidateSeparation(List<AircraftTrajectory> trajectories, SeparationSettings? settings = null)
    {
        var cfg = settings ?? new SeparationSettings();

        if (trajectories == null || trajectories.Count == 0)
        {
            return new SafetyAssessmentResult(
                Status: SafetyStatus.Incomplete,
                IsSafe: false,
                Summary: "Nu există traiectorii furnizate pentru evaluare.",
                Conflicts: new List<SeparationConflict>(),
                TotalEvaluatedPairs: 0,
                TotalTrajectoryPoints: 0,
                EvaluatedAtUtc: DateTime.UtcNow,
                ReplanningSuggestions: new List<string> { "Furnizați cel puțin o traiectorie validă." }
            );
        }

        // 1. Verificare traiectorii incomplete / fără puncte
        foreach (var t in trajectories)
        {
            if (t.Points == null || t.Points.Count == 0)
            {
                return new SafetyAssessmentResult(
                    Status: SafetyStatus.Incomplete,
                    IsSafe: false,
                    Summary: $"Traiectoria pentru aeronava {t.AircraftId} este incompletă sau lipsește.",
                    Conflicts: new List<SeparationConflict>(),
                    TotalEvaluatedPairs: 0,
                    TotalTrajectoryPoints: 0,
                    EvaluatedAtUtc: DateTime.UtcNow,
                    ReplanningSuggestions: new List<string> { $"Calculați punctele 4D pentru aeronava {t.AircraftId} înainte de validare." }
                );
            }
        }

        var conflicts = new List<SeparationConflict>();

        // 2. Verificare siguranță pistă (Runway Occupancy & Wake Turbulence la prag)
        // Luăm în considerare doar aeronavele care chiar execută aterizarea la prag (nu cele aflate exclusiv în orbită/holding)
        var landingPoints = trajectories
            .Select(t =>
            {
                var thrPoint = t.Points.FirstOrDefault(p => p.Phase == FlightPhase.LandingRollout || p.WaypointId?.StartsWith("THR") == true);
                return (t.AircraftId, t.Category, t.FlightRules, Point: thrPoint);
            })
            .Where(x => x.Point != null)
            .Select(x => (x.AircraftId, x.Category, x.FlightRules, x.Point!.TimeSeconds))
            .OrderBy(x => x.Item4)
            .ToList();

        if (landingPoints.Count > 1)
        {
            conflicts.AddRange(CheckRunwaySafety(landingPoints, cfg));
        }

        // 3. Scanare separare 3D în timp
        double minTime = trajectories.Where(t => t.StartTimeSeconds.HasValue).Min(t => t.StartTimeSeconds!.Value);
        double maxTime = trajectories.Where(t => t.EndTimeSeconds.HasValue).Max(t => t.EndTimeSeconds!.Value);

        int totalPairsEvaluated = 0;
        int totalPointsEvaluated = trajectories.Sum(t => t.Points.Count);

        // Scanăm fiecare pereche de aeronave
        for (int i = 0; i < trajectories.Count; i++)
        {
            for (int j = i + 1; j < trajectories.Count; j++)
            {
                totalPairsEvaluated++;
                var ac1 = trajectories[i];
                var ac2 = trajectories[j];

                var pairConflicts = EvaluatePairSeparation(ac1, ac2, minTime, maxTime, cfg);
                conflicts.AddRange(pairConflicts);
            }
        }

        bool isSafe = conflicts.Count == 0;
        var status = isSafe ? SafetyStatus.Safe : SafetyStatus.Unsafe;

        var suggestions = GenerateReplanningSuggestions(conflicts);

        string summary = isSafe
            ? $"Toate cele {trajectories.Count} traiectorii sunt SIGURE (respectă separarea 3D, ocuparea pistei și siajul conform normelor EASA/ICAO)."
            : $"S-au detectat {conflicts.Count} conflicte de siguranță sau proximitate. Planul necesită replanificare.";

        return new SafetyAssessmentResult(
            Status: status,
            IsSafe: isSafe,
            Summary: summary,
            Conflicts: conflicts,
            TotalEvaluatedPairs: totalPairsEvaluated,
            TotalTrajectoryPoints: totalPointsEvaluated,
            EvaluatedAtUtc: DateTime.UtcNow,
            ReplanningSuggestions: suggestions
        );
    }

    public SafetyAssessmentResult ValidateSchedule(
        List<CraiovaAircraft> aircrafts,
        List<ScheduleSlot> schedule,
        string runwayId = "09",
        SeparationSettings? settings = null)
    {
        var cfg = settings ?? new SeparationSettings();

        if (aircrafts == null || aircrafts.Count == 0 || schedule == null || schedule.Count == 0)
        {
            return new SafetyAssessmentResult(
                Status: SafetyStatus.Incomplete,
                IsSafe: false,
                Summary: "Nu există aeronave sau sloturi de aterizare pentru validare.",
                Conflicts: new List<SeparationConflict>(),
                TotalEvaluatedPairs: 0,
                TotalTrajectoryPoints: 0,
                EvaluatedAtUtc: DateTime.UtcNow,
                ReplanningSuggestions: new List<string> { "Furnizați orarul și lista de aeronave." }
            );
        }

        // Construim traiectoriile prezise pentru fiecare aeronavă planificată
        var trajectories = new List<AircraftTrajectory>();
        var scheduleMap = schedule.ToDictionary(s => s.AircraftId);

        foreach (var ac in aircrafts)
        {
            if (scheduleMap.TryGetValue(ac.Id, out var slot))
            {
                var traj = _predictor.PredictApproachTrajectory(ac, runwayId, slot.CalculatedTimeSeconds, null, cfg.TimeStepSeconds);
                trajectories.Add(traj);
            }
        }

        return ValidateSeparation(trajectories, cfg);
    }

    public SafetyAssessmentResult ValidateDirectStates(List<Aircraft3DState> states, SeparationSettings? settings = null)
    {
        var cfg = settings ?? new SeparationSettings();

        if (states == null || states.Count < 2)
        {
            return new SafetyAssessmentResult(
                Status: SafetyStatus.Safe,
                IsSafe: true,
                Summary: "Trafic insuficient pentru generare conflicte (sub 2 aeronave).",
                Conflicts: new List<SeparationConflict>(),
                TotalEvaluatedPairs: 0,
                TotalTrajectoryPoints: states?.Count ?? 0,
                EvaluatedAtUtc: DateTime.UtcNow,
                ReplanningSuggestions: new List<string>()
            );
        }

        var conflicts = new List<SeparationConflict>();
        int pairs = 0;

        for (int i = 0; i < states.Count; i++)
        {
            for (int j = i + 1; j < states.Count; j++)
            {
                pairs++;
                var s1 = states[i];
                var s2 = states[j];

                double distNm = GeoMath.DistanceNm(s1.Latitude, s1.Longitude, s2.Latitude, s2.Longitude);
                double altDiff = Math.Abs(s1.AltitudeFeet - s2.AltitudeFeet);

                var (reqHoriz, reqVert, conflictType) = DetermineSeparationCriteria(s1.FlightRules, s2.FlightRules, cfg);

                bool isConflict = false;
                if (cfg.StrictMode)
                {
                    if (distNm < cfg.StrictModeHorizontalThresholdNm)
                    {
                        isConflict = true;
                        conflictType = SeparationConflictType.StrictHorizontalOverlap;
                    }
                }
                else
                {
                    if (distNm < reqHoriz && altDiff < reqVert)
                    {
                        isConflict = true;
                    }
                }

                if (isConflict)
                {
                    string timeFormatted = TimeSpan.FromSeconds(s1.TimestampSeconds + 50400).ToString(@"hh\:mm\:ss");
                    string desc = cfg.StrictMode && altDiff >= reqVert
                        ? $"[Strict Mode] Suprapunere orizontală critică ({distNm:F2} NM < {cfg.StrictModeHorizontalThresholdNm} NM) între {s1.Callsign} ({s1.AltitudeFeet} ft) și {s2.Callsign} ({s2.AltitudeFeet} ft)."
                        : $"Pierdere separare {conflictType}: distanță {distNm:F2} NM (minim {reqHoriz} NM) și diferență altitudine {altDiff:F0} ft (minim {reqVert} ft) între {s1.Callsign} și {s2.Callsign}.";

                    conflicts.Add(new SeparationConflict(
                        Type: conflictType,
                        Aircraft1Id: s1.AircraftId,
                        Aircraft2Id: s2.AircraftId,
                        ConflictTimeSeconds: s1.TimestampSeconds,
                        FormattedTime: timeFormatted,
                        HorizontalDistanceNm: Math.Round(distNm, 2),
                        VerticalDistanceFt: Math.Round(altDiff, 0),
                        RequiredHorizontalNm: reqHoriz,
                        RequiredVerticalFt: reqVert,
                        Severity: "Critical",
                        Description: desc,
                        Aircraft1Lat: s1.Latitude,
                        Aircraft1Lon: s1.Longitude,
                        Aircraft1AltFt: s1.AltitudeFeet,
                        Aircraft2Lat: s2.Latitude,
                        Aircraft2Lon: s2.Longitude,
                        Aircraft2AltFt: s2.AltitudeFeet,
                        ReplanningRecommendation: $"Ajustați altitudinea cu cel puțin {reqVert - altDiff + 200:F0} ft sau măriți distanța laterală la peste {reqHoriz} NM."
                    ));
                }
            }
        }

        bool safe = conflicts.Count == 0;
        return new SafetyAssessmentResult(
            Status: safe ? SafetyStatus.Safe : SafetyStatus.Unsafe,
            IsSafe: safe,
            Summary: safe ? "Separare respectată între toate stările furnizate." : $"S-au detectat {conflicts.Count} conflicte directe de separare.",
            Conflicts: conflicts,
            TotalEvaluatedPairs: pairs,
            TotalTrajectoryPoints: states.Count,
            EvaluatedAtUtc: DateTime.UtcNow,
            ReplanningSuggestions: GenerateReplanningSuggestions(conflicts)
        );
    }

    public List<SeparationConflict> CheckRunwaySafety(
        List<(string AircraftId, AircraftCategory Category, FlightRules Rules, double LandingTimeSeconds)> landings,
        SeparationSettings settings)
    {
        var conflicts = new List<SeparationConflict>();
        var sorted = landings.OrderBy(l => l.LandingTimeSeconds).ToList();

        for (int i = 0; i < sorted.Count - 1; i++)
        {
            var lead = sorted[i];
            var trail = sorted[i + 1];
            double gapSeconds = trail.LandingTimeSeconds - lead.LandingTimeSeconds;

            // 1. Verificare ocupare pistă (Runway Occupancy Time)
            double rotRequired = settings.GetRunwayOccupancySeconds(lead.Category);
            if (gapSeconds < rotRequired)
            {
                string timeFmt = TimeSpan.FromSeconds(trail.LandingTimeSeconds + 50400).ToString(@"hh\:mm");
                conflicts.Add(new SeparationConflict(
                    Type: SeparationConflictType.RunwayOccupancyViolation,
                    Aircraft1Id: lead.AircraftId,
                    Aircraft2Id: trail.AircraftId,
                    ConflictTimeSeconds: trail.LandingTimeSeconds,
                    FormattedTime: timeFmt,
                    HorizontalDistanceNm: 0,
                    VerticalDistanceFt: 0,
                    RequiredHorizontalNm: 0,
                    RequiredVerticalFt: 0,
                    Severity: "Critical",
                    Description: $"Pista este ocupată de {lead.AircraftId} timp de {rotRequired:F0}s (ROT + marjă eliberare). {trail.AircraftId} aterizează după doar {gapSeconds:F0}s.",
                    Aircraft1Lat: AipAirwayData.Thr09.Lat,
                    Aircraft1Lon: AipAirwayData.Thr09.Lon,
                    Aircraft1AltFt: AipAirwayData.Thr09.AltFt,
                    Aircraft2Lat: AipAirwayData.Thr09.Lat,
                    Aircraft2Lon: AipAirwayData.Thr09.Lon,
                    Aircraft2AltFt: AipAirwayData.Thr09.AltFt,
                    ReplanningRecommendation: $"Măriți intervalul de aterizare dintre {lead.AircraftId} și {trail.AircraftId} cu cel puțin {rotRequired - gapSeconds + 10:F0} secunde pentru a permite eliberarea pistei."
                ));
            }

            // 2. Verificare separare turbulență de siaj (Wake Turbulence Interval)
            var leadWake = ToWakeCategory(lead.Category);
            var trailWake = ToWakeCategory(trail.Category);
            double requiredWakeSeconds = settings.GetRequiredWakeIntervalSeconds(leadWake, trailWake);

            if (gapSeconds < requiredWakeSeconds)
            {
                string timeFmt = TimeSpan.FromSeconds(trail.LandingTimeSeconds + 50400).ToString(@"hh\:mm");
                conflicts.Add(new SeparationConflict(
                    Type: SeparationConflictType.WakeTurbulenceViolation,
                    Aircraft1Id: lead.AircraftId,
                    Aircraft2Id: trail.AircraftId,
                    ConflictTimeSeconds: trail.LandingTimeSeconds,
                    FormattedTime: timeFmt,
                    HorizontalDistanceNm: 0,
                    VerticalDistanceFt: 0,
                    RequiredHorizontalNm: 0,
                    RequiredVerticalFt: 0,
                    Severity: "Critical",
                    Description: $"Separare de siaj insuficientă (ICAO Doc 4444 / EASA): aeronava {trail.AircraftId} ({trailWake}) după {lead.AircraftId} ({leadWake}). Interval necesar: {requiredWakeSeconds:F0}s (3 min pentru Light după Medium), interval calculat: {gapSeconds:F0}s.",
                    Aircraft1Lat: AipAirwayData.Thr09.Lat,
                    Aircraft1Lon: AipAirwayData.Thr09.Lon,
                    Aircraft1AltFt: AipAirwayData.Thr09.AltFt,
                    Aircraft2Lat: AipAirwayData.Thr09.Lat,
                    Aircraft2Lon: AipAirwayData.Thr09.Lon,
                    Aircraft2AltFt: AipAirwayData.Thr09.AltFt,
                    ReplanningRecommendation: $"Aplicați separarea oficială de siaj: amânați slotul {trail.AircraftId} cu cel puțin {requiredWakeSeconds - gapSeconds:F0} secunde."
                ));
            }
        }

        return conflicts;
    }

    private List<SeparationConflict> EvaluatePairSeparation(
        AircraftTrajectory ac1,
        AircraftTrajectory ac2,
        double minTime,
        double maxTime,
        SeparationSettings cfg)
    {
        var conflicts = new List<SeparationConflict>();

        double step = cfg.TimeStepSeconds;
        var (reqHoriz, reqVert, defaultConflictType) = DetermineSeparationCriteria(ac1.FlightRules, ac2.FlightRules, cfg);

        bool inConflict = false;
        double conflictStart = 0;
        double minDistanceFound = double.MaxValue;
        double minAltDiffFound = double.MaxValue;
        TrajectoryPoint? p1Min = null;
        TrajectoryPoint? p2Min = null;
        double timeAtClosestApproach = 0;
        SeparationConflictType activeConflictType = defaultConflictType;

        for (double t = minTime; t <= maxTime; t += step)
        {
            var p1 = ac1.GetPositionAt(t);
            var p2 = ac2.GetPositionAt(t);

            if (p1 == null || p2 == null)
            {
                if (inConflict)
                {
                    // Încheiem conflictul activ la ieșirea uneia din aeronave din domeniul temporal
                    conflicts.Add(BuildConflictRecord(ac1, ac2, timeAtClosestApproach, minDistanceFound, minAltDiffFound, reqHoriz, reqVert, activeConflictType, p1Min!, p2Min!, cfg));
                    inConflict = false;
                    minDistanceFound = double.MaxValue;
                }
                continue;
            }

            // Excludem din separarea radar cazul când ambele sunt deja la sol / rollout pe pistă (acoperit de runway safety)
            if (p1.Phase == FlightPhase.LandingRollout && p2.Phase == FlightPhase.LandingRollout)
                continue;

            double distNm = GeoMath.DistanceNm(p1.Latitude, p1.Longitude, p2.Latitude, p2.Longitude);
            double altDiff = Math.Abs(p1.AltitudeFeet - p2.AltitudeFeet);

            // Determinare dacă este un conflict de holding sau de ratare
            var currentType = defaultConflictType;
            if (p1.Phase == FlightPhase.Holding || p2.Phase == FlightPhase.Holding)
                currentType = SeparationConflictType.HoldingPatternConflict;
            else if (p1.Phase == FlightPhase.MissedApproach || p2.Phase == FlightPhase.MissedApproach)
                currentType = SeparationConflictType.MissedApproachConflict;

            bool isBreach = false;

            if (cfg.StrictMode)
            {
                // Mod Strict: orice suprapunere orizontală sub prag este considerată conflict, indiferent de altitudine!
                if (distNm < cfg.StrictModeHorizontalThresholdNm)
                {
                    isBreach = true;
                    currentType = (p1.Phase == FlightPhase.Holding || p2.Phase == FlightPhase.Holding)
                        ? SeparationConflictType.HoldingPatternConflict
                        : SeparationConflictType.StrictHorizontalOverlap;
                }
            }
            else
            {
                // Separare 3D standard: conflictul apare doar dacă ambele (orizontal și vertical) sunt încălcate
                if (distNm < reqHoriz && altDiff < reqVert)
                {
                    isBreach = true;
                }
            }

            if (isBreach)
            {
                if (!inConflict)
                {
                    inConflict = true;
                    conflictStart = t;
                    minDistanceFound = distNm;
                    minAltDiffFound = altDiff;
                    p1Min = p1;
                    p2Min = p2;
                    timeAtClosestApproach = t;
                    activeConflictType = currentType;
                }
                else
                {
                    if (distNm < minDistanceFound)
                    {
                        minDistanceFound = distNm;
                        minAltDiffFound = altDiff;
                        p1Min = p1;
                        p2Min = p2;
                        timeAtClosestApproach = t;
                        activeConflictType = currentType;
                    }
                }
            }
            else
            {
                if (inConflict)
                {
                    conflicts.Add(BuildConflictRecord(ac1, ac2, timeAtClosestApproach, minDistanceFound, minAltDiffFound, reqHoriz, reqVert, activeConflictType, p1Min!, p2Min!, cfg));
                    inConflict = false;
                    minDistanceFound = double.MaxValue;
                }
            }
        }

        if (inConflict && p1Min != null && p2Min != null)
        {
            conflicts.Add(BuildConflictRecord(ac1, ac2, timeAtClosestApproach, minDistanceFound, minAltDiffFound, reqHoriz, reqVert, activeConflictType, p1Min, p2Min, cfg));
        }

        return conflicts;
    }

    private static SeparationConflict BuildConflictRecord(
        AircraftTrajectory ac1,
        AircraftTrajectory ac2,
        double conflictTimeSeconds,
        double minDistanceNm,
        double minAltDiffFt,
        double reqHoriz,
        double reqVert,
        SeparationConflictType type,
        TrajectoryPoint p1,
        TrajectoryPoint p2,
        SeparationSettings cfg)
    {
        string timeFmt = TimeSpan.FromSeconds(conflictTimeSeconds + 50400).ToString(@"hh\:mm");
        string desc;
        string recommendation;

        if (type == SeparationConflictType.StrictHorizontalOverlap)
        {
            desc = $"[Strict Mode] Suprapunere orizontală critică ({minDistanceNm:F2} NM < {cfg.StrictModeHorizontalThresholdNm:F1} NM) între {ac1.Callsign} și {ac2.Callsign} (altitudini: {p1.AltitudeFeet:F0} ft vs {p2.AltitudeFeet:F0} ft).";
            recommendation = $"Separați lateral traiectoriile sau eșalonați timpii de trecere cu cel puțin 120s.";
        }
        else if (type == SeparationConflictType.HoldingPatternConflict)
        {
            desc = $"Conflict în circuitul de așteptare între {ac1.Callsign} și {ac2.Callsign}: distanță {minDistanceNm:F2} NM, diferență altitudine {minAltDiffFt:F0} ft.";
            recommendation = $"Alocați niveluri de zbor eșalonate (separare verticală de minim 1.000 ft, ex: 4.000 ft și 5.000 ft) sau fixați puncte diferite de holding.";
        }
        else if (type == SeparationConflictType.MissedApproachConflict)
        {
            desc = $"Traiectoria de ratare a zborului {ac1.Callsign} intersectează apropierea {ac2.Callsign} la {minDistanceNm:F2} NM și {minAltDiffFt:F0} ft diferență.";
            recommendation = $"Deviați aeronava în ratare pe procedura de holding OZZET/NECCO la 4.000 ft sau întârziați apropierea aeronavei {ac2.Callsign}.";
        }
        else
        {
            desc = $"Pierdere de separare 3D ({type}): distanță minimă {minDistanceNm:F2} NM (necesar {reqHoriz:F1} NM) și diferență verticală {minAltDiffFt:F0} ft (necesar {reqVert:F0} ft) între {ac1.Callsign} și {ac2.Callsign}.";
            recommendation = $"Măriți eșalonarea la aterizare cu cel puțin 60-120 secunde între {ac1.Callsign} și {ac2.Callsign}.";
        }

        return new SeparationConflict(
            Type: type,
            Aircraft1Id: ac1.AircraftId,
            Aircraft2Id: ac2.AircraftId,
            ConflictTimeSeconds: conflictTimeSeconds,
            FormattedTime: timeFmt,
            HorizontalDistanceNm: Math.Round(minDistanceNm, 2),
            VerticalDistanceFt: Math.Round(minAltDiffFt, 0),
            RequiredHorizontalNm: reqHoriz,
            RequiredVerticalFt: reqVert,
            Severity: "Critical",
            Description: desc,
            Aircraft1Lat: p1.Latitude,
            Aircraft1Lon: p1.Longitude,
            Aircraft1AltFt: p1.AltitudeFeet,
            Aircraft2Lat: p2.Latitude,
            Aircraft2Lon: p2.Longitude,
            Aircraft2AltFt: p2.AltitudeFeet,
            ReplanningRecommendation: recommendation
        );
    }

    private static (double ReqHoriz, double ReqVert, SeparationConflictType DefaultType) DetermineSeparationCriteria(
        FlightRules r1,
        FlightRules r2,
        SeparationSettings cfg)
    {
        if (r1 == FlightRules.IFR && r2 == FlightRules.IFR)
        {
            return (cfg.IfrIfrHorizontalSeparationNm, cfg.IfrIfrVerticalSeparationFt, SeparationConflictType.LossOfSeparation_IFR_IFR);
        }
        if (r1 == FlightRules.VFR && r2 == FlightRules.VFR)
        {
            return (cfg.VfrVfrHorizontalSeparationNm, cfg.VfrVfrVerticalSeparationFt, SeparationConflictType.LossOfSeparation_VFR_VFR);
        }
        // IFR / VFR
        return (cfg.IfrVfrHorizontalSeparationNm, cfg.IfrVfrVerticalSeparationFt, SeparationConflictType.LossOfSeparation_IFR_VFR);
    }

    private static WakeCategory ToWakeCategory(AircraftCategory cat) => cat switch
    {
        AircraftCategory.CommercialJet => WakeCategory.Medium,
        AircraftCategory.RegionalTurboprop => WakeCategory.Medium,
        AircraftCategory.GeneralAviation => WakeCategory.Light,
        AircraftCategory.UltralightAndGlider => WakeCategory.Light,
        _ => WakeCategory.Light
    };

    private static List<string> GenerateReplanningSuggestions(List<SeparationConflict> conflicts)
    {
        var suggestions = new List<string>();
        foreach (var c in conflicts)
        {
            if (!string.IsNullOrWhiteSpace(c.ReplanningRecommendation) && !suggestions.Contains(c.ReplanningRecommendation))
            {
                suggestions.Add($"[{c.Type}] {c.ReplanningRecommendation}");
            }
        }
        return suggestions;
    }
}
