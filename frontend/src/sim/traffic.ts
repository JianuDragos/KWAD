// Leagă scenariul (aeronavele trimise) de rezultatul backendului și construiește ce desenează harta.
// Fiecare aeronavă primește traiectoria completă 4D: Decolare (aerodrom origine) → Climb →
// Croazieră ortodromică (Great-Circle) → Top of Descent (TOD) → IAF/Intrare VFR → Finală → Prag LRCV / Orbită + Rezoluție (Aterizare LRCV sau Deviere Alternativă).
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
export type VfrResolutionAction = 'wait_and_land_lrcv' | 'divert_alternate';

export interface TodMarkerInfo {
  lat: number;
  lon: number;
  altitudeFt: number;
  distanceToLandingNm: number;
  timeSeconds: number;
}

export interface VfrTacticalDecision {
  recommendedAction: VfrResolutionAction;
  effectiveAction: VfrResolutionAction;
  isOverridden: boolean;
  crosswindKnots: number;
  maxCrosswindKnots: number;
  pnrMinutes: number;
  willWeatherImproveWithinPnr: boolean;
  holdExitSeconds: number | null;
  estimatedLandingSeconds: number;
  assignedVfrRunway: RunwayId;
  alternate: (AlternateAerodrome & { point: LatLon }) | null;
  fuelAtAlternateMinutes: number | null;
  summaryReason: string;
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
  /** Segmentul de redirecționare din holding/intrare către aerodromul alternativ (dacă deviază). */
  diversionRoute: [number, number][] | null;
  /** Punctul Top of Descent (TOD) calculat pe rută, dacă există fază de croazieră. */
  todPoint: TodMarkerInfo | null;
  /** Momentul de decolare de pe aerodromul de origine (secunde față de 14:00). */
  takeoffSeconds: number;
  track: TrackPoint[];
  /** Momentul aterizării directe pe LRCV (slotul din backend sau ETA-ul direct). */
  landingSeconds: number | null;
  /** Momentul aterizării rezolvate (după așteptarea rândului pe LRCV sau pe aerodromul alternativ). */
  resolvedLandingSeconds: number | null;
  /** Analiza și decizia tactică a Asistentului pentru aeronavele VFR în condiții nefavorabile / aglomerare. */
  tacticalDecision: VfrTacticalDecision | null;
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

/** Identifică aeronavele VFR care sunt în așteptare pentru aterizare (în holding, nealocate sau în procedură de apropiere). */
export function getAwaitingVfrFlights(flights: FlightView[], simTimeSeconds?: number): FlightView[] {
  return flights.filter((f) => {
    if (f.aircraft.flightRules !== 'VFR') return false;
    if (simTimeSeconds !== undefined && f.resolvedLandingSeconds !== null) {
      if (simTimeSeconds >= f.resolvedLandingSeconds + 45) return false;
    }
    return (
      f.kind === 'hold' ||
      f.kind === 'approach' ||
      f.kind === 'divert' ||
      f.tacticalDecision !== null ||
      f.slot === null
    );
  });
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
  vfrOverrides: Record<string, VfrResolutionAction> = {},
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
  const baseEndSeconds = Math.ceil((Math.max(...anchors) + 600) / 60) * 60;

  // Calculăm ultimul moment de aterizare IFR aprobat pentru eșalonarea VFR după degajarea pistei
  const ifrLandingTimes = aircrafts
    .filter((a) => a.flightRules === 'IFR')
    .map((a) => {
      const adv = advisories.get(a.id);
      if (!adv || adv.advisoryStatus !== 'ClearedForApproach') return null;
      return adv.assignedLandingSlot?.calculatedTimeSeconds ?? a.etaSeconds;
    })
    .filter((t): t is number => t !== null);
  const lastIfrLandingSec = ifrLandingTimes.length > 0 ? Math.max(...ifrLandingTimes) : 0;

  let ifrIndex = 0;
  let vfrIndex = 0;
  let vfrWaitSlotOrder = 0;

  const flights = aircrafts.map((aircraft): FlightView => {
    const advisory = advisories.get(aircraft.id) ?? null;
    const slot = advisory?.assignedLandingSlot ?? null;
    const status: FlightView['status'] = advisory?.advisoryStatus ?? 'Necunoscut';
    const rawKind: FlightKind =
      status === 'HoldInOrbitRecommended' ? 'hold' : status === 'DivertRecommended' ? 'divert' : 'approach';
    const origin = resolveOriginAirport(aircraft, advisory);
    const isIfr = aircraft.flightRules === 'IFR';
    const base = { id: aircraft.id, callsign: aircraft.callsign, aircraft, advisory, status, slot, origin };

    if (isIfr) {
      const iaf = selectIafForOrigin(origin, ifrIndex++);
      const approachFixes = ifrApproachFixes(runway, iaf);
      const ttl = advisory?.takeoffToLanding;
      const cruiseAlt = ttl?.cruiseAltitudeFeet ?? (aircraft.category === 'RegionalTurboprop' ? 18000 : 34000);
      const cruiseGs = Math.max(
        180,
        ttl?.phases?.find((p) => p.phaseCode === 'CRZ')?.groundSpeedKnots ?? ttl?.cruiseTasKnots ?? 430,
      );

      if (rawKind === 'hold') {
        const ifIndex = approachFixes.findIndex((f) => f.id === 'OZZET' || f.id === 'NECCO');
        const toIf = approachFixes.slice(0, Math.max(1, ifIndex + 1));
        const { fixes, speeds, todFixIndex } = buildFullIfrChain(origin, toIf, cruiseAlt, cruiseGs);
        const holdAlt = advisory?.orbitAdvice?.recommendedAltitudeFeet ?? 4000;
        const holdFix = toIf[toIf.length - 1];
        let track = trackArrivingAt(fixes, speeds, aircraft.etaSeconds);
        const todPoint = extractTod(track, todFixIndex, holdFix);
        track = appendRacetrack(track, holdFix, runwayTrueBearing(runway), 'Right', holdAlt, 210, baseEndSeconds);
        const fullRoute = latLngs(fixes);
        const routeDistanceNm = Math.round(polylineDistanceNm(fixes));
        const holdLabel = `${origin.icao} → ${iaf} → hipodrom ${holdFix.id} (${feetLabel(holdAlt)})`;
        return {
          ...base,
          kind: 'hold',
          entryFixId: iaf,
          routeLabel: holdLabel,
          routeDistanceNm,
          traversedFirs: findTraversedFirs(fullRoute, firs),
          fullRoute,
          plannedRoute: fullRoute,
          diversionRoute: null,
          todPoint,
          takeoffSeconds: track[0]?.timeSeconds ?? 0,
          track,
          landingSeconds: null,
          resolvedLandingSeconds: null,
          tacticalDecision: null,
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
        kind: 'approach',
        entryFixId: iaf,
        routeLabel: `${origin.icao} → ${iaf} → RNP ${runway}`,
        routeDistanceNm,
        traversedFirs: findTraversedFirs(fullRoute, firs),
        fullRoute,
        plannedRoute: fullRoute,
        diversionRoute: null,
        todPoint,
        takeoffSeconds: track[0]?.timeSeconds ?? 0,
        track,
        landingSeconds,
        resolvedLandingSeconds: landingSeconds,
        tacticalDecision: null,
        alternate: null,
      };
    }

    // ---------- Zboruri VFR + Analiza Tactică a Asistentului (Așteptare Rând LRCV vs. Redirecționare Alternativă) ----------
    const entryPoint = selectVfrEntryForOrigin(origin, vfrIndex++);
    const speed = Math.max(55, aircraft.speedKnots ?? 90);
    const cruiseAlt = Math.max(1500, advisory?.takeoffToLanding?.cruiseAltitudeFeet ?? 2200);
    const vfrEnrouteFixes = buildVfrOriginToEntryFixes(origin, entryPoint, cruiseAlt);

    const vfrRunway = advisory?.assignedRunway ? runwayFromBackend(advisory.assignedRunway) : runway;
    const crosswindKt = Math.round((advisory?.currentCrosswindKnots ?? result.activeRunwayCrosswindKnots) * 10) / 10;
    const maxXw = aircraft.maxCrosswindKnots;
    const fuelMin = aircraft.remainingFuelMinutes ?? 75;
    const bestAlternate = pickAlternate(advisory?.recommendedAlternates ?? null);
    const altFlightMin = bestAlternate?.estimatedFlightMinutes ?? 8;
    const pnrMinutes =
      advisory?.vfrRedirection?.pointOfNoReturnMinutes ??
      Math.max(0, Math.round((fuelMin - (25 + altFlightMin + 5)) * 10) / 10);
    const willImprove =
      advisory?.vfrRedirection?.willWeatherImproveWithinPnr ??
      (result.futurePrediction?.horizons.some(
        (h) => h.horizonMinutes > 0 && h.horizonMinutes <= Math.max(15, pnrMinutes) && h.predictedCrosswindKnots <= maxXw,
      ) ??
        false);
    const fuelAtAlt =
      advisory?.vfrRedirection?.fuelRemainingAtAlternateMinutes ??
      (bestAlternate ? Math.max(0, Math.round((fuelMin - altFlightMin) * 10) / 10) : null);

    const canSafelyLandAfterWait = crosswindKt <= maxXw || (willImprove && pnrMinutes >= 12);
    const recommendedAction: VfrResolutionAction =
      status === 'DivertRecommended'
        ? 'divert_alternate'
        : canSafelyLandAfterWait || !bestAlternate
          ? 'wait_and_land_lrcv'
          : 'divert_alternate';

    const override = vfrOverrides[aircraft.id];
    const effectiveAction: VfrResolutionAction = override ?? recommendedAction;

    // Cazul 1: Aprobat direct pe LRCV și fără suprascriere manuală din partea controlorului
    if (rawKind === 'approach' && !override) {
      const join: PlannedFix = { ...vfrFinalJoin(vfrRunway), altitudeFt: 1000 };
      const thr = threshold(vfrRunway);
      const legs: PlannedFix[] = [...vfrEnrouteFixes, join, { ...thr, altitudeFt: thr.elevationFt }];
      const legSpeeds = [...buildVfrSpeeds(vfrEnrouteFixes, speed), speed, speed * 0.85];
      const landingSeconds = slot?.calculatedTimeSeconds ?? aircraft.etaSeconds;
      const arrivalTrack = trackArrivingAt(legs, legSpeeds, landingSeconds);
      const track = withRollout(arrivalTrack, vfrRunway);
      const fullRoute = latLngs(legs);

      // Dacă nu a primit slot (al 2-lea+ VFR), oferim analiza Asistentului ca opțiune de eșalonare după IFR
      const unsequencedConflict = !slot && ifrLandingTimes.length > 0;
      const tacticalDecision: VfrTacticalDecision | null = unsequencedConflict
        ? {
            recommendedAction: 'wait_and_land_lrcv',
            effectiveAction: 'wait_and_land_lrcv',
            isOverridden: false,
            crosswindKnots: crosswindKt,
            maxCrosswindKnots: maxXw,
            pnrMinutes,
            willWeatherImproveWithinPnr: true,
            holdExitSeconds: null,
            estimatedLandingSeconds: landingSeconds,
            assignedVfrRunway: vfrRunway,
            alternate: bestAlternate,
            fuelAtAlternateMinutes: fuelAtAlt,
            summaryReason: `Vânt lateral acceptabil (${crosswindKt} kt ≤ ${maxXw} kt), dar zborul nu are slot dedicat între sosirile IFR. Poate aștepta rândul în hipodromul Cârcea și ateriza după eliberarea pistei.`,
          }
        : null;

      return {
        ...base,
        kind: 'approach',
        entryFixId: entryPoint.id,
        routeLabel: `${origin.icao} → ${entryPoint.id} → final ${vfrRunway}`,
        routeDistanceNm: Math.max(1, Math.round(polylineDistanceNm(legs))),
        traversedFirs: findTraversedFirs(fullRoute, firs),
        fullRoute,
        plannedRoute: fullRoute,
        diversionRoute: null,
        todPoint: null,
        takeoffSeconds: track[0]?.timeSeconds ?? 0,
        track,
        landingSeconds,
        resolvedLandingSeconds: landingSeconds,
        tacticalDecision,
        alternate: null,
      };
    }

    // Cazul 2: Deviere directă din cauza combustibilului critic (fără suprascriere manuală)
    if (rawKind === 'divert' && !override) {
      const speeds = buildVfrSpeeds(vfrEnrouteFixes, speed);
      let track = trackArrivingAt(vfrEnrouteFixes, speeds, aircraft.etaSeconds - 300);
      const entryEnd = track[track.length - 1];
      if (bestAlternate) track = appendLeg(track, bestAlternate.point, 1000, speed);
      const altLandingSec = Math.round(track[track.length - 1]?.timeSeconds ?? aircraft.etaSeconds);
      const baseLatLngs = latLngs(vfrEnrouteFixes);
      const fullRoute: [number, number][] = bestAlternate
        ? [...baseLatLngs, [bestAlternate.point.lat, bestAlternate.point.lon]]
        : baseLatLngs;
      const diversionRoute: [number, number][] | null =
        bestAlternate && entryEnd
          ? [
              [entryEnd.latitudeDeg, entryEnd.longitudeDeg],
              [bestAlternate.point.lat, bestAlternate.point.lon],
            ]
          : null;

      return {
        ...base,
        kind: 'divert',
        entryFixId: entryPoint.id,
        routeLabel: `${origin.icao} → ${entryPoint.id} → deviere ${bestAlternate?.name ?? '?'}`,
        routeDistanceNm: Math.max(1, Math.round(polylineDistanceNm(vfrEnrouteFixes))),
        traversedFirs: findTraversedFirs(fullRoute, firs),
        fullRoute,
        plannedRoute: fullRoute,
        diversionRoute,
        todPoint: null,
        takeoffSeconds: track[0]?.timeSeconds ?? 0,
        track,
        landingSeconds: null,
        resolvedLandingSeconds: altLandingSec,
        tacticalDecision: {
          recommendedAction: 'divert_alternate',
          effectiveAction: 'divert_alternate',
          isOverridden: false,
          crosswindKnots: crosswindKt,
          maxCrosswindKnots: maxXw,
          pnrMinutes,
          willWeatherImproveWithinPnr: willImprove,
          holdExitSeconds: entryEnd ? Math.round(entryEnd.timeSeconds) : null,
          estimatedLandingSeconds: altLandingSec,
          assignedVfrRunway: vfrRunway,
          alternate: bestAlternate,
          fuelAtAlternateMinutes: fuelAtAlt,
          summaryReason: `Rezervă combustibil critică (${fuelMin} min, PNR ${pnrMinutes} min) și vânt lateral ${crosswindKt} kt > ${maxXw} kt pe LRCV — redirecționare imediată către ${bestAlternate?.name ?? 'alternativă'} (${bestAlternate?.bestRunway ?? ''}).`,
        },
        alternate: bestAlternate,
      };
    }

    // Cazul 3: Rezoluția tactică din așteptare (fără buclă infinită!):
    // Asistentul evaluează dacă aeronava (A) își așteaptă rândul și aterizează pe LRCV sau (B) iese după 1 orbită spre aerodromul alternativ!
    const speeds = buildVfrSpeeds(vfrEnrouteFixes, speed);
    const entryArrivalSec = aircraft.etaSeconds - 300;
    let track = trackArrivingAt(vfrEnrouteFixes, speeds, entryArrivalSec);
    const center = destination(ARP, 180, 2.5); // zona de așteptare VFR Cârcea – Pielești
    const holdAlt = advisory?.orbitAdvice?.recommendedAltitudeFeet ?? 1500;

    if (effectiveAction === 'wait_and_land_lrcv' || !bestAlternate) {
      const join: PlannedFix = { ...vfrFinalJoin(vfrRunway), altitudeFt: 1000 };
      const thr = threshold(vfrRunway);
      const postHoldFlightSec =
        (distanceNm(center, join) / speed + distanceNm(join, thr) / (speed * 0.85)) * 3600;
      const desiredTouchdownSec = Math.max(
        aircraft.etaSeconds + 240,
        lastIfrLandingSec + 180 + vfrWaitSlotOrder * 150,
      );
      vfrWaitSlotOrder++;

      const holdUntilSec = Math.max(entryArrivalSec + 160, desiredTouchdownSec - postHoldFlightSec);
      track = appendRacetrack(track, center, runwayTrueBearing(vfrRunway), 'Right', holdAlt, speed, holdUntilSec);
      const holdExitSec = Math.round(track[track.length - 1].timeSeconds);

      track = appendLeg(track, join, 1000, speed);
      track = appendLeg(track, thr, thr.elevationFt, speed * 0.85);
      const resolvedLandingSec = Math.round(track[track.length - 1].timeSeconds);
      track = withRollout(track, vfrRunway);

      const fullRoute: [number, number][] = [
        ...latLngs(vfrEnrouteFixes),
        [center.lat, center.lon],
        [join.lat, join.lon],
        [thr.lat, thr.lon],
      ];

      const summaryReason =
        crosswindKt <= maxXw
          ? `Vântul lateral (${crosswindKt} kt ≤ ${maxXw} kt) permite aterizarea pe LRCV RWY ${vfrRunway}; aeronava așteaptă rândul în hipodromul Cârcea (${holdAlt} ft) și aterizează după degajarea traficului IFR.`
          : willImprove
            ? `Prognoza Nowcasting indică scăderea vântului sub limita de ${maxXw} kt înainte de PNR (${pnrMinutes} min); așteptare în hipodromul Cârcea urmată de aterizare pe LRCV RWY ${vfrRunway}.`
            : `Suprascriere controlor: așteptare rând în hipodromul Cârcea urmată de aterizare pe LRCV RWY ${vfrRunway} (atenție: vânt lateral ${crosswindKt} kt peste limita de ${maxXw} kt).`;

      return {
        ...base,
        kind: 'hold',
        entryFixId: entryPoint.id,
        routeLabel: `${origin.icao} → ${entryPoint.id} → așteptare Cârcea → RWY ${vfrRunway}`,
        routeDistanceNm: Math.max(1, Math.round(polylineDistanceNm(vfrEnrouteFixes) + distanceNm(center, thr))),
        traversedFirs: findTraversedFirs(fullRoute, firs),
        fullRoute,
        plannedRoute: fullRoute,
        diversionRoute: null,
        todPoint: null,
        takeoffSeconds: track[0]?.timeSeconds ?? 0,
        track,
        landingSeconds: null,
        resolvedLandingSeconds: resolvedLandingSec,
        tacticalDecision: {
          recommendedAction,
          effectiveAction: 'wait_and_land_lrcv',
          isOverridden: !!override && override !== recommendedAction,
          crosswindKnots: crosswindKt,
          maxCrosswindKnots: maxXw,
          pnrMinutes,
          willWeatherImproveWithinPnr: willImprove,
          holdExitSeconds: holdExitSec,
          estimatedLandingSeconds: resolvedLandingSec,
          assignedVfrRunway: vfrRunway,
          alternate: bestAlternate,
          fuelAtAlternateMinutes: fuelAtAlt,
          summaryReason,
        },
        alternate: null,
      };
    }

    // Subcazul 3B: După 1 orbită tactică de analiză la Cârcea, aeronava iese pe ruta de redirecționare către aerodromul alternativ optim!
    track = appendRacetrack(track, center, runwayTrueBearing(vfrRunway), 'Right', holdAlt, speed, entryArrivalSec + 160);
    const holdExitPt = track[track.length - 1];
    const holdExitSec = Math.round(holdExitPt.timeSeconds);
    track = appendLeg(track, bestAlternate.point, 900, speed);
    const altLandingSec = Math.round(track[track.length - 1].timeSeconds);

    const diversionRoute: [number, number][] = [
      [holdExitPt.latitudeDeg, holdExitPt.longitudeDeg],
      [bestAlternate.point.lat, bestAlternate.point.lon],
    ];
    const fullRoute: [number, number][] = [
      ...latLngs(vfrEnrouteFixes),
      [center.lat, center.lon],
      [holdExitPt.latitudeDeg, holdExitPt.longitudeDeg],
      [bestAlternate.point.lat, bestAlternate.point.lon],
    ];

    const summaryReason =
      crosswindKt > maxXw
        ? `Vântul lateral pe LRCV (${crosswindKt} kt) depășește plafonul ${aircraft.modelName} (${maxXw} kt) și nu scade sub limită până la PNR (${pnrMinutes} min). După 1 orbită de evaluare la Cârcea, redirecționare către ${bestAlternate.name} (${bestAlternate.bestRunway}, lateral ${bestAlternate.calculatedCrosswindKnots} kt).`
        : `Redirecționare tactică spre ${bestAlternate.name} (${bestAlternate.bestRunway}, lateral ${bestAlternate.calculatedCrosswindKnots} kt) pentru decongestionarea pistei LRCV.`;

    return {
      ...base,
      kind: 'divert',
      entryFixId: entryPoint.id,
      routeLabel: `${origin.icao} → ${entryPoint.id} → Cârcea → deviere ${bestAlternate.name}`,
      routeDistanceNm: Math.max(
        1,
        Math.round(polylineDistanceNm(vfrEnrouteFixes) + distanceNm(center, bestAlternate.point)),
      ),
      traversedFirs: findTraversedFirs(fullRoute, firs),
      fullRoute,
      plannedRoute: fullRoute,
      diversionRoute,
      todPoint: null,
      takeoffSeconds: track[0]?.timeSeconds ?? 0,
      track,
      landingSeconds: null,
      resolvedLandingSeconds: altLandingSec,
      tacticalDecision: {
        recommendedAction,
        effectiveAction: 'divert_alternate',
        isOverridden: !!override && override !== recommendedAction,
        crosswindKnots: crosswindKt,
        maxCrosswindKnots: maxXw,
        pnrMinutes,
        willWeatherImproveWithinPnr: willImprove,
        holdExitSeconds: holdExitSec,
        estimatedLandingSeconds: altLandingSec,
        assignedVfrRunway: vfrRunway,
        alternate: bestAlternate,
        fuelAtAlternateMinutes: fuelAtAlt,
        summaryReason,
      },
      alternate: bestAlternate,
    };
  });

  const missionStartSeconds = Math.floor(Math.min(...flights.map((f) => f.takeoffSeconds)) / 60) * 60;
  const minAnchor = Math.min(...anchors);
  const startSeconds = Math.max(missionStartSeconds, Math.floor((minAnchor - APPROACH_LEAD_SECONDS) / 60) * 60);
  const maxResolvedEnd = Math.max(
    0,
    ...flights.map((f) => f.resolvedLandingSeconds ?? 0),
  );
  const endSeconds = Math.max(baseEndSeconds, Math.ceil((maxResolvedEnd + 120) / 60) * 60);

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
  // Singurul aerodrom al Craiovei este Aerodromul Balta Verde (LRCW), administrat de Aeroclubul României; folosim coordonatele oficiale LRCW.
  const isBaltaVerde =
    best.code === 'LRCW' ||
    best.code === 'LRBV' ||
    best.code === 'PODARI' ||
    /balta verde|craiova-sud|podari/i.test(best.name);
  const point = isBaltaVerde ? LRCW : destination(ARP, best.bearingDegrees, best.distanceKm / 1.852);
  return { ...best, code: isBaltaVerde ? 'LRCW' : best.code, point };
}

function latLngs(points: LatLon[]): [number, number][] {
  return points.map((p) => [p.lat, p.lon]);
}
