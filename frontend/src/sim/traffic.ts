// Leagă scenariul (aeronavele trimise) de rezultatul backendului și construiește ce desenează harta.
// Fiecare aeronavă primește traiectoria completă 4D: Decolare (aerodrom origine) → Climb →
// Croazieră ortodromică (Great-Circle) → Top of Descent (TOD) → IAF/Intrare VFR → Finală → Prag LRCV / Orbită / Alternativă.
import type {
  AircraftAdvisory,
  AdvisoryStatus,
  AlternateAerodrome,
  CraiovaAircraft,
  CraiovaSimulationResult,
  ScheduleSlot,
} from '../contracts/backend';
import { resolveOriginAirport, selectIafForOrigin, type AirportInfo } from '../data/airports';
import { FALLBACK_FIRS, findTraversedFirs, type FirEntry } from '../data/airspace';
import {
  ARP,
  LRCW,
  VFR_ENTRY_POINTS,
  arrivalRoute,
  runwayFromBackend,
  runwayTrueBearing,
  threshold,
  vfrFinalJoin,
  type IafId,
  type NamedPoint,
  type RunwayId,
} from '../data/geo';
import { destination, distanceNm, greatCircleInterpolate, greatCirclePoints, type LatLon } from './geomath';
import type { TrackPoint } from './interpolate';
import { appendLeg, appendRacetrack, trackArrivingAt, type PlannedFix } from './synthetic';
import { feetLabel, metersToFeet } from './units';

export type FlightKind = 'approach' | 'hold' | 'divert';

export interface TodMarkerInfo {
  lat: number;
  lon: number;
  altitudeFt: number;
  distanceToLandingNm: number;
  timeSeconds: number;
}

export interface FlightView {
  id: string;
  callsign: string;
  aircraft: CraiovaAircraft;
  advisory: AircraftAdvisory | null;
  status: AdvisoryStatus | 'Necunoscut';
  slot: ScheduleSlot | null;
  kind: FlightKind;
  origin: AirportInfo;
  entryFixId: string;
  routeLabel: string;
  routeDistanceNm: number;
  /** Lista FIR-urilor traversate de la decolare până la LRCV (ex: ['EGTT', 'EHAA', 'EDGG', ..., 'LRBB']). */
  traversedFirs: string[];
  /** Traseul complet de la aeroportul de decolare până la aterizare / holding / alternativă. */
  fullRoute: [number, number][];
  /** Traseul planificat terminal + rută (compatibil cu afișarea proiecției). */
  plannedRoute: [number, number][];
  /** Punctul Top of Descent (TOD) calculat pe rută, dacă există fază de croazieră. */
  todPoint: TodMarkerInfo | null;
  /** Momentul de decolare de pe aerodromul de origine (secunde față de 14:00). */
  takeoffSeconds: number;
  track: TrackPoint[];
  /** Momentul aterizării afișat pe hartă: slotul din backend, altfel ETA-ul scenariului. */
  landingSeconds: number | null;
  alternate: (AlternateAerodrome & { point: LatLon }) | null;
}

export interface TrafficModel {
  runway: RunwayId;
  flights: FlightView[];
  /** Fereastra tactică de apropiere LRCV (implicit ~13 min înainte de primul ETA). */
  startSeconds: number;
  /** Primul moment de decolare din întregul scenariu (pentru vizualizarea De la Decolare). */
  missionStartSeconds: number;
  endSeconds: number;
}

const ROLLOUT_NM = 0.7;
/** Fereastra ceasului când scenariul nu are niciun avion. */
const EMPTY_WINDOW_SECONDS = 600;
/** Fereastra tactică implicită înaintea primului ETA (13 minute = 780s). */
const APPROACH_LEAD_SECONDS = 780;

