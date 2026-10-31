// Port TypeScript al backendului KWAD (commit ad6e098), folosit doar în modul mock (npm run dev:mock),
// când serverul .NET nu rulează. Reproduce intenționat și comportamentele cunoscute ale backendului
// (de ex. doar primul VFR este secvențiat), ca UI-ul să fie construit pe ce trimite serverul real.
// NU este sursa adevărului pentru calcule: sursa este backendul.
import type {
  AircraftAdvisory,
  AircraftInput,
  AlternateAerodrome,
  CraiovaAircraft,
  CraiovaSimulationResult,
  EvaluationVariant,
  FutureHorizonSnapshot,
  FuturePredictionSummary,
  LiveTrafficResponse,
  PlanningResponse,
  ScenarioRules,
  ScheduleSlot,
  TakeoffToLandingAnalysis,
  TrafficPresetId,
  TwoStepsAheadPrediction,
  VfrRedirectionAnalysis,
  WeatherCondition,
} from '../contracts/backend';
import { resolveOriginAirport } from '../data/airports';
import { ARP } from '../data/geo';
import { distanceNm } from '../sim/geomath';
import { clockLabel } from '../sim/units';

/** Math.Round din .NET rotunjește la par la jumătate (MidpointRounding.ToEven). */
function roundEven(value: number, decimals = 0): number {
  const f = 10 ** decimals;
  const x = value * f;
  const r = Math.round(x);
  const isHalf = Math.abs(x % 1) === 0.5;
  return (isHalf && r % 2 !== 0 ? r - 1 : r) / f;
}

// ---------- CrosswindCalculator ----------

export function crosswind(windDir: number, windSpeed: number, runwayHeading: number) {
  let diff = (windDir - runwayHeading) % 360;
  if (diff < -180) diff += 360;
  if (diff > 180) diff -= 360;
  const rad = (diff * Math.PI) / 180;
  return {
    crosswindKnots: roundEven(Math.abs(windSpeed * Math.sin(rad)), 1),
    headwindKnots: roundEven(windSpeed * Math.cos(rad), 1),
  };
}

function activeRunwayCraiova(windDir: number, windSpeed: number) {
  const r08 = crosswind(windDir, windSpeed, 88.93);
  const r26 = crosswind(windDir, windSpeed, 268.95);
  return r26.headwindKnots >= r08.headwindKnots ? { id: '26', heading: 268.95, ...r26 } : { id: '08', heading: 88.93, ...r08 };
}

function windTriangle(courseDeg: number, tasKt: number, windDirDeg: number, windSpeedKt: number) {
  const tas = Math.max(40, tasKt);
  let diff = (windDirDeg - courseDeg) % 360;
  if (diff < -180) diff += 360;
  if (diff > 180) diff -= 360;
  const rad = (diff * Math.PI) / 180;
  const xw = windSpeedKt * Math.sin(rad);
  const hw = windSpeedKt * Math.cos(rad);
  const sinWca = Math.max(-0.85, Math.min(0.85, xw / tas));
  const wcaRad = Math.asin(sinWca);
  const wcaDeg = roundEven((wcaRad * 180) / Math.PI, 1);
  const hdgDeg = roundEven((courseDeg + wcaDeg + 360) % 360, 1);
  const gsKt = roundEven(Math.max(25, tas * Math.cos(wcaRad) - hw), 1);
  return { wcaDeg, hdgDeg, gsKt, xwKt: roundEven(Math.abs(xw), 1), hwKt: roundEven(hw, 1) };
}

// ---------- Planning engine ----------

function validate(aircrafts: AircraftInput[]): string | null {
  if (aircrafts.length === 0) return 'Lista de aeronave este goală.';
  if (new Set(aircrafts.map((a) => a.id)).size !== aircrafts.length) return 'Existență ID-uri duplicate în lista de aeronave.';
  for (const ac of aircrafts) {
    if (ac.earliestSeconds > ac.latestSeconds)
      return `Aeronava ${ac.id} are EarliestSeconds (${ac.earliestSeconds}s) > LatestSeconds (${ac.latestSeconds}s).`;
    const f = ac.frozenTimeSeconds;
    if (f != null && (f < ac.earliestSeconds || f > ac.latestSeconds))
      return `Timpul blocat (${f}s) pentru ${ac.id} este în afara ferestrei permise.`;
  }
  return null;
}

function variant(seq: AircraftInput[], schedule: ScheduleSlot[], rejectionReason: string | null): EvaluationVariant {
  const valid = rejectionReason === null;
  const total = valid ? schedule.reduce((s, x) => s + x.delaySeconds, 0) : 0;
  const max = valid && schedule.length ? Math.max(...schedule.map((x) => x.delaySeconds)) : 0;
  return {
    sequenceOrder: seq.map((a) => a.id),
    schedule,
    isValid: valid,
    rejectionReason,
    totalDelaySeconds: total,
    totalDelayMinutes: roundEven(total / 60, 2),
    maxDelaySeconds: max,
    maxDelayMinutes: roundEven(max / 60, 2),
    delayedAircraftCount: valid ? schedule.filter((x) => x.delaySeconds > 0).length : 0,
  };
}

