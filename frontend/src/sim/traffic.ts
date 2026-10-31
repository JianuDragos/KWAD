// Leagă scenariul (aeronavele trimise) de rezultatul backendului și construiește ce desenează harta.
// Nu decide ordinea sau timpii de sosire: aceștia vin din backend (slot) sau din ETA-ul scenariului.
import type {
  AircraftAdvisory,
  AdvisoryStatus,
  AlternateAerodrome,
  CraiovaAircraft,
  CraiovaSimulationResult,
  ScheduleSlot,
} from '../contracts/backend';
import {
  ARP,
  IAF_IDS,
  LRCW,
  VFR_ENTRY_POINTS,
  runwayFromBackend,
  arrivalRoute,
  runwayTrueBearing,
  threshold,
  vfrFinalJoin,
  type NamedPoint,
  type RunwayId,
} from '../data/geo';
import { destination, type LatLon } from './geomath';
import type { TrackPoint } from './interpolate';
import { appendLeg, appendRacetrack, inboundExtension, trackArrivingAt, type PlannedFix } from './synthetic';

export type FlightKind = 'approach' | 'hold' | 'divert';

export interface FlightView {
  id: string;
  callsign: string;
  aircraft: CraiovaAircraft;
  advisory: AircraftAdvisory | null;
  status: AdvisoryStatus | 'Necunoscut';
  slot: ScheduleSlot | null;
  kind: FlightKind;
  routeLabel: string;
  /** Traseul planificat (stil „proiecție”). */
  plannedRoute: [number, number][];
  track: TrackPoint[];
  /** Momentul aterizării afișat pe hartă: slotul din backend, altfel ETA-ul scenariului. */
  landingSeconds: number | null;
  alternate: (AlternateAerodrome & { point: LatLon }) | null;
}

export interface TrafficModel {
  runway: RunwayId;
  flights: FlightView[];
  startSeconds: number;
  endSeconds: number;
}

const ROLLOUT_NM = 0.7;
/** Fereastra ceasului când scenariul nu are niciun avion. */
const EMPTY_WINDOW_SECONDS = 600;

export function buildTraffic(aircrafts: CraiovaAircraft[], result: CraiovaSimulationResult): TrafficModel {
  const runway = runwayFromBackend(result.activeRunway);
  if (aircrafts.length === 0) return { runway, flights: [], startSeconds: 0, endSeconds: EMPTY_WINDOW_SECONDS };
  const advisories = new Map(result.advisories.map((a) => [a.aircraftId, a]));

  const anchors = aircrafts.flatMap((a) => {
    const slot = advisories.get(a.id)?.assignedLandingSlot;
    return slot ? [a.etaSeconds, slot.calculatedTimeSeconds] : [a.etaSeconds];
  });
  const endSeconds = Math.ceil((Math.max(...anchors) + 600) / 60) * 60;

  let ifrIndex = 0;
  let vfrIndex = 0;
  const flights = aircrafts.map((aircraft): FlightView => {
    const advisory = advisories.get(aircraft.id) ?? null;
    const slot = advisory?.assignedLandingSlot ?? null;
    const status: FlightView['status'] = advisory?.advisoryStatus ?? 'Necunoscut';
    const kind: FlightKind =
      status === 'HoldInOrbitRecommended' ? 'hold' : status === 'DivertRecommended' ? 'divert' : 'approach';
    const isIfr = aircraft.flightRules === 'IFR';
    const entry = isIfr ? IAF_IDS[ifrIndex++ % IAF_IDS.length] : VFR_ENTRY_POINTS[vfrIndex++ % VFR_ENTRY_POINTS.length];
    const base = { id: aircraft.id, callsign: aircraft.callsign, aircraft, advisory, status, slot, kind };

    if (isIfr) {
      const route = ifrFixes(runway, entry as (typeof IAF_IDS)[number]);
      if (kind === 'hold') {
        const ifIndex = route.findIndex((f) => f.id === 'OZZET' || f.id === 'NECCO');
        const toIf = route.slice(0, ifIndex + 1);
        const holdAlt = advisory?.orbitAdvice?.recommendedAltitudeFeet ?? 4000;
        const fix = toIf[toIf.length - 1];
        let track = trackArrivingAt(toIf, ifrSpeeds(toIf), aircraft.etaSeconds);
        track = appendRacetrack(track, fix, runwayTrueBearing(runway), 'Right', holdAlt, 210, endSeconds);
        return { ...base, routeLabel: `${entry} → hipodrom ${fix.id} (${holdAlt}ft)`, plannedRoute: latLngs(toIf), track, landingSeconds: null, alternate: null };
      }
      const landingSeconds = slot?.calculatedTimeSeconds ?? aircraft.etaSeconds;
      const track = withRollout(trackArrivingAt(route, ifrSpeeds(route), landingSeconds), runway);
      return { ...base, routeLabel: `${entry} → RNP ${runway}`, plannedRoute: latLngs(route), track, landingSeconds, alternate: null };
    }

    const entryPoint = entry as NamedPoint;
    const speed = aircraft.speedKnots ?? 90;
    const outside: PlannedFix = { id: `${entryPoint.id}-ext`, altitudeFt: 1500, ...inboundExtension(entryPoint, ARP, 6) };
    const entryFix: PlannedFix = { ...entryPoint, altitudeFt: 1500 };

    if (kind === 'hold' || kind === 'divert') {
      const legs = [outside, entryFix];
      let track = trackArrivingAt(legs, [speed], aircraft.etaSeconds - 300);
      if (kind === 'hold') {
        const center = destination(ARP, 180, 2.5); // latura sudică a pistei (Cârcea – Pielești, după backend)
        const alt = advisory?.orbitAdvice?.recommendedAltitudeFeet ?? 1500;
        track = appendRacetrack(track, center, runwayTrueBearing(runway), 'Right', alt, speed, endSeconds);
        return { ...base, routeLabel: `${entryPoint.id} → hipodrom sud (${alt}ft)`, plannedRoute: latLngs(legs), track, landingSeconds: null, alternate: null };
      }
      const alternate = pickAlternate(advisory?.recommendedAlternates ?? null);
      if (alternate) track = appendLeg(track, alternate.point, 1000, speed);
      const plannedRoute = alternate ? [...latLngs(legs), [alternate.point.lat, alternate.point.lon] as [number, number]] : latLngs(legs);
      return { ...base, routeLabel: `${entryPoint.id} → deviere ${alternate?.name ?? '?'}`, plannedRoute, track, landingSeconds: null, alternate };
    }

    const join: PlannedFix = { ...vfrFinalJoin(runway), altitudeFt: 1000 };
    const thr = threshold(runway);
    const legs: PlannedFix[] = [outside, entryFix, join, { ...thr, altitudeFt: thr.elevationFt }];
    const landingSeconds = slot?.calculatedTimeSeconds ?? aircraft.etaSeconds;
    const track = withRollout(trackArrivingAt(legs, [speed, speed, speed * 0.85], landingSeconds), runway);
    return { ...base, routeLabel: `${entryPoint.id} → final ${runway}`, plannedRoute: latLngs(legs), track, landingSeconds, alternate: null };
  });

  // Ceasul pornește când apare primul avion, rotunjit la minut.
  const startSeconds = Math.floor(Math.min(...flights.map((f) => f.track[0]?.timeSeconds ?? 0)) / 60) * 60;
  return { runway, flights, startSeconds, endSeconds };
}

