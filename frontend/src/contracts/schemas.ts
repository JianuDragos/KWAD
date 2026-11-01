// Validarea răspunsurilor backendului la graniță.
// Fiecare schemă e legată de tipul din backend.ts, deci compilatorul semnalează nepotrivirile.
import { z } from 'zod';
import type {
  AircraftAdvisory,
  AlternateAerodrome,
  CraiovaAircraft,
  CraiovaSimulationResult,
  EvaluationVariant,
  FlightMissionPhase,
  FutureHorizonSnapshot,
  FuturePredictionSummary,
  HoldingRacetrackConfig,
  LiveTrafficResponse,
  OrbitPatternAdvice,
  PlanningResponse,
  PredictionStepSnapshot,
  SafetyAssessmentResult,
  ScheduleSlot,
  SeparationConflict,
  TakeoffToLandingAnalysis,
  TwoStepsAheadPrediction,
  VfrRedirectionAnalysis,
  WeatherCondition,
} from './backend';

const flightRules = z.enum(['IFR', 'VFR']);
const category = z.enum(['CommercialJet', 'RegionalTurboprop', 'GeneralAviation', 'UltralightAndGlider']);
const advisoryStatus = z.enum(['ClearedForApproach', 'HoldInOrbitRecommended', 'DivertRecommended']);

export const scheduleSlotSchema: z.ZodType<ScheduleSlot> = z.object({
  aircraftId: z.string(),
  flightRules,
  calculatedTimeSeconds: z.number(),
  delaySeconds: z.number(),
  formattedTime: z.string(),
  delayMinutes: z.number(),
});

const evaluationVariantSchema: z.ZodType<EvaluationVariant> = z.object({
  sequenceOrder: z.array(z.string()),
  schedule: z.array(scheduleSlotSchema),
  isValid: z.boolean(),
  rejectionReason: z.string().nullable(),
  totalDelaySeconds: z.number(),
  totalDelayMinutes: z.number(),
  maxDelaySeconds: z.number(),
  maxDelayMinutes: z.number(),
  delayedAircraftCount: z.number(),
});

export const planningResponseSchema: z.ZodType<PlanningResponse> = z.object({
  validVariants: z.array(evaluationVariantSchema),
  rejectedVariants: z.array(evaluationVariantSchema),
  totalEvaluatedVariants: z.number(),
});

const weatherSchema: z.ZodType<WeatherCondition> = z.object({
  windDirectionDegrees: z.number(),
  windSpeedKnots: z.number(),
  windGustKnots: z.number(),
  visibilityMeters: z.number(),
});

const aircraftSchema: z.ZodType<CraiovaAircraft> = z.object({
  id: z.string(),
  callsign: z.string(),
  modelName: z.string(),
  category,
  flightRules,
  hasInstrumentAvionics: z.boolean(),
  maxCrosswindKnots: z.number(),
  etaSeconds: z.number(),
  earliestSeconds: z.number(),
  latestSeconds: z.number(),
  frozenTimeSeconds: z.number().nullable().optional(),
  speedKnots: z.number().optional(),
  remainingFuelMinutes: z.number().optional(),
  departureIcao: z.string().nullable().optional(),
  destinationIcao: z.string().nullable().optional(),
});

const alternateSchema: z.ZodType<AlternateAerodrome> = z.object({
  name: z.string(),
  code: z.string(),
  distanceKm: z.number(),
  bearingDegrees: z.number(),
  runwayHeadingDegrees: z.number(),
  bestRunway: z.string(),
  calculatedCrosswindKnots: z.number(),
  calculatedHeadwindKnots: z.number(),
  estimatedFlightMinutes: z.number(),
  suitabilityReason: z.string(),
  safetyScore: z.number().optional(),
  runwayLengthMeters: z.number().optional(),
  surfaceType: z.string().optional(),
  landingDistanceRequiredMeters: z.number().optional(),
  landingSafetyMarginMeters: z.number().optional(),
  windCorrectedHeadingDegrees: z.number().optional(),
  groundSpeedToAlternateKnots: z.number().optional(),
  remainingFuelAtTouchdownMinutes: z.number().optional(),
  isRecommendedBestSpot: z.boolean().optional(),
});

const racetrackSchema: z.ZodType<HoldingRacetrackConfig> = z.object({
  fixId: z.string(),
  fixLatitude: z.number(),
  fixLongitude: z.number(),
  inboundHeadingDegrees: z.number(),
  turnDirection: z.string().optional(),
  legDurationSeconds: z.number().optional(),
  speedKnots: z.number().optional(),
  altitudeFeet: z.number().optional(),
  entryTimeSeconds: z.number().optional(),
  durationSeconds: z.number().optional(),
});

const orbitSchema: z.ZodType<OrbitPatternAdvice> = z.object({
  patternName: z.string(),
  recommendedAltitudeFeet: z.number(),
  holdingDurationMinutes: z.number(),
  remainingFuelMarginMinutes: z.number(),
  safetyInstructions: z.string(),
  racetrack: racetrackSchema.nullable().optional(),
});