function calculate(seq: AircraftInput[], rules: Required<ScenarioRules>): EvaluationVariant {
  const schedule: ScheduleSlot[] = [];
  let previous = 0;
  for (let i = 0; i < seq.length; i++) {
    const ac = seq[i];
    let t: number;
    if (ac.frozenTimeSeconds != null) {
      t = ac.frozenTimeSeconds;
      if (t < ac.earliestSeconds || t > ac.latestSeconds)
        return variant(seq, schedule, `Aeronava ${ac.id} (timp blocat ${t}s) este în afara limitelor [${ac.earliestSeconds}s, ${ac.latestSeconds}s].`);
      if (i > 0 && t - previous < rules.minimumGapSeconds)
        return variant(seq, schedule, `Aeronava ${ac.id} încalcă intervalul minim de ${rules.minimumGapSeconds}s față de ${previous}s.`);
    } else {
      const min = Math.max(ac.earliestSeconds, ac.etaSeconds);
      t = i === 0 ? min : Math.max(min, previous + rules.minimumGapSeconds);
      if (t > ac.latestSeconds)
        return variant(seq, schedule, `Aeronava ${ac.id} depășește limita maximă permisă (${ac.latestSeconds}s). Calculat: ${t}s.`);
    }
    const delay = Math.max(0, t - ac.etaSeconds);
    schedule.push({
      aircraftId: ac.id,
      flightRules: ac.flightRules,
      calculatedTimeSeconds: t,
      delaySeconds: delay,
      formattedTime: clockLabel(t + rules.baseTimeOffsetSeconds, false),
      delayMinutes: roundEven(delay / 60, 2),
    });
    previous = t;
  }
  return variant(seq, schedule, null);
}

export function evaluatePlanning(aircrafts: AircraftInput[], rulesIn: ScenarioRules): PlanningResponse {
  const rules: Required<ScenarioRules> = { allowVfr: true, baseTimeOffsetSeconds: 50400, ...rulesIn };
  const error = validate(aircrafts);
  if (error) throw new MockBadRequest(error);
  if (aircrafts.some((a) => a.flightRules === 'VFR') && !rules.allowVfr) {
    return {
      validVariants: [],
      rejectedVariants: [{ ...variant(aircrafts, [], 'Zborurile VFR sunt neeligibile în scenariu.') }],
      totalEvaluatedVariants: 1,
    };
  }
  const ifr = aircrafts.filter((a) => a.flightRules === 'IFR');
  const vfr = aircrafts.filter((a) => a.flightRules === 'VFR');
  // Ca în SequenceGenerator.cs: se inserează doar PRIMUL VFR; celelalte VFR nu apar în nicio variantă.
  const candidates = vfr.length === 0 ? [ifr] : Array.from({ length: ifr.length + 1 }, (_, i) => [...ifr.slice(0, i), vfr[0], ...ifr.slice(i)]);
  const all = candidates.map((c) => calculate(c, rules));
  const valid = all
    .filter((v) => v.isValid)
    .sort(
      (a, b) =>
        a.totalDelaySeconds - b.totalDelaySeconds ||
        a.maxDelaySeconds - b.maxDelaySeconds ||
        ordinalCompare(a.sequenceOrder.join('-'), b.sequenceOrder.join('-')),
    )
    .slice(0, 3);
  return { validVariants: valid, rejectedVariants: all.filter((v) => !v.isValid), totalEvaluatedVariants: all.length };
}

