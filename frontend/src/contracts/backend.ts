// Tipuri TypeScript pentru backendul KWAD / AERIS API.
// Derivate din recordurile C# din "AERIS API/Models" și din controllere.
// JSON: camelCase (implicit ASP.NET), enum-uri ca string (JsonStringEnumConverter în Program.cs).

export type FlightRules = 'IFR' | 'VFR';

export type AircraftCategory =
  | 'CommercialJet'
  | 'RegionalTurboprop'
  | 'GeneralAviation'
  | 'UltralightAndGlider';

export type AdvisoryStatus =
  | 'ClearedForApproach'
  | 'HoldInOrbitRecommended'
  | 'DivertRecommended';

// ---------- /api/planning ----------

export interface AircraftInput {
  id: string;
  flightRules: FlightRules;
  etaSeconds: number;
  earliestSeconds: number;
  latestSeconds: number;
  frozenTimeSeconds?: number | null;
}

export interface ScenarioRules {
  minimumGapSeconds: number;
  allowVfr?: boolean;              // implicit true
  baseTimeOffsetSeconds?: number;  // implicit 50400 (14:00), folosit doar pentru formattedTime
}

/** Body pentru POST /api/planning/evaluate. Câmpurile lipsă devin 0 pe server, fără eroare: trimite-le pe toate. */
export interface EvaluationRequest {
  aircrafts: AircraftInput[];
  rules: ScenarioRules;
}

export interface ScheduleSlot {
  aircraftId: string;
  flightRules: FlightRules;
  calculatedTimeSeconds: number;
  delaySeconds: number;
  formattedTime: string; // "HH:mm" = calculatedTimeSeconds + baseTimeOffsetSeconds; fără dată, fără fus orar
  delayMinutes: number;
}

export interface EvaluationVariant {
  sequenceOrder: string[];
  schedule: ScheduleSlot[];          // la variantele respinse: doar sloturile calculate până la eroare
  isValid: boolean;
  rejectionReason: string | null;    // text liber; aeronava vinovată apare doar în text
  totalDelaySeconds: number;         // 0 la variantele respinse (nu înseamnă „fără întârziere”)
  totalDelayMinutes: number;
  maxDelaySeconds: number;
  maxDelayMinutes: number;
  delayedAircraftCount: number;
}

export interface PlanningResponse {
  validVariants: EvaluationVariant[];    // sortate, maxim 3
  rejectedVariants: EvaluationVariant[];
  totalEvaluatedVariants: number;
}

/** 400 de la /api/planning/evaluate când validarea scenariului eșuează. */
export interface PlanningError {
  error: string;
}

// ---------- /api/craiova & Motorul Matematic de Predicție ----------

export interface WeatherCondition {
  windDirectionDegrees: number; // implicit 180
  windSpeedKnots: number;       // implicit 20
  windGustKnots: number;        // implicit 26
  visibilityMeters: number;     // implicit 9999
}

export interface CraiovaAircraft {
  id: string;
  callsign: string;
  modelName: string;
  category: AircraftCategory;
  flightRules: FlightRules;
  hasInstrumentAvionics: boolean;
  maxCrosswindKnots: number;
  etaSeconds: number;
  earliestSeconds: number;
  latestSeconds: number;
  frozenTimeSeconds?: number | null;
  speedKnots?: number;            // implicit 100
  remainingFuelMinutes?: number;  // implicit 90
}

export interface AlternateAerodrome {
  name: string;
  code: string;
  distanceKm: number;
  bearingDegrees: number;
  runwayHeadingDegrees: number;
  bestRunway: string;
  calculatedCrosswindKnots: number;
  calculatedHeadwindKnots: number;
  estimatedFlightMinutes: number;
  suitabilityReason: string;
  safetyScore?: number;
  runwayLengthMeters?: number;
  surfaceType?: string;
  landingDistanceRequiredMeters?: number;
  landingSafetyMarginMeters?: number;
  windCorrectedHeadingDegrees?: number;
  groundSpeedToAlternateKnots?: number;
  remainingFuelAtTouchdownMinutes?: number;
  isRecommendedBestSpot?: boolean;
}

export interface HoldingRacetrackConfig {
  fixId: string;
  fixLatitude: number;
  fixLongitude: number;
  inboundHeadingDegrees: number;
  turnDirection?: string;
  legDurationSeconds?: number;
  speedKnots?: number;
  altitudeFeet?: number;
  entryTimeSeconds?: number;
  durationSeconds?: number;
}