const missionPhaseSchema: z.ZodType<FlightMissionPhase> = z.object({
  phaseOrder: z.number(),
  phaseCode: z.string(),
  phaseName: z.string(),
  startAltitudeFeet: z.number(),
  endAltitudeFeet: z.number(),
  trueAirspeedKnots: z.number(),
  groundSpeedKnots: z.number(),
  distanceNm: z.number(),
  durationMinutes: z.number(),
  verticalRateFpm: z.number(),
  fuelBurnedMinutesEquivalent: z.number(),
  keyMathNote: z.string(),
});

const takeoffToLandingSchema: z.ZodType<TakeoffToLandingAnalysis> = z.object({
  departureAerodromeIcao: z.string(),
  departureAerodromeName: z.string(),
  totalRouteDistanceNm: z.number(),
  cruiseAltitudeFeet: z.number(),
  cruiseTasKnots: z.number(),
  windDirectionAtAltitudeDegrees: z.number(),
  windSpeedAtAltitudeKnots: z.number(),
  windCorrectionAngleCrabDegrees: z.number(),
  headingToFlyDegrees: z.number(),
  groundSpeedApproachKnots: z.number(),
  topOfDescentDistanceNm: z.number(),
  optimalGlidepathDegrees: z.number(),
  requiredRateOfDescentFpm: z.number(),
  stabilizationGateAltitudeFeetAmsl: z.number(),
  specificTotalEnergyFeet: z.number(),
  approachSpeedVappKnots: z.number(),
  thresholdSpeedVrefKnots: z.number(),
  touchdownGroundSpeedKnots: z.number(),
  landingDistanceRequiredMeters: z.number(),
  landingDistanceAvailableMeters: z.number(),
  runwaySafetyMarginMeters: z.number(),
  runwayUsedPercent: z.number(),
  predictedRunwayOccupancySeconds: z.number(),
  phases: z.array(missionPhaseSchema),
  departureLatitude: z.number().nullable().optional(),
  departureLongitude: z.number().nullable().optional(),
});

const stepSnapshotSchema: z.ZodType<PredictionStepSnapshot> = z.object({
  stepIndex: z.number(),
  stepLabel: z.string(),
  timeSeconds: z.number(),
  formattedTime: z.string(),
  phaseName: z.string(),
  fixOrLocation: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  distanceToThresholdNm: z.number(),
  altitudeFeet: z.number(),
  trueAirspeedKnots: z.number(),
  groundSpeedKnots: z.number(),
  trackDegrees: z.number(),
  headingDegrees: z.number(),
  crabAngleDegrees: z.number(),
  verticalSpeedFpm: z.number(),
  expectedCrosswindKnots: z.number(),
  expectedHeadwindKnots: z.number(),
  remainingFuelMinutes: z.number(),
  controllerAction: z.string(),
});

const twoStepsAheadSchema: z.ZodType<TwoStepsAheadPrediction> = z.object({
  currentState: stepSnapshotSchema,
  stepOneAhead: stepSnapshotSchema,
  stepTwoAhead: stepSnapshotSchema,
  predictiveSummary: z.string(),
});

const vfrRedirectionSchema: z.ZodType<VfrRedirectionAnalysis> = z.object({
  canLandAtPrimaryRunway: z.boolean(),
  canLandAtReciprocalRunway: z.boolean(),
  recommendedDecision: z.string(),
  decisionConfidenceScore: z.number(),
  pointOfNoReturnMinutes: z.number(),
  fuelBurnCruiseLitersPerHour: z.number(),
  fuelBurnHoldLitersPerHour: z.number(),
  estimatedWaitTimeAtLrcvMinutes: z.number(),
  willWeatherImproveWithinPnr: z.boolean(),
  predictedCrosswindAfterHoldKnots: z.number(),
  bestAlternateCode: z.string(),
  bestAlternateName: z.string(),
  bestAlternateRunway: z.string(),
  bestAlternateScore: z.number(),
  redirectionHeadingToFlyDegrees: z.number(),
  redirectionGroundSpeedKnots: z.number(),
  redirectionEtaMinutes: z.number(),
  fuelRemainingAtAlternateMinutes: z.number(),
  mathematicalJustification: z.string(),
});

const advisorySchema: z.ZodType<AircraftAdvisory> = z.object({
  aircraftId: z.string(),
  callsign: z.string(),
  modelName: z.string(),
  category,
  flightRules,
  hasInstrumentAvionics: z.boolean(),
  assignedRunway: z.string().optional(),
  currentCrosswindKnots: z.number(),
  currentHeadwindKnots: z.number().optional(),
  maxCrosswindLimitKnots: z.number(),
  isOppositeDirectionLanding: z.boolean().optional(),
  oppositeDirectionAdvice: z.string().nullable().optional(),
  advisoryStatus,
  advisoryReason: z.string(),
  orbitAdvice: orbitSchema.nullable(),
  recommendedAlternates: z.array(alternateSchema).nullable(),
  assignedLandingSlot: scheduleSlotSchema.nullable(),
  takeoffToLanding: takeoffToLandingSchema.nullable().optional(),
  twoStepsAhead: twoStepsAheadSchema.nullable().optional(),
  vfrRedirection: vfrRedirectionSchema.nullable().optional(),
});

