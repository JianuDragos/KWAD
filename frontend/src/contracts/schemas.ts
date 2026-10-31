// Validarea răspunsurilor backendului la graniță. Contractul e încă în discuție: dacă un câmp se
// schimbă, aflăm aici, cu numele câmpului, nu printr-o eroare JS undeva în hartă.
// Fiecare schemă e legată de tipul din backend.ts, deci compilatorul semnalează nepotrivirile.
import { z } from 'zod';
import type {
  AircraftAdvisory,
  AlternateAerodrome,
  CraiovaAircraft,
  CraiovaSimulationResult,
  EvaluationVariant,
  LiveTrafficResponse,
  OrbitPatternAdvice,
  PlanningResponse,
  ScheduleSlot,
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
});

const orbitSchema: z.ZodType<OrbitPatternAdvice> = z.object({
  patternName: z.string(),
  recommendedAltitudeFeet: z.number(),
  holdingDurationMinutes: z.number(),
  remainingFuelMarginMinutes: z.number(),
  safetyInstructions: z.string(),
});

const advisorySchema: z.ZodType<AircraftAdvisory> = z.object({
  aircraftId: z.string(),
  callsign: z.string(),
  modelName: z.string(),
  category,
  flightRules,
  hasInstrumentAvionics: z.boolean(),
  currentCrosswindKnots: z.number(),
  maxCrosswindLimitKnots: z.number(),
  advisoryStatus,
  advisoryReason: z.string(),
  orbitAdvice: orbitSchema.nullable(),
  recommendedAlternates: z.array(alternateSchema).nullable(),
  assignedLandingSlot: scheduleSlotSchema.nullable(),
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