function ordinalCompare(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class MockBadRequest extends Error {}

// ---------- OpenSkyService (doar traficul simulat) ----------

function light(base: number): CraiovaAircraft[] {
  return [
    { id: 'YR-SAV', callsign: 'YR-5123', modelName: 'ICP Savannah S (Ultralight STOL)', category: 'UltralightAndGlider', flightRules: 'VFR', hasInstrumentAvionics: false, maxCrosswindKnots: 11, etaSeconds: base, earliestSeconds: Math.max(0, base - 60), latestSeconds: base + 300, frozenTimeSeconds: null, speedKnots: 65, remainingFuelMinutes: 75, departureIcao: 'PODARI' },
    { id: 'YR-WILG', callsign: 'YR-WLG', modelName: 'PZL-104 Wilga 35A (STOL)', category: 'UltralightAndGlider', flightRules: 'VFR', hasInstrumentAvionics: false, maxCrosswindKnots: 13, etaSeconds: base + 180, earliestSeconds: base + 120, latestSeconds: base + 480, frozenTimeSeconds: null, speedKnots: 75, remainingFuelMinutes: 80, departureIcao: 'LRCW' },
    { id: 'YR-C172', callsign: 'YR-CRA', modelName: 'Cessna 172N Skyhawk', category: 'GeneralAviation', flightRules: 'VFR', hasInstrumentAvionics: true, maxCrosswindKnots: 15, etaSeconds: base + 360, earliestSeconds: base + 300, latestSeconds: base + 660, frozenTimeSeconds: null, speedKnots: 95, remainingFuelMinutes: 90, departureIcao: 'LRBS' },
  ];
}

export function realisticCraiovaTraffic(): CraiovaAircraft[] {
  return [
    { id: 'W4-3751', callsign: 'WZZ3751', modelName: 'Airbus A320-232', category: 'CommercialJet', flightRules: 'IFR', hasInstrumentAvionics: true, maxCrosswindKnots: 33, etaSeconds: 0, earliestSeconds: 0, latestSeconds: 240, frozenTimeSeconds: null, speedKnots: 145, remainingFuelMinutes: 110, departureIcao: 'EGGW' },
    { id: 'W4-3762', callsign: 'WZZ3762', modelName: 'Airbus A321neo', category: 'CommercialJet', flightRules: 'IFR', hasInstrumentAvionics: true, maxCrosswindKnots: 35, etaSeconds: 360, earliestSeconds: 300, latestSeconds: 720, frozenTimeSeconds: null, speedKnots: 150, remainingFuelMinutes: 125, departureIcao: 'LIME' },
    ...light(120),
  ];
}

export function eurasiaLongHaulTraffic(): CraiovaAircraft[] {
  return [
    { id: 'W4-3751', callsign: 'WZZ3751', modelName: 'Airbus A320-232', category: 'CommercialJet', flightRules: 'IFR', hasInstrumentAvionics: true, maxCrosswindKnots: 33, etaSeconds: 0, earliestSeconds: 0, latestSeconds: 240, frozenTimeSeconds: null, speedKnots: 145, remainingFuelMinutes: 110, departureIcao: 'EGGW' },
    { id: 'CA-841', callsign: 'CCA841', modelName: 'Airbus A330-343 (Long-Haul)', category: 'CommercialJet', flightRules: 'IFR', hasInstrumentAvionics: true, maxCrosswindKnots: 36, etaSeconds: 210, earliestSeconds: 150, latestSeconds: 600, frozenTimeSeconds: null, speedKnots: 148, remainingFuelMinutes: 135, departureIcao: 'ZBAA' },
    { id: 'W4-3762', callsign: 'WZZ3762', modelName: 'Airbus A321neo', category: 'CommercialJet', flightRules: 'IFR', hasInstrumentAvionics: true, maxCrosswindKnots: 35, etaSeconds: 420, earliestSeconds: 360, latestSeconds: 780, frozenTimeSeconds: null, speedKnots: 150, remainingFuelMinutes: 125, departureIcao: 'LIME' },
    { id: 'RO-204', callsign: 'ROT204', modelName: 'ATR 72-600', category: 'RegionalTurboprop', flightRules: 'IFR', hasInstrumentAvionics: true, maxCrosswindKnots: 28, etaSeconds: 600, earliestSeconds: 540, latestSeconds: 900, frozenTimeSeconds: null, speedKnots: 125, remainingFuelMinutes: 95, departureIcao: 'LROP' },
    ...light(180),
  ];
}

export function liveTraffic(preset: TrafficPresetId = 'default'): LiveTrafficResponse {
  const traffic = preset === 'eurasia' ? eurasiaLongHaulTraffic() : realisticCraiovaTraffic();
  const source =
    preset === 'eurasia'
      ? 'Scenariu Eurasia Long-Haul (Beijing ZBAA / Londra EGGW / Milano LIME / Otopeni LROP → LRCV)'
      : 'Trafic simulat realist (OpenSky bypass / mod demonstrativ)';
  return { source, count: traffic.length, traffic };
}

// ---------- CraiovaAdvisoryEngine ----------

export function alternates(weather: WeatherCondition, cruiseSpeed = 70, maxAllowedXw = 12): AlternateAerodrome[] {
  const speed = cruiseSpeed <= 0 ? 70 : cruiseSpeed;
  const wind = Math.max(weather.windSpeedKnots, weather.windGustKnots);
  const field = (name: string, code: string, km: number, brg: number, rwyA: [number, string], rwyB: [number, string], lenM: number, reason: (rwy: string, cross: number, minutes: number) => string): AlternateAerodrome => {
    const a = crosswind(weather.windDirectionDegrees, wind, rwyA[0]);
    const b = crosswind(weather.windDirectionDegrees, wind, rwyB[0]);
    const useB = b.headwindKnots >= a.headwindKnots;
    const best = useB ? b : a;
    const label = useB ? rwyB[1] : rwyA[1];
    const wt = windTriangle(brg, speed, weather.windDirectionDegrees, weather.windSpeedKnots);
    const minutes = roundEven((km / (speed * 1.852)) * 60, 1);
    const ldrM = roundEven(175 * (1 - best.headwindKnots / 130) * 1.15, 0);
    const xwRatio = best.crosswindKnots / Math.max(8, maxAllowedXw);
    const sXw = xwRatio <= 1 ? 100 * (1 - 0.35 * xwRatio) : Math.max(0, 35 - (xwRatio - 1) * 70);
    const sHw = best.headwindKnots >= 0 ? Math.min(100, 70 + best.headwindKnots * 1.5) : Math.max(0, 70 + best.headwindKnots * 10);
    const sDist = Math.max(25, 100 - km * 1.1);
    const sLdr = Math.min(100, ((lenM - ldrM) / lenM) * 125);
    const score = roundEven(0.55 * sXw + 0.2 * sHw + 0.15 * sDist + 0.1 * sLdr, 1);
    return {
      name,
      code,
      distanceKm: km,
      bearingDegrees: brg,
      runwayHeadingDegrees: useB ? rwyB[0] : rwyA[0],
      bestRunway: label,
      calculatedCrosswindKnots: best.crosswindKnots,
      calculatedHeadwindKnots: best.headwindKnots,
      estimatedFlightMinutes: minutes,
      suitabilityReason: reason(label, best.crosswindKnots, minutes),
      windCorrectedHeadingDegrees: wt.hdgDeg,
      landingDistanceRequiredMeters: ldrM,
      safetyScore: score,
      isRecommendedBestSpot: false,
    };
  };
  const list = [
    field('Aerodromul Balta Verde Craiova', 'LRBV', 11.8, 245, [130, '13 (130°)'], [310, '31 (310°)'], 600, (r, c) => `Pistă înierbată 600m. La vânt din ${weather.windDirectionDegrees}°, vântul lateral pe pista ${r} este de ${c} kts (mult redus față de Craiova).`),
    field('Aerodrom Podari (ULM Field)', 'PODARI', 14.5, 225, [20, '02 (020°)'], [200, '20 (200°)'], 500, (r, c) => `Teren dedicat ULM/Savannah. Pista ${r} este orientată aproape pe axul vântului de sud, oferind un vânt lateral minim de doar ${c} kts.`),
    field('Aerodrom Slatina', 'SLATINA', 46.0, 75, [80, '08 (080°)'], [260, '26 (260°)'], 700, (_r, _c, m) => `Aerodrom de rezervă estic la ${m} minute zbor.`),
  ];
  const bestIdx = list.reduce((best, cur, idx) => ((cur.safetyScore ?? 0) > (list[best].safetyScore ?? 0) ? idx : best), 0);
  list[bestIdx].isRecommendedBestSpot = true;
  return list;
}

function buildMockMathForAircraft(
  ac: CraiovaAircraft,
  weather: WeatherCondition,
  rwyId: string,
  rwyHeading: number,
  xw: number,
  hw: number,
  status: AircraftAdvisory['advisoryStatus'],
  slot: ScheduleSlot | null,
  alts: AlternateAerodrome[] | null,
): {
  takeoffToLanding: TakeoffToLandingAnalysis;
  twoStepsAhead: TwoStepsAheadPrediction;
  vfrRedirection: VfrRedirectionAnalysis | null;
} {
  const origin = resolveOriginAirport(ac, null);
  const routeNm = Math.max(8, roundEven(distanceNm(origin, ARP), 0));
  const isJet = ac.category === 'CommercialJet' || ac.category === 'RegionalTurboprop';
  const isTurboprop = ac.category === 'RegionalTurboprop';
  const cruiseAlt = isTurboprop ? 18000 : isJet ? (routeNm > 2000 ? 37000 : 34000) : 2500;
  const cruiseTas = isTurboprop ? 275 : isJet ? (routeNm > 2000 ? 470 : 445) : (ac.speedKnots ?? 90);
  const vApp = isTurboprop ? 120 : isJet ? 140 : Math.max(55, (ac.speedKnots ?? 80) * 0.82);
  const vTouch = roundEven(vApp * 0.92, 1);
  const wt = windTriangle(rwyHeading, vApp, weather.windDirectionDegrees, Math.max(weather.windSpeedKnots, weather.windGustKnots));
  const rodFpm = roundEven(wt.gsKt * 101.2686 * Math.tan((3 * Math.PI) / 180), 0);
  const todNm = roundEven(Math.min(routeNm * 0.45, ((cruiseAlt - 626) / 1000) * 3.18), 1);
  const baseLdr = isTurboprop ? 1090 : isJet ? 1480 : ac.category === 'UltralightAndGlider' ? 185 : 390;
  const ldrM = roundEven(baseLdr * Math.pow(Math.max(35, vTouch - hw * 0.5) / vTouch, 2) * 1.15, 0);
  const rotSec = isJet ? 52 : 34;

  const targetSec = slot?.calculatedTimeSeconds ?? ac.etaSeconds;
  const step0Sec = targetSec - 540;
  const step1Sec = targetSec - 210;
  const step2Sec = targetSec;

  const fmt = (sec: number) => clockLabel(50400 + sec, false);
  const bestAlt = alts ? [...alts].sort((a, b) => (b.safetyScore ?? 0) - (a.safetyScore ?? 0))[0] : null;

  const step1Fix = isJet
    ? rwyId === '26' ? 'OZZET (IF RWY 26)' : 'NECCO (IF RWY 08)'
    : status === 'HoldInOrbitRecommended' ? 'Orbită Sud Cârcea (VFR Hold)' : status === 'DivertRecommended' ? `Traseu deviere → ${bestAlt?.code ?? 'PODARI'}` : `Aliniere Finală 3 NM RWY ${rwyId}`;
  const step2Fix = status === 'ClearedForApproach'
    ? `THR RWY ${rwyId} (Touchdown)`
    : status === 'HoldInOrbitRecommended' ? (isJet ? 'Holding VOR CRA (4000 ft)' : 'Ieșire Orbită / Reevaluare Meteo') : `${bestAlt?.name ?? 'Podari'} (Pistă ${bestAlt?.bestRunway ?? '20'})`;

  const cruiseDistNm = roundEven(Math.max(2, routeNm - todNm - 15), 1);
  const cruiseGs = Math.max(45, roundEven(cruiseTas - hw * 0.8, 0));
  const cruiseMin = roundEven((cruiseDistNm / cruiseGs) * 60, 1);

  const takeoffToLanding: TakeoffToLandingAnalysis = {
    departureAerodromeIcao: origin.icao,
    departureAerodromeName: `${origin.name} (${origin.city})`,
    departureLatitude: origin.lat,
    departureLongitude: origin.lon,
    totalRouteDistanceNm: routeNm,
    cruiseAltitudeFeet: cruiseAlt,
    cruiseTasKnots: cruiseTas,
    windDirectionAtAltitudeDegrees: (weather.windDirectionDegrees + 12) % 360,
    windSpeedAtAltitudeKnots: roundEven(weather.windSpeedKnots * 1.35, 1),
    windCorrectionAngleCrabDegrees: wt.wcaDeg,
    headingToFlyDegrees: wt.hdgDeg,
    groundSpeedApproachKnots: wt.gsKt,
    topOfDescentDistanceNm: todNm,
    optimalGlidepathDegrees: 3.0,
    requiredRateOfDescentFpm: rodFpm,
    stabilizationGateAltitudeFeetAmsl: isJet ? 1626 : 1126,
    specificTotalEnergyFeet: roundEven(626 + (wt.gsKt * wt.gsKt) / 21.6, 0),
    approachSpeedVappKnots: roundEven(vApp, 1),
    thresholdSpeedVrefKnots: vTouch,
    touchdownGroundSpeedKnots: roundEven(Math.max(35, wt.gsKt - 8), 1),
    landingDistanceRequiredMeters: ldrM,
    landingDistanceAvailableMeters: 2500,
    runwaySafetyMarginMeters: 2500 - ldrM,
    runwayUsedPercent: roundEven((ldrM / 2500) * 100, 1),
    predictedRunwayOccupancySeconds: rotSec,
    phases: [
      { phaseOrder: 1, phaseCode: 'TOF', phaseName: '1. Takeoff & Initial Climb', startAltitudeFeet: origin.elevationFt, endAltitudeFeet: Math.max(1500, origin.elevationFt + 1000), trueAirspeedKnots: roundEven(vApp * 1.1, 0), groundSpeedKnots: roundEven(vApp * 1.1, 0), distanceNm: 4.5, durationMinutes: 2.5, verticalRateFpm: isJet ? 2400 : 650, fuelBurnedMinutesEquivalent: 3.2, keyMathNote: `Decolare ${origin.icao}` },
      { phaseOrder: 2, phaseCode: 'CRZ', phaseName: '2. Enroute Cruise', startAltitudeFeet: cruiseAlt, endAltitudeFeet: cruiseAlt, trueAirspeedKnots: cruiseTas, groundSpeedKnots: cruiseGs, distanceNm: cruiseDistNm, durationMinutes: cruiseMin, verticalRateFpm: 0, fuelBurnedMinutesEquivalent: cruiseMin, keyMathNote: `Croazieră stabilizată ${cruiseAlt} ft` },
      { phaseOrder: 3, phaseCode: 'TOD', phaseName: '3. Top of Descent (TOD)', startAltitudeFeet: cruiseAlt, endAltitudeFeet: isJet ? 4000 : 1500, trueAirspeedKnots: roundEven(cruiseTas * 0.9, 0), groundSpeedKnots: Math.max(45, roundEven(cruiseTas * 0.9 - hw, 0)), distanceNm: todNm, durationMinutes: roundEven((todNm / Math.max(60, cruiseTas * 0.78)) * 60, 1), verticalRateFpm: isJet ? -1800 : -500, fuelBurnedMinutesEquivalent: 8.5, keyMathNote: `Profil 3.0° inițiat la ${todNm} NM` },
      { phaseOrder: 4, phaseCode: 'IAF', phaseName: '4. TMA / Initial Approach (IAF/IF)', startAltitudeFeet: isJet ? 4000 : 1500, endAltitudeFeet: isJet ? 2300 : 1100, trueAirspeedKnots: isJet ? 210 : cruiseTas, groundSpeedKnots: isJet ? 202 : wt.gsKt, distanceNm: 5.6, durationMinutes: 2.2, verticalRateFpm: -rodFpm, fuelBurnedMinutesEquivalent: 2.0, keyMathNote: 'Configurare flaps' },
      { phaseOrder: 5, phaseCode: 'FAF', phaseName: '5. Final Approach (FAF 3.0°)', startAltitudeFeet: isJet ? 2300 : 1100, endAltitudeFeet: 626, trueAirspeedKnots: roundEven(vApp, 0), groundSpeedKnots: wt.gsKt, distanceNm: 4.9, durationMinutes: 2.1, verticalRateFpm: -rodFpm, fuelBurnedMinutesEquivalent: 1.9, keyMathNote: `Derivă vânt WCA ${wt.wcaDeg >= 0 ? '+' : ''}${wt.wcaDeg}° | ROD -${rodFpm} fpm` },
      { phaseOrder: 6, phaseCode: 'LDG', phaseName: '6. Touchdown & Rollout', startAltitudeFeet: 626, endAltitudeFeet: 626, trueAirspeedKnots: vTouch, groundSpeedKnots: roundEven(Math.max(35, wt.gsKt - 10), 0), distanceNm: roundEven(ldrM / 1852, 2), durationMinutes: roundEven(rotSec / 60, 2), verticalRateFpm: 0, fuelBurnedMinutesEquivalent: 0.5, keyMathNote: `LDR ${ldrM}m / 2500m | ROT ${rotSec}s` },
    ],
  };

  const fuel = ac.remainingFuelMinutes ?? 80;
  const twoStepsAhead: TwoStepsAheadPrediction = {
    currentState: {
      stepIndex: 0,
      stepLabel: 'T0 (Acum: Intrare Sector)',
      timeSeconds: step0Sec,
      formattedTime: fmt(step0Sec),
      phaseName: 'Arrival / Entry',
      fixOrLocation: isJet ? 'Intrare TMA (TITEK/PEMOK)' : 'Intrare CTR VFR (12 NM)',
      latitude: 44.38,
      longitude: 24.08,
      distanceToThresholdNm: 14.0,
      altitudeFeet: isJet ? 6000 : 1500,
      trueAirspeedKnots: roundEven(vApp * 1.25, 0),
      groundSpeedKnots: roundEven(wt.gsKt * 1.25, 0),
      trackDegrees: rwyHeading,
      headingDegrees: wt.hdgDeg,
      crabAngleDegrees: wt.wcaDeg,
      verticalSpeedFpm: isJet ? -1200 : -350,
      expectedCrosswindKnots: xw,
      expectedHeadwindKnots: hw,
      remainingFuelMinutes: fuel,
      controllerAction: 'Verificare QNH și alocare secvență',
    },
    stepOneAhead: {
      stepIndex: 1,
      stepLabel: 'Pasul +1 (Poziție Tactică Viitoare)',
      timeSeconds: step1Sec,
      formattedTime: fmt(step1Sec),
      phaseName: status === 'HoldInOrbitRecommended' ? 'Holding / Orbit' : 'Intermediate Approach',
      fixOrLocation: step1Fix,
      latitude: 44.33,
      longitude: 23.96,
      distanceToThresholdNm: 5.5,
      altitudeFeet: status === 'HoldInOrbitRecommended' ? (isJet ? 4000 : 1500) : isJet ? 2500 : 1000,
      trueAirspeedKnots: roundEven(vApp * 1.08, 0),
      groundSpeedKnots: roundEven(wt.gsKt * 1.08, 0),
      trackDegrees: rwyHeading,
      headingDegrees: wt.hdgDeg,
      crabAngleDegrees: wt.wcaDeg,
      verticalSpeedFpm: status === 'HoldInOrbitRecommended' ? 0 : -rodFpm,
      expectedCrosswindKnots: xw,
      expectedHeadwindKnots: hw,
      remainingFuelMinutes: roundEven(Math.max(10, fuel - 5.5), 1),
      controllerAction: status === 'ClearedForApproach' ? `Autorizare apropiere finală RWY ${rwyId}, cap corectat ${wt.hdgDeg}°` : status === 'HoldInOrbitRecommended' ? 'Instrucțiune intrare în orbită la sud de pistă' : `Vectorizare imediată spre ${bestAlt?.name ?? 'Podari'}`,
    },
    stepTwoAhead: {
      stepIndex: 2,
      stepLabel: 'Pasul +2 (Rezoluție Finală / Touchdown)',
      timeSeconds: step2Sec,
      formattedTime: fmt(step2Sec),
      phaseName: status === 'ClearedForApproach' ? 'Touchdown & Rollout' : status === 'HoldInOrbitRecommended' ? 'Holding Reassessment' : 'Alternate Landing',
      fixOrLocation: step2Fix,
      latitude: 44.3181,
      longitude: 23.8886,
      distanceToThresholdNm: 0,
      altitudeFeet: status === 'HoldInOrbitRecommended' ? (isJet ? 4000 : 1500) : 626,
      trueAirspeedKnots: roundEven(vApp, 0),
      groundSpeedKnots: wt.gsKt,
      trackDegrees: rwyHeading,
      headingDegrees: status === 'DivertRecommended' && bestAlt ? (bestAlt.windCorrectedHeadingDegrees ?? bestAlt.bearingDegrees) : wt.hdgDeg,
      crabAngleDegrees: wt.wcaDeg,
      verticalSpeedFpm: status === 'ClearedForApproach' ? -rodFpm : 0,
      expectedCrosswindKnots: status === 'DivertRecommended' && bestAlt ? bestAlt.calculatedCrosswindKnots : xw,
      expectedHeadwindKnots: hw,
      remainingFuelMinutes: roundEven(Math.max(5, fuel - 9.0), 1),
      controllerAction: status === 'ClearedForApproach' ? `Aterizare la ${fmt(step2Sec)}, eliberare pistă în ${rotSec}s` : status === 'HoldInOrbitRecommended' ? 'Reevaluare rafale pentru ieșire din orbită' : `Confirmare aterizare sigură pe ${bestAlt?.name ?? 'Podari'}`,
    },
    predictiveSummary: `Cu 2 pași înaintea aeronavei ${ac.callsign}: Pas +1 la ${step1Fix} (${fmt(step1Sec)}), urmat de Pas +2 la ${step2Fix} (${fmt(step2Sec)}). Cap compas corectat pentru derivă: ${wt.hdgDeg}° (WCA ${wt.wcaDeg >= 0 ? '+' : ''}${wt.wcaDeg}°), ROD ${rodFpm} fpm, distanță de oprire ${ldrM}m.`,
  };

  let vfrRedirection: VfrRedirectionAnalysis | null = null;
  if (!isJet && alts && bestAlt) {
    const eteAlt = bestAlt.estimatedFlightMinutes;
    const pnrMin = roundEven(Math.max(0, (fuel - 30 - eteAlt * 1.18) / 0.78), 1);
    const xwExceeded = xw > ac.maxCrosswindKnots;
    const decision = !xwExceeded ? 'LandAtLRCV' : pnrMin >= 12 ? 'OrbitThenLandOrDivert' : 'DivertImmediately';
    vfrRedirection = {
      canLandAtPrimaryRunway: !xwExceeded,
      canLandAtReciprocalRunway: !xwExceeded,
      recommendedDecision: decision,
      decisionConfidenceScore: 94.5,
      pointOfNoReturnMinutes: pnrMin,
      fuelBurnCruiseLitersPerHour: 18.0,
      fuelBurnHoldLitersPerHour: 14.0,
      estimatedWaitTimeAtLrcvMinutes: 15.0,
      willWeatherImproveWithinPnr: pnrMin >= 20,
      predictedCrosswindAfterHoldKnots: roundEven(xw * 0.9, 1),
      bestAlternateCode: bestAlt.code,
      bestAlternateName: bestAlt.name,
      bestAlternateRunway: bestAlt.bestRunway,
      bestAlternateScore: bestAlt.safetyScore ?? 92,
      redirectionHeadingToFlyDegrees: bestAlt.windCorrectedHeadingDegrees ?? bestAlt.bearingDegrees,
      redirectionGroundSpeedKnots: ac.speedKnots ?? 75,
      redirectionEtaMinutes: eteAlt,
      fuelRemainingAtAlternateMinutes: roundEven(Math.max(0, fuel - eteAlt * 1.15), 1),
      mathematicalJustification: !xwExceeded
        ? `Aterizare posibilă pe LRCV RWY ${rwyId}. Aerodrom de rezervă optim: ${bestAlt.name} (scor ${bestAlt.safetyScore}/100).`
        : decision === 'OrbitThenLandOrDivert'
          ? `Vântul lateral pe LRCV (${xw} kt) depășește limita de ${ac.maxCrosswindKnots} kt. Combustibilul (${fuel} min) permite orbită până la PNR = ${pnrMin} min; dacă vântul nu scade, redirecționați spre ${bestAlt.name} (cap ${bestAlt.windCorrectedHeadingDegrees}°, vânt lateral doar ${bestAlt.calculatedCrosswindKnots} kt).`
          : `CRITIC (PNR = ${pnrMin} min < 12 min): Redirecționare imediată către ${bestAlt.name} (pista ${bestAlt.bestRunway}, cap ${bestAlt.windCorrectedHeadingDegrees}°, ETE ${eteAlt} min, vânt lateral ${bestAlt.calculatedCrosswindKnots} kt).`,
    };
  }

  return { takeoffToLanding, twoStepsAhead, vfrRedirection };
}

function buildMockFuturePrediction(weather: WeatherCondition, aircrafts: CraiovaAircraft[], advisories: AircraftAdvisory[]): FuturePredictionSummary {
  const horizonsMin = [0, 5, 10, 15, 30, 45];
  const baseGust = weather.windGustKnots > weather.windSpeedKnots ? weather.windGustKnots : weather.windSpeedKnots;
  const snapshots: FutureHorizonSnapshot[] = horizonsMin.map((h) => {
    const phase = (h / 45) * Math.PI * 1.25;
    const decay = h >= 20 ? 1 - (h - 15) * 0.008 : 1 + Math.sin(phase) * 0.06;
    const wSpd = roundEven(Math.max(3, weather.windSpeedKnots * decay), 1);
    const wGst = roundEven(Math.max(wSpd, baseGust * (decay - (h >= 25 ? 0.05 : 0))), 1);
    const wDir = Math.round((weather.windDirectionDegrees + Math.sin(h * 0.11) * 5 + 360) % 360);
    const rwy = activeRunwayCraiova(wDir, wGst);
    const tSec = h * 60;
    const airCount = aircrafts.filter((a) => {
      const adv = advisories.find((x) => x.aircraftId === a.id);
      const land = adv?.assignedLandingSlot?.calculatedTimeSeconds ?? a.etaSeconds;
      return adv?.advisoryStatus === 'HoldInOrbitRecommended' ? tSec <= a.etaSeconds + 1200 : tSec <= land + 60;
    }).length;
    const holdCount = advisories.filter((a) => a.advisoryStatus === 'HoldInOrbitRecommended' && tSec >= (aircrafts.find((x) => x.id === a.aircraftId)?.etaSeconds ?? 0) - 180 && tSec <= 1500).length;
    const landedCount = Math.max(0, aircrafts.length - airCount);
    return {
      horizonMinutes: h,
      horizonSeconds: tSec,
      formattedTime: clockLabel(50400 + tSec, false),
      predictedWindDirectionDegrees: wDir,
      predictedWindSpeedKnots: wSpd,
      predictedWindGustKnots: wGst,
      predictedVisibilityMeters: weather.visibilityMeters,
      recommendedRunway: rwy.id,
      predictedCrosswindKnots: rwy.crosswindKnots,
      predictedHeadwindKnots: rwy.headwindKnots,
      isVfrLegalAndSafe: rwy.crosswindKnots <= 12 && weather.visibilityMeters >= 5000,
      activeAirborneCount: airCount,
      holdingCount: holdCount,
      cumulativeLandedCount: landedCount,
      hazardAlert: rwy.crosswindKnots > 12 ? `Vânt lateral ridicat (${rwy.crosswindKnots} kt)` : null,
    };
  });
  const bestVfr = snapshots.find((s) => s.isVfrLegalAndSafe) ?? [...snapshots].sort((a, b) => a.predictedCrosswindKnots - b.predictedCrosswindKnots)[0];
  return {
    pressureHpa: 1016,
    outsideAirTemperatureCelsius: 18,
    isaTemperatureDeviationCelsius: 4.2,
    pressureAltitudeFeet: 545,
    densityAltitudeFeet: 910,
    airDensityRatioSigma: 0.974,
    windShearExponentAlpha: 0.16,
    windAt2000FtDegrees: (weather.windDirectionDegrees + 10) % 360,
    windAt2000FtKnots: roundEven(weather.windSpeedKnots * 1.33, 1),
    windAt5000FtDegrees: (weather.windDirectionDegrees + 18) % 360,
    windAt5000FtKnots: roundEven(weather.windSpeedKnots * 1.59, 1),
    trendSummary: snapshots[snapshots.length - 1].predictedCrosswindKnots < snapshots[0].predictedCrosswindKnots - 1
      ? `Atenuare treptată a vântului lateral de la ${snapshots[0].predictedCrosswindKnots} kt la ${snapshots[snapshots.length - 1].predictedCrosswindKnots} kt în următoarele 45 min.`
      : `Menținere regim eolian activ (${snapshots[0].predictedCrosswindKnots} kt lateral pe RWY ${snapshots[0].recommendedRunway}).`,
    optimalVfrLandingWindow: `${bestVfr.formattedTime} (T+${bestVfr.horizonMinutes}m, vânt lateral ${bestVfr.predictedCrosswindKnots} kt)`,
    predictedRunwayChangeAtMinute: null,
    horizons: snapshots,
  };
}

export function evaluateSimulation(aircrafts: CraiovaAircraft[], weather: WeatherCondition, dataSource: string): CraiovaSimulationResult {
  const wind = Math.max(weather.windSpeedKnots, weather.windGustKnots);
  const rwy = activeRunwayCraiova(weather.windDirectionDegrees, wind);
  const advisories: AircraftAdvisory[] = [];
  const cleared: AircraftInput[] = [];
  const toInput = (ac: CraiovaAircraft): AircraftInput => ({
    id: ac.id,
    flightRules: ac.flightRules,
    etaSeconds: ac.etaSeconds,
    earliestSeconds: ac.earliestSeconds,
    latestSeconds: ac.latestSeconds,
    frozenTimeSeconds: ac.frozenTimeSeconds ?? null,
  });

  for (const ac of aircrafts) {
    const xw = rwy.crosswindKnots;
    const exceeded = xw > ac.maxCrosswindKnots;
    const fuel = ac.remainingFuelMinutes ?? 90;
    const common = {
      aircraftId: ac.id,
      callsign: ac.callsign,
      modelName: ac.modelName,
      category: ac.category,
      flightRules: ac.flightRules,
      hasInstrumentAvionics: ac.hasInstrumentAvionics,
      currentCrosswindKnots: xw,
      maxCrosswindLimitKnots: ac.maxCrosswindKnots,
      orbitAdvice: null,
      recommendedAlternates: null,
      assignedLandingSlot: null,
    };
    if (ac.category === 'CommercialJet' || ac.category === 'RegionalTurboprop') {
      if (!exceeded) {
        advisories.push({ ...common, advisoryStatus: 'ClearedForApproach', advisoryReason: `Zbor comercial IFR prioritar. Vântul lateral (${xw} kts) este în limita operațională (${ac.maxCrosswindKnots} kts). Liber pentru apropiere pe pista ${rwy.id}.` });
        cleared.push(toInput(ac));
      } else {
        advisories.push({
          ...common,
          advisoryStatus: 'HoldInOrbitRecommended',
          advisoryReason: `Vânt lateral sever (${xw} kts) ce depășește limita maximă admisă (${ac.maxCrosswindKnots} kts). Se recomandă holding standard IFR.`,
          orbitAdvice: { patternName: 'Standard IFR Holding Craiova (VOR/DME CRA)', recommendedAltitudeFeet: 4000, holdingDurationMinutes: 15, remainingFuelMarginMinutes: fuel - 20, safetyInstructions: 'Așteptare în holding standard până la scăderea vitezei rafalelor sub 30 kts.' },
        });
      }
    } else {
      const alts = alternates(weather, ac.speedKnots ?? 100, ac.maxCrosswindKnots);
      if (exceeded) {
        const canHold = fuel > 40;
        advisories.push({
          ...common,
          advisoryStatus: canHold ? 'HoldInOrbitRecommended' : 'DivertRecommended',
          advisoryReason:
            `Vântul lateral calculat la sol (${xw} kts) depășește limita demonstrată a aeronavei ${ac.modelName} (${ac.maxCrosswindKnots} kts). ` +
            (canHold
              ? 'Se recomandă menținerea în orbită de așteptare sau devierea către aerodromurile Balta Verde / Podari unde vântul oferă o orientare mai favorabilă.'
              : 'Rezervele de combustibil impun devierea imediată către Podari sau Balta Verde.'),
          orbitAdvice: {
            patternName: `Orbită de așteptare paralelă cu latura sudică a pistei ${rwy.id} (Cârcea - Pielești)`,
            recommendedAltitudeFeet: 1500,
            holdingDurationMinutes: 12,
            remainingFuelMarginMinutes: fuel - 15,
            safetyInstructions: 'Mențineți zbor vizual (VFR) la 1500 ft QNH paralel cu axul pistei, în afara zonei de turbulență de siaj generată de aeronavele grele. Cedați prioritatea traficului comercial.',
          },
          recommendedAlternates: alts,
        });
      } else {
        advisories.push({ ...common, advisoryStatus: 'ClearedForApproach', advisoryReason: `Vânt lateral acceptabil (${xw} kts <= ${ac.maxCrosswindKnots} kts). Integrat în secvențierea de aterizare, cedând pasul zborurilor IFR grele.`, recommendedAlternates: alts });
        cleared.push(toInput(ac));
      }
    }
  }

  let sequences: PlanningResponse | null = null;
  if (cleared.length > 0) {
    sequences = evaluatePlanning(cleared, { minimumGapSeconds: 120, allowVfr: true, baseTimeOffsetSeconds: 50400 });
    const best = sequences.validVariants[0];
    if (best) {
      for (let i = 0; i < advisories.length; i++) {
        const slot = best.schedule.find((s) => s.aircraftId === advisories[i].aircraftId);
        if (slot) advisories[i] = { ...advisories[i], assignedLandingSlot: slot };
      }
    }
  }

  for (let i = 0; i < advisories.length; i++) {
    const adv = advisories[i];
    const ac = aircrafts.find((x) => x.id === adv.aircraftId)!;
    const math = buildMockMathForAircraft(ac, weather, rwy.id, rwy.heading, rwy.crosswindKnots, rwy.headwindKnots, adv.advisoryStatus, adv.assignedLandingSlot, adv.recommendedAlternates);
    advisories[i] = { ...adv, ...math };
  }

  const futurePrediction = buildMockFuturePrediction(weather, aircrafts, advisories);

  const isCommercial = (a: CraiovaAircraft) => a.category === 'CommercialJet' || a.category === 'RegionalTurboprop';
  return {
    airport: { icao: 'LRCV', iata: 'CRA', name: 'Aeroportul Internațional Craiova', latitude: 44.3181, longitude: 23.8886, elevationFeet: 626, runways: '08/26 (2500m x 45m, Asfalt)' },
    weather,
    activeRunway: rwy.id,
    activeRunwayCrosswindKnots: rwy.crosswindKnots,
    activeRunwayHeadwindKnots: rwy.headwindKnots,
    isCrosswindCriticalForLightAircraft: rwy.crosswindKnots > 12,
    advisories,
    clearedLandingSequences: sequences,
    stats: {
      totalInbounds: aircrafts.length,
      commercialAirlinersCount: aircrafts.filter(isCommercial).length,
      lightAircraftCount: aircrafts.filter((a) => !isCommercial(a)).length,
      clearedToLandCount: advisories.filter((a) => a.advisoryStatus === 'ClearedForApproach').length,
      holdingInOrbitCount: advisories.filter((a) => a.advisoryStatus === 'HoldInOrbitRecommended').length,
      divertAdvisedCount: advisories.filter((a) => a.advisoryStatus === 'DivertRecommended').length,
    },
    dataSource,
    generatedAtUtc: new Date(0).toISOString(), // mock determinist
    futurePrediction,
  };
}