export function buildTraffic(
  aircrafts: CraiovaAircraft[],
  result: CraiovaSimulationResult,
  firs: FirEntry[] = FALLBACK_FIRS,
): TrafficModel {
  const runway = runwayFromBackend(result.activeRunway);
  if (aircrafts.length === 0) {
    return { runway, flights: [], startSeconds: 0, missionStartSeconds: 0, endSeconds: EMPTY_WINDOW_SECONDS };
  }
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
    const origin = resolveOriginAirport(aircraft, advisory);
    const isIfr = aircraft.flightRules === 'IFR';
    const base = { id: aircraft.id, callsign: aircraft.callsign, aircraft, advisory, status, slot, kind, origin };

    if (isIfr) {
      const iaf = selectIafForOrigin(origin, ifrIndex++);
      const approachFixes = ifrApproachFixes(runway, iaf);
      const ttl = advisory?.takeoffToLanding;
      const cruiseAlt = ttl?.cruiseAltitudeFeet ?? (aircraft.category === 'RegionalTurboprop' ? 18000 : 34000);
      const cruiseGs = Math.max(
        180,
        ttl?.phases?.find((p) => p.phaseCode === 'CRZ')?.groundSpeedKnots ?? ttl?.cruiseTasKnots ?? 430,
      );

      if (kind === 'hold') {
        const ifIndex = approachFixes.findIndex((f) => f.id === 'OZZET' || f.id === 'NECCO');
        const toIf = approachFixes.slice(0, Math.max(1, ifIndex + 1));
        const { fixes, speeds, todFixIndex } = buildFullIfrChain(origin, toIf, cruiseAlt, cruiseGs);
        const holdAlt = advisory?.orbitAdvice?.recommendedAltitudeFeet ?? 4000;
        const holdFix = toIf[toIf.length - 1];
        let track = trackArrivingAt(fixes, speeds, aircraft.etaSeconds);
        const todPoint = extractTod(track, todFixIndex, holdFix);
        track = appendRacetrack(track, holdFix, runwayTrueBearing(runway), 'Right', holdAlt, 210, endSeconds);
        const fullRoute = latLngs(fixes);
        const routeDistanceNm = Math.round(polylineDistanceNm(fixes));
        const holdLabel = `${origin.icao} → ${iaf} → hipodrom ${holdFix.id} (${feetLabel(holdAlt)})`;
        return {
          ...base,
          entryFixId: iaf,
          routeLabel: holdLabel,
          routeDistanceNm,
          traversedFirs: findTraversedFirs(fullRoute, firs),
          fullRoute,
          plannedRoute: fullRoute,
          todPoint,
          takeoffSeconds: track[0]?.timeSeconds ?? 0,
          track,
          landingSeconds: null,
          alternate: null,
        };
      }

      const landingSeconds = slot?.calculatedTimeSeconds ?? aircraft.etaSeconds;
      const { fixes, speeds, todFixIndex } = buildFullIfrChain(origin, approachFixes, cruiseAlt, cruiseGs);
      const arrivalTrack = trackArrivingAt(fixes, speeds, landingSeconds);
      const todPoint = extractTod(arrivalTrack, todFixIndex, threshold(runway));
      const track = withRollout(arrivalTrack, runway);
      const fullRoute = latLngs(fixes);
      const routeDistanceNm = Math.round(polylineDistanceNm(fixes));
      return {
        ...base,
        entryFixId: iaf,
        routeLabel: `${origin.icao} → ${iaf} → RNP ${runway}`,
        routeDistanceNm,
        traversedFirs: findTraversedFirs(fullRoute, firs),
        fullRoute,
        plannedRoute: fullRoute,
        todPoint,
        takeoffSeconds: track[0]?.timeSeconds ?? 0,
        track,
        landingSeconds,
        alternate: null,
      };
    }

    // ---------- Zboruri VFR (Decolare de pe aerodrom regional/local → Intrare CTR → LRCV / Orbită / Alternativă) ----------
    const entryPoint = selectVfrEntryForOrigin(origin, vfrIndex++);
    const speed = Math.max(55, aircraft.speedKnots ?? 90);
    const cruiseAlt = Math.max(1500, advisory?.takeoffToLanding?.cruiseAltitudeFeet ?? 2200);
    const vfrEnrouteFixes = buildVfrOriginToEntryFixes(origin, entryPoint, cruiseAlt);

    if (kind === 'hold' || kind === 'divert') {
      const speeds = buildVfrSpeeds(vfrEnrouteFixes, speed);
      let track = trackArrivingAt(vfrEnrouteFixes, speeds, aircraft.etaSeconds - 300);
      if (kind === 'hold') {
        const center = destination(ARP, 180, 2.5); // latura sudică a pistei (Cârcea – Pielești, după backend)
        const alt = advisory?.orbitAdvice?.recommendedAltitudeFeet ?? 1500;
        track = appendRacetrack(track, center, runwayTrueBearing(runway), 'Right', alt, speed, endSeconds);
        const fullRoute = latLngs(vfrEnrouteFixes);
        const holdLabel = `${origin.icao} → ${entryPoint.id} → hipodrom sud (${feetLabel(alt)})`;
        return {
          ...base,
          entryFixId: entryPoint.id,
          routeLabel: holdLabel,
          routeDistanceNm: Math.max(1, Math.round(polylineDistanceNm(vfrEnrouteFixes))),
          traversedFirs: findTraversedFirs(fullRoute, firs),
          fullRoute,
          plannedRoute: fullRoute,
          todPoint: null,
          takeoffSeconds: track[0]?.timeSeconds ?? 0,
          track,
          landingSeconds: null,
          alternate: null,
        };
      }

      const alternate = pickAlternate(advisory?.recommendedAlternates ?? null);
      if (alternate) track = appendLeg(track, alternate.point, 1000, speed);
      const baseLatLngs = latLngs(vfrEnrouteFixes);
      const fullRoute: [number, number][] = alternate
        ? [...baseLatLngs, [alternate.point.lat, alternate.point.lon]]
        : baseLatLngs;
      return {
        ...base,
        entryFixId: entryPoint.id,
        routeLabel: `${origin.icao} → ${entryPoint.id} → deviere ${alternate?.name ?? '?'}`,
        routeDistanceNm: Math.max(1, Math.round(polylineDistanceNm(vfrEnrouteFixes))),
        traversedFirs: findTraversedFirs(fullRoute, firs),
        fullRoute,
        plannedRoute: fullRoute,
        todPoint: null,
        takeoffSeconds: track[0]?.timeSeconds ?? 0,
        track,
        landingSeconds: null,
        alternate,
      };
    }

    const join: PlannedFix = { ...vfrFinalJoin(runway), altitudeFt: 1000 };
    const thr = threshold(runway);
    const legs: PlannedFix[] = [...vfrEnrouteFixes, join, { ...thr, altitudeFt: thr.elevationFt }];
    const legSpeeds = [...buildVfrSpeeds(vfrEnrouteFixes, speed), speed, speed * 0.85];
    const landingSeconds = slot?.calculatedTimeSeconds ?? aircraft.etaSeconds;
    const arrivalTrack = trackArrivingAt(legs, legSpeeds, landingSeconds);
    const track = withRollout(arrivalTrack, runway);
    const fullRoute = latLngs(legs);
    return {
      ...base,
      entryFixId: entryPoint.id,
      routeLabel: `${origin.icao} → ${entryPoint.id} → final ${runway}`,
      routeDistanceNm: Math.max(1, Math.round(polylineDistanceNm(legs))),
      traversedFirs: findTraversedFirs(fullRoute, firs),
      fullRoute,
      plannedRoute: fullRoute,
      todPoint: null,
      takeoffSeconds: track[0]?.timeSeconds ?? 0,
      track,
      landingSeconds,
      alternate: null,
    };
  });

  const missionStartSeconds = Math.floor(Math.min(...flights.map((f) => f.takeoffSeconds)) / 60) * 60;
  const minAnchor = Math.min(...anchors);
  const startSeconds = Math.max(missionStartSeconds, Math.floor((minAnchor - APPROACH_LEAD_SECONDS) / 60) * 60);

  return { runway, flights, startSeconds, missionStartSeconds, endSeconds };
}