const futureHorizonSchema: z.ZodType<FutureHorizonSnapshot> = z.object({
  horizonMinutes: z.number(),
  horizonSeconds: z.number(),
  formattedTime: z.string(),
  predictedWindDirectionDegrees: z.number(),
  predictedWindSpeedKnots: z.number(),
  predictedWindGustKnots: z.number(),
  predictedVisibilityMeters: z.number(),
  recommendedRunway: z.string(),
  predictedCrosswindKnots: z.number(),
  predictedHeadwindKnots: z.number(),
  isVfrLegalAndSafe: z.boolean(),
  activeAirborneCount: z.number(),
  holdingCount: z.number(),
  cumulativeLandedCount: z.number(),
  hazardAlert: z.string().nullable().optional(),
});

const futurePredictionSchema: z.ZodType<FuturePredictionSummary> = z.object({
  pressureHpa: z.number(),
  outsideAirTemperatureCelsius: z.number(),
  isaTemperatureDeviationCelsius: z.number(),
  pressureAltitudeFeet: z.number(),
  densityAltitudeFeet: z.number(),
  airDensityRatioSigma: z.number(),
  windShearExponentAlpha: z.number(),
  windAt2000FtDegrees: z.number(),
  windAt2000FtKnots: z.number(),
  windAt5000FtDegrees: z.number(),
  windAt5000FtKnots: z.number(),
  trendSummary: z.string(),
  optimalVfrLandingWindow: z.string(),
  predictedRunwayChangeAtMinute: z.number().nullable().optional(),
  horizons: z.array(futureHorizonSchema),
});

const separationConflictSchema: z.ZodType<SeparationConflict> = z.object({
  type: z.enum([
    'LossOfSeparation_IFR_IFR',
    'LossOfSeparation_IFR_VFR',
    'LossOfSeparation_VFR_VFR',
    'RunwayOccupancyViolation',
    'WakeTurbulenceViolation',
    'HoldingPatternConflict',
    'MissedApproachConflict',
    'StrictHorizontalOverlap',
  ]),
  aircraft1Id: z.string(),
  aircraft2Id: z.string(),
  conflictTimeSeconds: z.number(),
  formattedTime: z.string(),
  horizontalDistanceNm: z.number(),
  verticalDistanceFt: z.number(),
  requiredHorizontalNm: z.number(),
  requiredVerticalFt: z.number(),
  severity: z.string(),
  description: z.string(),
  aircraft1Lat: z.number(),
  aircraft1Lon: z.number(),
  aircraft1AltFt: z.number(),
  aircraft2Lat: z.number(),
  aircraft2Lon: z.number(),
  aircraft2AltFt: z.number(),
  replanningRecommendation: z.string(),
});

const safetyAssessmentSchema: z.ZodType<SafetyAssessmentResult> = z.object({
  status: z.enum(['Safe', 'Unsafe', 'Incomplete']),
  isSafe: z.boolean(),
  summary: z.string(),
  conflicts: z.array(separationConflictSchema),
  totalEvaluatedPairs: z.number(),
  totalTrajectoryPoints: z.number(),
  evaluatedAtUtc: z.string(),
  replanningSuggestions: z.array(z.string()),
});

export const simulationResultSchema: z.ZodType<CraiovaSimulationResult> = z.object({
  airport: z.object({
    icao: z.string(),
    iata: z.string(),
    name: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    elevationFeet: z.number(),
    runways: z.string(),
  }),
  weather: weatherSchema,
  activeRunway: z.string(),
  activeRunwayCrosswindKnots: z.number(),
  activeRunwayHeadwindKnots: z.number(),
  isCrosswindCriticalForLightAircraft: z.boolean(),
  advisories: z.array(advisorySchema),
  clearedLandingSequences: planningResponseSchema.nullable(),
  stats: z.object({
    totalInbounds: z.number(),
    commercialAirlinersCount: z.number(),
    lightAircraftCount: z.number(),
    clearedToLandCount: z.number(),
    holdingInOrbitCount: z.number(),
    divertAdvisedCount: z.number(),
  }),
  dataSource: z.string(),
  generatedAtUtc: z.string(),
  safetyAssessment: safetyAssessmentSchema.nullable().optional(),
  futurePrediction: futurePredictionSchema.nullable().optional(),
});

export const liveTrafficSchema: z.ZodType<LiveTrafficResponse> = z.object({
  source: z.string(),
  count: z.number(),
  traffic: z.array(aircraftSchema),
});

/** Primul câmp invalid, ca text scurt: „advisories.0.advisoryStatus: Invalid option…”. */
export function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const where = issue.path.length ? issue.path.join('.') : '(rădăcină)';
  return `${where}: ${issue.message}`;
}
