// Zborurile din bazele mock ROMATSA (GET /api/craiova/romatsa/ifr și /vfr), ca avioane de scenariu Demo.
// Validăm doar câmpurile folosite; restul fișierelor e documentație pentru backend.
import { z } from 'zod';
import type { AircraftCategory, CraiovaAircraft } from '../contracts/backend';
import { ARP } from '../data/geo';
import { distanceNm } from '../sim/geomath';

export const romatsaIfrSchema = z.object({
  ifrAircraftPerformanceDatabase: z.array(z.object({ icaoCode: z.string(), kinematics: z.object({ maxCrosswindDryKnots: z.number(), finalApproachSpeedVappKnots: z.number() }) })),
  mockLiveIfrFlights: z.array(
    z.object({
      aircraftId: z.string().optional(),
      callsign: z.string(),
      aircraftIcao: z.string(),
      aircraftModel: z.string(),
      flightPlan: z.object({ destinationAerodrome: z.string(), remainingFuelMinutes: z.number() }),
      takeoffToLandingProfile: z.object({ topOfDescentUtc: z.string(), topOfDescentDistanceFromLrcvNm: z.number() }),
    }),
  ),
});

export const romatsaVfrSchema = z.object({
  aircraftDatabase: z.array(z.object({ icaoCode: z.string(), typeCode: z.string(), vfrProfile: z.object({ maxCrosswindLimitKnots: z.number(), standardVfrPatternSpeedKnots: z.number() }) })),
  vfrVisualReportingPoints: z.array(z.object({ aerodromeIcao: z.string(), points: z.array(z.object({ code: z.string(), latitude: z.number(), longitude: z.number() })) })),
  mockLiveVfrFlights: z.array(
    z.object({
      callsign: z.string(),
      aircraftIcao: z.string(),
      aircraftModel: z.string(),
      flightPlan: z.object({ destinationAerodrome: z.string(), estimatedFlightTimeMinutes: z.number(), enduranceMinutes: z.number() }),
      liveTelemetry: z.object({ groundSpeedKnots: z.number(), nextReportingPoint: z.string(), estimatedTimeToPointMinutes: z.number() }),
    }),
  ),
});

export type RomatsaIfr = z.infer<typeof romatsaIfrSchema>;
export type RomatsaVfr = z.infer<typeof romatsaVfrSchema>;

/** Secunda 0 a scenariului: 14:00 UTC, ca în traficul simulat din backend (WZZ3751 „EtaSeconds: 0 // 14:00”). */
const SCENARIO_ZERO_UTC = Date.parse('2026-10-31T14:00:00Z');
/** Viteza medie de la top of descent la prag; dă 14:00 pentru WZZ3751 și ~14:05 pentru WZZ3762, ca în backend. */
const DESCENT_GROUND_SPEED_KT = 300;

/** Ultima literă din codul de tip ICAO (L2J, L2T, L1P) spune motorul. */
function categoryFor(typeCode: string | undefined, ifr: boolean): AircraftCategory {
  const engine = typeCode?.at(-1);
  if (engine === 'J') return 'CommercialJet';
  if (engine === 'T') return 'RegionalTurboprop';
  if (engine === 'P') return 'GeneralAviation';
  return ifr ? 'CommercialJet' : 'GeneralAviation';
}

/** Doar zborurile cu destinația Craiova; ETA în secunde de la 14:00 UTC. */
export function romatsaArrivals(ifr: RomatsaIfr, vfr: RomatsaVfr): CraiovaAircraft[] {
  const typeCode = new Map(vfr.aircraftDatabase.map((a) => [a.icaoCode, a.typeCode]));
  const ifrTypes = new Map(ifr.ifrAircraftPerformanceDatabase.map((a) => [a.icaoCode, a.kinematics]));
  const vfrTypes = new Map(vfr.aircraftDatabase.map((a) => [a.icaoCode, a.vfrProfile]));
  const points = new Map(vfr.vfrVisualReportingPoints.find((p) => p.aerodromeIcao === 'LRCV')?.points.map((p) => [p.code, p]) ?? []);
  const arrivalWindow = (eta: number) => ({ etaSeconds: eta, earliestSeconds: Math.max(0, eta - 60), latestSeconds: eta + 300, frozenTimeSeconds: null });

  const ifrArrivals = ifr.mockLiveIfrFlights.flatMap((f): CraiovaAircraft[] => {
    const type = ifrTypes.get(f.aircraftIcao);
    if (f.flightPlan.destinationAerodrome !== 'LRCV' || !type) return [];
    const p = f.takeoffToLandingProfile;
    const eta = Math.round((Date.parse(p.topOfDescentUtc) - SCENARIO_ZERO_UTC) / 1000 + (p.topOfDescentDistanceFromLrcvNm / DESCENT_GROUND_SPEED_KT) * 3600);
    return [{
      id: f.aircraftId ?? f.callsign, callsign: f.callsign, modelName: f.aircraftModel,
      category: categoryFor(typeCode.get(f.aircraftIcao), true), flightRules: 'IFR', hasInstrumentAvionics: true,
      maxCrosswindKnots: type.maxCrosswindDryKnots, ...arrivalWindow(eta), speedKnots: type.finalApproachSpeedVappKnots,
      remainingFuelMinutes: f.flightPlan.remainingFuelMinutes,
    }];
  });

  const vfrArrivals = vfr.mockLiveVfrFlights.flatMap((f): CraiovaAircraft[] => {
    const type = vfrTypes.get(f.aircraftIcao);
    const t = f.liveTelemetry;
    const point = points.get(t.nextReportingPoint);
    if (f.flightPlan.destinationAerodrome !== 'LRCV' || !type || !point) return [];
    // Poziția din telemetrie e „acum” = 14:00: minutele până la punctul VFR, apoi direct spre aerodrom.
    const toField = distanceNm({ lat: point.latitude, lon: point.longitude }, ARP);
    const eta = Math.round(t.estimatedTimeToPointMinutes * 60 + (toField / t.groundSpeedKnots) * 3600);
    const category = categoryFor(typeCode.get(f.aircraftIcao), false);
    return [{
      id: f.callsign, callsign: f.callsign, modelName: f.aircraftModel,
      category, flightRules: 'VFR', hasInstrumentAvionics: category !== 'UltralightAndGlider',
      maxCrosswindKnots: type.maxCrosswindLimitKnots, ...arrivalWindow(eta), speedKnots: type.standardVfrPatternSpeedKnots,
      remainingFuelMinutes: f.flightPlan.enduranceMinutes - f.flightPlan.estimatedFlightTimeMinutes,
    }];
  });

  return [...ifrArrivals, ...vfrArrivals];
}

/** Adaugă avioanele ROMATSA care nu sunt deja în scenariu (același indicativ = același zbor). */
export function withRomatsa(traffic: CraiovaAircraft[], extra: CraiovaAircraft[]): CraiovaAircraft[] {
  const known = new Set(traffic.map((a) => a.callsign));
  return [...traffic, ...extra.filter((a) => !known.has(a.callsign))];
}