/** Construiește lanțul complet IFR: Decolare (origin) → Climb → Croazieră Great-Circle → TOD → Puncte AIP (IAF..THR). */
function buildFullIfrChain(
  origin: AirportInfo,
  approachFixes: PlannedFix[],
  cruiseAltFt: number,
  cruiseGsKt: number,
): { fixes: PlannedFix[]; speeds: number[]; todFixIndex: number | null } {
  const iaf = approachFixes[0];
  const distToIafNm = distanceNm(origin, iaf);
  const appSpeeds = ifrApproachSpeeds(approachFixes);

  if (distToIafNm < 22) {
    const depFix: PlannedFix = { id: origin.icao, lat: origin.lat, lon: origin.lon, altitudeFt: origin.elevationFt };
    const midPt = greatCircleInterpolate(origin, iaf, 0.5);
    const midAlt = Math.min(cruiseAltFt, Math.max(iaf.altitudeFt, 7000));
    const midFix: PlannedFix = { id: `${origin.icao}-TOC`, lat: midPt.lat, lon: midPt.lon, altitudeFt: midAlt };
    return {
      fixes: [depFix, midFix, ...approachFixes],
      speeds: [210, 250, ...appSpeeds],
      todFixIndex: 1,
    };
  }

  const climbDistNm = Math.min(distToIafNm * 0.24, Math.max(14, ((cruiseAltFt - origin.elevationFt) / 1000) * 2.3));
  const descentToIafNm = Math.min(distToIafNm * 0.44, Math.max(14, ((cruiseAltFt - iaf.altitudeFt) / 1000) * 3.05));

  const fInit = Math.min(0.08, 5 / distToIafNm);
  const fToc = Math.max(fInit + 0.04, Math.min(0.36, climbDistNm / distToIafNm));
  const fTod = Math.max(fToc + 0.08, Math.min(0.92, 1 - descentToIafNm / distToIafNm));

  const depFix: PlannedFix = { id: origin.icao, lat: origin.lat, lon: origin.lon, altitudeFt: origin.elevationFt };
  const initPt = greatCircleInterpolate(origin, iaf, fInit);
  const initFix: PlannedFix = {
    id: `${origin.icao}-DEP`,
    lat: initPt.lat,
    lon: initPt.lon,
    altitudeFt: Math.min(cruiseAltFt, origin.elevationFt + 2200),
  };

  const tocPt = greatCircleInterpolate(origin, iaf, fToc);
  const tocFix: PlannedFix = { id: `${origin.icao}-TOC`, lat: tocPt.lat, lon: tocPt.lon, altitudeFt: cruiseAltFt };

  const todPt = greatCircleInterpolate(origin, iaf, fTod);
  const todFix: PlannedFix = { id: `${origin.icao}-TOD`, lat: todPt.lat, lon: todPt.lon, altitudeFt: cruiseAltFt };

  // Eșantionăm arcul ortodromic pe segmentul de croazieră (pentru rute lungi ex. Beijing ZBAA → Craiova).
  const gcSamples = greatCirclePoints(tocPt, todPt, 65);
  const cruiseInteriorFixes: PlannedFix[] = gcSamples.slice(1, -1).map((pt, idx) => ({
    id: `${origin.icao}-CRZ${idx + 1}`,
    lat: pt.lat,
    lon: pt.lon,
    altitudeFt: cruiseAltFt,
  }));

  const desMidPt = greatCircleInterpolate(todPt, iaf, 0.55);
  const desMidFix: PlannedFix = {
    id: `${origin.icao}-DES`,
    lat: desMidPt.lat,
    lon: desMidPt.lon,
    altitudeFt: Math.round(iaf.altitudeFt + (cruiseAltFt - iaf.altitudeFt) * 0.42),
  };

  const enrouteFixes: PlannedFix[] = [depFix, initFix, tocFix, ...cruiseInteriorFixes, todFix, desMidFix];
  const todFixIndex = 3 + cruiseInteriorFixes.length; // indexul lui todFix în enrouteFixes

  const climbGs = Math.max(190, Math.round(cruiseGsKt * 0.68));
  const desHighGs = Math.max(240, Math.round(cruiseGsKt * 0.82));
  const desLowGs = 250;

  const enrouteSpeeds: number[] = [
    Math.max(155, Math.round(climbGs * 0.78)), // depFix -> initFix
    climbGs,                                   // initFix -> tocFix
    ...cruiseInteriorFixes.map(() => cruiseGsKt),
    cruiseGsKt,                                // ultimul punct croazieră -> todFix
    desHighGs,                                 // todFix -> desMidFix
    desLowGs,                                  // desMidFix -> iaf
  ];

  return {
    fixes: [...enrouteFixes, ...approachFixes],
    speeds: [...enrouteSpeeds, ...appSpeeds],
    todFixIndex,
  };
}