export interface OrbitPatternAdvice {
  patternName: string;
  recommendedAltitudeFeet: number;
  holdingDurationMinutes: number;
  remainingFuelMarginMinutes: number;
  safetyInstructions: string;
  racetrack?: HoldingRacetrackConfig | null;
}

export interface FlightMissionPhase {
  phaseOrder: number;
  phaseCode: string;
  phaseName: string;
  startAltitudeFeet: number;
  endAltitudeFeet: number;
  trueAirspeedKnots: number;
  groundSpeedKnots: number;
  distanceNm: number;
  durationMinutes: number;
  verticalRateFpm: number;
  fuelBurnedMinutesEquivalent: number;
  keyMathNote: string;
}

export interface TakeoffToLandingAnalysis {
  departureAerodromeIcao: string;
  departureAerodromeName: string;
  totalRouteDistanceNm: number;
  cruiseAltitudeFeet: number;
  cruiseTasKnots: number;
  windDirectionAtAltitudeDegrees: number;
  windSpeedAtAltitudeKnots: number;
  windCorrectionAngleCrabDegrees: number;
  headingToFlyDegrees: number;
  groundSpeedApproachKnots: number;
  topOfDescentDistanceNm: number;
  optimalGlidepathDegrees: number;
  requiredRateOfDescentFpm: number;
  stabilizationGateAltitudeFeetAmsl: number;
  specificTotalEnergyFeet: number;
  approachSpeedVappKnots: number;
  thresholdSpeedVrefKnots: number;
  touchdownGroundSpeedKnots: number;
  landingDistanceRequiredMeters: number;
  landingDistanceAvailableMeters: number;
  runwaySafetyMarginMeters: number;
  runwayUsedPercent: number;
  predictedRunwayOccupancySeconds: number;
  phases: FlightMissionPhase[];
}

export interface PredictionStepSnapshot {
  stepIndex: number;
  stepLabel: string;
  timeSeconds: number;
  formattedTime: string;
  phaseName: string;
  fixOrLocation: string;
  latitude: number;
  longitude: number;
  distanceToThresholdNm: number;
  altitudeFeet: number;
  trueAirspeedKnots: number;
  groundSpeedKnots: number;
  trackDegrees: number;
  headingDegrees: number;
  crabAngleDegrees: number;
  verticalSpeedFpm: number;
  expectedCrosswindKnots: number;
  expectedHeadwindKnots: number;
  remainingFuelMinutes: number;
  controllerAction: string;
}

export interface TwoStepsAheadPrediction {
  currentState: PredictionStepSnapshot;
  stepOneAhead: PredictionStepSnapshot;
  stepTwoAhead: PredictionStepSnapshot;
  predictiveSummary: string;
}

export interface VfrRedirectionAnalysis {
  canLandAtPrimaryRunway: boolean;
  canLandAtReciprocalRunway: boolean;
  recommendedDecision: string;
  decisionConfidenceScore: number;
  pointOfNoReturnMinutes: number;
  fuelBurnCruiseLitersPerHour: number;
  fuelBurnHoldLitersPerHour: number;
  estimatedWaitTimeAtLrcvMinutes: number;
  willWeatherImproveWithinPnr: boolean;
  predictedCrosswindAfterHoldKnots: number;
  bestAlternateCode: string;
  bestAlternateName: string;
  bestAlternateRunway: string;
  bestAlternateScore: number;
  redirectionHeadingToFlyDegrees: number;
  redirectionGroundSpeedKnots: number;
  redirectionEtaMinutes: number;
  fuelRemainingAtAlternateMinutes: number;
  mathematicalJustification: string;
}

export interface FutureHorizonSnapshot {
  horizonMinutes: number;
  horizonSeconds: number;
  formattedTime: string;
  predictedWindDirectionDegrees: number;
  predictedWindSpeedKnots: number;
  predictedWindGustKnots: number;
  predictedVisibilityMeters: number;
  recommendedRunway: string;
  predictedCrosswindKnots: number;
  predictedHeadwindKnots: number;
  isVfrLegalAndSafe: boolean;
  activeAirborneCount: number;
  holdingCount: number;
  cumulativeLandedCount: number;
  hazardAlert?: string | null;
}

