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
});
export type Metar = z.infer<typeof metarSchema>;
