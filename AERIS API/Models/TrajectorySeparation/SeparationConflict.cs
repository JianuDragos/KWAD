namespace Aeris.PlanningEngine.Models.TrajectorySeparation;

/// <summary>
/// Tipul conflictului de separare detectat.
/// </summary>
public enum SeparationConflictType
{
    LossOfSeparation_IFR_IFR,     // Pierdere separare radar/verticală între două zboruri IFR
    LossOfSeparation_IFR_VFR,     // Pierdere separare ATC în Spațiul C între IFR și VFR
    LossOfSeparation_VFR_VFR,     // Alertă de proximitate între două zboruri VFR
    RunwayOccupancyViolation,     // Aterizare simultană / nerespectare eliberare pistă
    WakeTurbulenceViolation,      // Interval insuficient de siaj (ex. Light după Medium < 3 min)
    HoldingPatternConflict,       // Conflict de altitudine sau proximitate în circuitul de așteptare
    MissedApproachConflict,       // Traiectoria de ratare intersectează periculos alt zbor
    StrictHorizontalOverlap       // Suprapunere orizontală critică respinsă în Mod Strict
}

/// <summary>
/// Înregistrarea detaliată a unui conflict sau incident de proximitate detectat pe traiectorie.
/// </summary>
public record SeparationConflict(
    SeparationConflictType Type,
    string Aircraft1Id,
    string Aircraft2Id,
    double ConflictTimeSeconds,
    string FormattedTime,
    double HorizontalDistanceNm,
    double VerticalDistanceFt,
    double RequiredHorizontalNm,
    double RequiredVerticalFt,
    string Severity, // "Critical" sau "Warning"
    string Description,
    double Aircraft1Lat,
    double Aircraft1Lon,
    double Aircraft1AltFt,
    double Aircraft2Lat,
    double Aircraft2Lon,
    double Aircraft2AltFt,
    string ReplanningRecommendation
);

/// <summary>
/// Rezultatul evaluării de siguranță a traiectoriilor și planificării aterizărilor.
/// </summary>
public enum SafetyStatus
{
    Safe,       // Toate traiectoriile respectă separarea, pista și siajul
    Unsafe,     // S-au detectat conflicte; planul necesită replanificare
    Incomplete  // Date insuficiente pentru predicție completă
}

/// <summary>
/// Raportul complet de siguranță returnat de Trajectory &amp; Separation Engine.
/// </summary>
public record SafetyAssessmentResult(
    SafetyStatus Status,
    bool IsSafe,
    string Summary,
    List<SeparationConflict> Conflicts,
    int TotalEvaluatedPairs,
    int TotalTrajectoryPoints,
    DateTime EvaluatedAtUtc,
    List<string> ReplanningSuggestions
);