function extractTod(track: TrackPoint[], todIndex: number | null, landingRef: LatLon): TodMarkerInfo | null {
  if (todIndex == null || todIndex < 0 || todIndex >= track.length) return null;
  const pt = track[todIndex];
  return {
    lat: pt.latitudeDeg,
    lon: pt.longitudeDeg,
    altitudeFt: Math.round(metersToFeet(pt.altitudeMeters)),
    distanceToLandingNm: Math.round(distanceNm({ lat: pt.latitudeDeg, lon: pt.longitudeDeg }, landingRef) * 10) / 10,
    timeSeconds: pt.timeSeconds,
  };
}

function ifrApproachFixes(runway: RunwayId, iaf: IafId): PlannedFix[] {
  const route = arrivalRoute(runway, iaf);
  const thr = threshold(runway);
  let lastAlt = 6000;
  return route.map((f) => {
    const altitudeFt = f.id === thr.id ? thr.elevationFt : (f.altitudeFt ?? lastAlt);
    lastAlt = altitudeFt;
    return { id: f.id, lat: f.lat, lon: f.lon, altitudeFt };
  });
}

/** Viteze pe procedura RNP AIP (sub limitele publicate): 230 pe tranziție, 210 spre IF, 185 spre FAF, 140 pe final. */
function ifrApproachSpeeds(fixes: PlannedFix[]): number[] {
  return fixes.slice(1).map((to) => {
    if (to.id.startsWith('THR')) return 140;
    if (to.id === 'CV508' || to.id === 'CV408') return 185;
    if (to.id === 'OZZET' || to.id === 'NECCO') return 210;
    return 230;
  });
}

