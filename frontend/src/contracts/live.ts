// Endpoint-urile cu date reale (commit e3361bd): poziții OpenSky și METAR decodat.
// Validăm doar câmpurile pe care le folosește UI-ul; restul sunt ignorate.
import { z } from 'zod';

export const liveFlightSchema = z.object({
  icao24: z.string(),
  callsign: z.string(),
  originCountry: z.string().nullable().optional(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  baroAltitudeMeters: z.number().nullable(),
  geoAltitudeMeters: z.number().nullable().optional(),
  onGround: z.boolean(),
  velocityKnots: z.number().nullable(),
  trueTrackDegrees: z.number().nullable(),
  verticalRateMs: z.number().nullable(),
  timePosition: z.number().nullable(),
  lastContact: z.number(),
  squawk: z.string().nullable().optional(),
  flightRules: z.enum(['IFR', 'VFR', 'SVFR']),
  vfrEtaMinutes: z.number().nullable().optional(),
  vfrEntryPointCode: z.string().nullable().optional(),
  distanceFromLrcvKm: z.number().nullable(),
  bearingFromLrcvDegrees: z.number().nullable(),
});
export type LiveFlight = z.infer<typeof liveFlightSchema>;

export const livePositionsSchema = z.object({
  queryTimeUtc: z.string(),
  source: z.string(),
  totalCount: z.number(),
  airborneCount: z.number(),
  flights: z.array(liveFlightSchema),
});
export type LivePositions = z.infer<typeof livePositionsSchema>;

export const vfrPointSchema = z.object({ code: z.string(), lat: z.number(), long: z.number(), radiusMeters: z.number() });
export const vmcStatusSchema = z.object({
  status: z.enum(['VMC', 'MVFR', 'IMC', 'UNKNOWN']), isVmcValid: z.boolean(), visibilityMeters: z.number(), ceilingFeet: z.number().nullable(),
  windDirectionDegrees: z.number(), windSpeedKnots: z.number(), crosswindRunway08Knots: z.number().optional(), crosswindRunway26Knots: z.number().optional(), crosswindRunway09Knots: z.number().optional(), crosswindRunway27Knots: z.number().optional(), rawMetar: z.string(),
  source: z.string().optional(), sourceProvider: z.string().optional(), isStale: z.boolean().optional(),
});
export const vfrTrackingSchema = z.object({
  queryTimeUtc: z.string(), source: z.string(), totalCount: z.number(), airborneCount: z.number(),
  boundingBoxLamin: z.number(), boundingBoxLamax: z.number(), boundingBoxLomin: z.number(), boundingBoxLomax: z.number(),
  flights: z.array(liveFlightSchema), vmc: vmcStatusSchema, points: z.array(vfrPointSchema),
  vfrFlights: z.array(z.object({ flightId: z.string(), callsign: z.string(), pointCode: z.string(), distanceToPointMeters: z.number(), etaViaPointMinutes: z.number(), isVmcValid: z.boolean(), status: z.string() })),
});
export type VmcStatus = z.infer<typeof vmcStatusSchema>;
export type VfrPoint = z.infer<typeof vfrPointSchema>;
export type VfrTracking = z.infer<typeof vfrTrackingSchema>;

export const metarSchema = z.object({
  station: z.string(),
  rawMetar: z.string(),
  observationTimeUtc: z.string(),
  windDirectionDegrees: z.number().nullable(),
  windSpeedKnots: z.number(),
  windGustKnots: z.number().nullable(),
  isWindVariable: z.boolean(),
  visibilityMeters: z.number(),
  skyConditionDescription: z.string(),
  temperatureCelsius: z.number(),
  dewPointCelsius: z.number(),
  qnhHpa: z.number(),
  weatherPhenomena: z.string().nullable(),
  flightCategory: z.string(),
  isStale: z.boolean().optional(),
  sourceProvider: z.string().optional(),
  ceilingKnown: z.boolean().optional(),
});
export type Metar = z.infer<typeof metarSchema>;

/** Răspunsul de la POST /api/craiova/explain (recordul Explanation din GroundedExplainer.cs). */
export const explanationSchema = z.object({
  scenarioRevision: z.number(),
  mode: z.enum(['grounded_selection', 'deterministic_fallback']),
  statementIds: z.array(z.string()),
  sentences: z.array(z.string()),
  sourceIds: z.array(z.string()),
  fallbackReason: z.string().nullable(),
});
export type Explanation = z.infer<typeof explanationSchema>;