function ifrFixes(runway: RunwayId, iaf: (typeof IAF_IDS)[number]): PlannedFix[] {
  const route = arrivalRoute(runway, iaf);
  const thr = threshold(runway);
  let lastAlt = 6000;
  const fixes: PlannedFix[] = route.map((f) => {
    const altitudeFt = f.id === thr.id ? thr.elevationFt : (f.altitudeFt ?? lastAlt);
    lastAlt = altitudeFt;
    return { id: f.id, lat: f.lat, lon: f.lon, altitudeFt };
  });
  const outside: PlannedFix = { id: `${iaf}-ext`, altitudeFt: 9000, ...inboundExtension(fixes[0], fixes[1], 15) };
  return [outside, ...fixes];
}

/** Viteze de simulare (inventate, sub limitele AIP): 250 kt până la IAF, 230 pe tranziție, 210 spre IF, 185 spre FAF, 140 pe final. */
function ifrSpeeds(fixes: PlannedFix[]): number[] {
  return fixes.slice(1).map((to, i) => {
    if (i === 0) return 250;
    if (to.id.startsWith('THR')) return 140;
    if (to.id === 'CV508' || to.id === 'CV408') return 185;
    if (to.id === 'OZZET' || to.id === 'NECCO') return 210;
    return 230;
  });
}

function withRollout(track: TrackPoint[], runway: RunwayId): TrackPoint[] {
  const thr = threshold(runway);
  return appendLeg(track, destination(thr, runwayTrueBearing(runway), ROLLOUT_NM), thr.elevationFt, 60);
}

function pickAlternate(alternates: AlternateAerodrome[] | null): FlightView['alternate'] {
  if (!alternates || alternates.length === 0) return null;
  const best = [...alternates].sort((a, b) => a.calculatedCrosswindKnots - b.calculatedCrosswindKnots || a.distanceKm - b.distanceKm)[0];
  // „Balta Verde / LRBV” din backend este Craiova-Sud (LRCW) în AIP; folosim coordonatele oficiale.
  const point = best.code === 'LRBV' || /balta verde/i.test(best.name) ? LRCW : destination(ARP, best.bearingDegrees, best.distanceKm / 1.852);
  return { ...best, point };
}

function latLngs(points: LatLon[]): [number, number][] {
  return points.map((p) => [p.lat, p.lon]);
}