function selectVfrEntryForOrigin(origin: AirportInfo, fallbackIndex: number): NamedPoint {
  if (distanceNm(origin, ARP) < 3) return VFR_ENTRY_POINTS[fallbackIndex % VFR_ENTRY_POINTS.length];
  return [...VFR_ENTRY_POINTS].sort((a, b) => distanceNm(origin, a) - distanceNm(origin, b))[0];
}

function buildVfrOriginToEntryFixes(origin: AirportInfo, entryPoint: NamedPoint, cruiseAltFt: number): PlannedFix[] {
  const dep: PlannedFix = { id: origin.icao, lat: origin.lat, lon: origin.lon, altitudeFt: origin.elevationFt };
  const entry: PlannedFix = { ...entryPoint, altitudeFt: 1500 };
  const dist = distanceNm(origin, entryPoint);
  if (dist < 6) {
    const mid = greatCircleInterpolate(origin, entryPoint, 0.5);
    return [dep, { id: `${origin.icao}-CLB`, lat: mid.lat, lon: mid.lon, altitudeFt: 1300 }, entry];
  }
  const toc = greatCircleInterpolate(origin, entryPoint, Math.min(0.28, 4 / dist));
  const tod = greatCircleInterpolate(origin, entryPoint, Math.max(0.68, 1 - 5 / dist));
  const samples = greatCirclePoints(toc, tod, 25);
  const midFixes: PlannedFix[] = samples.map((pt, idx) => ({
    id: `${origin.icao}-VFR${idx}`,
    lat: pt.lat,
    lon: pt.lon,
    altitudeFt: cruiseAltFt,
  }));
  return [dep, ...midFixes, entry];
}

function buildVfrSpeeds(fixes: PlannedFix[], cruiseSpeedKt: number): number[] {
  return fixes.slice(1).map((_, idx) => (idx === 0 ? Math.max(50, Math.round(cruiseSpeedKt * 0.82)) : cruiseSpeedKt));
}

function polylineDistanceNm(points: LatLon[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += distanceNm(points[i - 1], points[i]);
  return sum;
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