export interface FuturePredictionSummary {
  pressureHpa: number;
  outsideAirTemperatureCelsius: number;
  isaTemperatureDeviationCelsius: number;
  pressureAltitudeFeet: number;
  densityAltitudeFeet: number;
  airDensityRatioSigma: number;
  windShearExponentAlpha: number;
  windAt2000FtDegrees: number;
  windAt2000FtKnots: number;
  windAt5000FtDegrees: number;
  windAt5000FtKnots: number;
  trendSummary: string;
  optimalVfrLandingWindow: string;
  predictedRunwayChangeAtMinute?: number | null;
  horizons: FutureHorizonSnapshot[];
}

export interface AircraftAdvisory {
  aircraftId: string;
  callsign: string;
  modelName: string;
  category: AircraftCategory;
  flightRules: FlightRules;
  hasInstrumentAvionics: boolean;
  assignedRunway?: string;
  currentCrosswindKnots: number;
  currentHeadwindKnots?: number;
  maxCrosswindLimitKnots: number;
  isOppositeDirectionLanding?: boolean;
  oppositeDirectionAdvice?: string | null;
  advisoryStatus: AdvisoryStatus;
  advisoryReason: string;
  orbitAdvice: OrbitPatternAdvice | null;
  recommendedAlternates: AlternateAerodrome[] | null;
  assignedLandingSlot: ScheduleSlot | null;
  takeoffToLanding?: TakeoffToLandingAnalysis | null;
  twoStepsAhead?: TwoStepsAheadPrediction | null;
  vfrRedirection?: VfrRedirectionAnalysis | null;
}

export interface CraiovaAirportInfo {
  icao: string;
  iata: string;
  name: string;
  latitude: number;
  longitude: number;
  elevationFeet: number;
  runways: string;
}

export interface SimulationTrafficStats {
  totalInbounds: number;
  commercialAirlinersCount: number;
  lightAircraftCount: number;
  clearedToLandCount: number;
  holdingInOrbitCount: number;
  divertAdvisedCount: number;
}

export type SafetyStatus = 'Safe' | 'Unsafe' | 'Incomplete';

export type SeparationConflictType =
  | 'LossOfSeparation_IFR_IFR'
  | 'LossOfSeparation_IFR_VFR'
  | 'LossOfSeparation_VFR_VFR'
  | 'RunwayOccupancyViolation'
  | 'WakeTurbulenceViolation'
  | 'HoldingPatternConflict'
  | 'MissedApproachConflict'
  | 'StrictHorizontalOverlap';
export interface SeparationConflict {
  type: SeparationConflictType;
  aircraft1Id: string;
  aircraft2Id: string;
  conflictTimeSeconds: number;
  formattedTime: string;
  horizontalDistanceNm: number;
  verticalDistanceFt: number;
  requiredHorizontalNm: number;
  requiredVerticalFt: number;
  severity: string;
  description: string;
  aircraft1Lat: number;
  aircraft1Lon: number;
  aircraft1AltFt: number;
  aircraft2Lat: number;
  aircraft2Lon: number;
  aircraft2AltFt: number;
  replanningRecommendation: string;
}

export interface SafetyAssessmentResult {
  status: SafetyStatus;
  isSafe: boolean;
  summary: string;
  conflicts: SeparationConflict[];
  totalEvaluatedPairs: number;
  totalTrajectoryPoints: number;
  evaluatedAtUtc: string;
  replanningSuggestions: string[];
}

export interface CraiovaSimulationResult {
  airport: CraiovaAirportInfo;
  weather: WeatherCondition;
  activeRunway: string;
  activeRunwayCrosswindKnots: number;
  activeRunwayHeadwindKnots: number;
  isCrosswindCriticalForLightAircraft: boolean;
  advisories: AircraftAdvisory[];
  clearedLandingSequences: PlanningResponse | null;
  stats: SimulationTrafficStats;
  dataSource: string;
  generatedAtUtc: string; // ISO 8601
  safetyAssessment?: SafetyAssessmentResult | null;
  futurePrediction?: FuturePredictionSummary | null;
}

/** Body pentru POST /api/craiova/evaluate. */
export interface CraiovaCustomEvaluationRequest {
  weather?: WeatherCondition | null;
  aircrafts?: CraiovaAircraft[] | null;
  useTrajectoryEngine?: boolean;
}

/** GET /api/craiova/live-traffic */
export interface LiveTrafficResponse {
  source: string;
  count: number;
  traffic: CraiovaAircraft[];
}

/** 400 automat de la [ApiController] când body-ul nu se poate deserializa (format ProblemDetails). */
export interface ValidationProblem {
  type?: string;
  title: string;
  status: number;
  errors?: Record<string, string[]>;
  traceId?: string;
}
