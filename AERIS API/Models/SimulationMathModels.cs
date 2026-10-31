namespace Aeris.PlanningEngine.Models;

/// <summary>
/// Snapshot al predicției meteo și de trafic la un orizont de timp viitor (ex: T+0, T+5m, T+10m, T+15m, T+30m, T+45m).
/// </summary>
public record FutureHorizonSnapshot(
    int HorizonMinutes,
    int HorizonSeconds,
    string FormattedTime,
    double PredictedWindDirectionDegrees,
    double PredictedWindSpeedKnots,
    double PredictedWindGustKnots,
    int PredictedVisibilityMeters,
    string RecommendedRunway,
    double PredictedCrosswindKnots,
    double PredictedHeadwindKnots,
    bool IsVfrLegalAndSafe,
    int ActiveAirborneCount,
    int HoldingCount,
    int CumulativeLandedCount,
    string? HazardAlert = null
);

/// <summary>
/// Predicția completă 4D a evoluției atmosferei, vântului pe altitudine (spirala Ekman / legea Hellmann)
/// și a stării pistei pe următoarele 45 de minute.
/// </summary>
public record FuturePredictionSummary(
    double PressureHpa,
    double OutsideAirTemperatureCelsius,
    double IsaTemperatureDeviationCelsius,
    double PressureAltitudeFeet,
    double DensityAltitudeFeet,
    double AirDensityRatioSigma,
    double WindShearExponentAlpha,
    double WindAt2000FtDegrees,
    double WindAt2000FtKnots,
    double WindAt5000FtDegrees,
    double WindAt5000FtKnots,
    string TrendSummary,
    string OptimalVfrLandingWindow,
    int? PredictedRunwayChangeAtMinute,
    List<FutureHorizonSnapshot> Horizons
);

/// <summary>
/// Fază individuală din profilul complet de misiune De-la-Decolare-la-Aterizare (Takeoff-to-Landing).
/// </summary>
public record FlightMissionPhase(
    int PhaseOrder,
    string PhaseCode,
    string PhaseName,
    double StartAltitudeFeet,
    double EndAltitudeFeet,
    double TrueAirspeedKnots,
    double GroundSpeedKnots,
    double DistanceNm,
    double DurationMinutes,
    double VerticalRateFpm,
    double FuelBurnedMinutesEquivalent,
    string KeyMathNote
);

/// <summary>
/// Analiza cinematică și energetică completă de la Decolare până la Aterizare (Takeoff-to-Landing) pentru o aeronavă.
/// </summary>
public record TakeoffToLandingAnalysis(
    string DepartureAerodromeIcao,
    string DepartureAerodromeName,
    double TotalRouteDistanceNm,
    double CruiseAltitudeFeet,
    double CruiseTasKnots,
    double WindDirectionAtAltitudeDegrees,
    double WindSpeedAtAltitudeKnots,
    double WindCorrectionAngleCrabDegrees,
    double HeadingToFlyDegrees,
    double GroundSpeedApproachKnots,
    double TopOfDescentDistanceNm,
    double OptimalGlidepathDegrees,
    double RequiredRateOfDescentFpm,
    double StabilizationGateAltitudeFeetAmsl,
    double SpecificTotalEnergyFeet,
    double ApproachSpeedVappKnots,
    double ThresholdSpeedVrefKnots,
    double TouchdownGroundSpeedKnots,
    double LandingDistanceRequiredMeters,
    double LandingDistanceAvailableMeters,
    double RunwaySafetyMarginMeters,
    double RunwayUsedPercent,
    double PredictedRunwayOccupancySeconds,
    List<FlightMissionPhase> Phases
);

/// <summary>
/// Starea prezisă a aeronavei la un pas de predicție (T0 Curent, Pasul +1 Înainte, Pasul +2 Înainte).
/// </summary>
public record PredictionStepSnapshot(
    int StepIndex,
    string StepLabel,
    double TimeSeconds,
    string FormattedTime,
    string PhaseName,
    string FixOrLocation,
    double Latitude,
    double Longitude,
    double DistanceToThresholdNm,
    double AltitudeFeet,
    double TrueAirspeedKnots,
    double GroundSpeedKnots,
    double TrackDegrees,
    double HeadingDegrees,
    double CrabAngleDegrees,
    double VerticalSpeedFpm,
    double ExpectedCrosswindKnots,
    double ExpectedHeadwindKnots,
    double RemainingFuelMinutes,
    string ControllerAction
);

/// <summary>
/// Predicție anticipativă „Doi Pași Înaintea Avionului” (Two Steps Ahead of the Plane):
/// Starea curentă (T0) -> Pasul +1 (Punct de tranziție / IAF / IF / Intrare CTR) -> Pasul +2 (Prag Aterizare / Alternativă / Degajare).
/// </summary>
public record TwoStepsAheadPrediction(
    PredictionStepSnapshot CurrentState,
    PredictionStepSnapshot StepOneAhead,
    PredictionStepSnapshot StepTwoAhead,
    string PredictiveSummary
);

/// <summary>
/// Analiza matematică decizională pentru aeronavele VFR: Orbită (Holding) vs. Redirecționare (Divert) către cea mai bună pistă din apropiere.
/// </summary>
public record VfrRedirectionAnalysis(
    bool CanLandAtPrimaryRunway,
    bool CanLandAtReciprocalRunway,
    string RecommendedDecision,
    double DecisionConfidenceScore,
    double PointOfNoReturnMinutes,
    double FuelBurnCruiseLitersPerHour,
    double FuelBurnHoldLitersPerHour,
    double EstimatedWaitTimeAtLrcvMinutes,
    bool WillWeatherImproveWithinPnr,
    double PredictedCrosswindAfterHoldKnots,
    string BestAlternateCode,
    string BestAlternateName,
    string BestAlternateRunway,
    double BestAlternateScore,
    double RedirectionHeadingToFlyDegrees,
    double RedirectionGroundSpeedKnots,
    double RedirectionEtaMinutes,
    double FuelRemainingAtAlternateMinutes,
    string MathematicalJustification
);
