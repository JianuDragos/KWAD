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
  LiveTrafficResponse,
  PlanningResponse,
  ScenarioRules,
  ScheduleSlot,
  WeatherCondition,
} from '../contracts/backend';
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
  const r09 = crosswind(windDir, windSpeed, 92);
  const r27 = crosswind(windDir, windSpeed, 272);
  return r27.headwindKnots > r09.headwindKnots ? { id: '27', ...r27 } : { id: '09', ...r09 };
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
    { id: 'YR-SAV', callsign: 'YR-5123', modelName: 'ICP Savannah S (Ultralight STOL)', category: 'UltralightAndGlider', flightRules: 'VFR', hasInstrumentAvionics: false, maxCrosswindKnots: 11, etaSeconds: base, earliestSeconds: Math.max(0, base - 60), latestSeconds: base + 300, frozenTimeSeconds: null, speedKnots: 65, remainingFuelMinutes: 75 },
    { id: 'YR-WILG', callsign: 'YR-WLG', modelName: 'PZL-104 Wilga 35A (STOL)', category: 'UltralightAndGlider', flightRules: 'VFR', hasInstrumentAvionics: false, maxCrosswindKnots: 13, etaSeconds: base + 180, earliestSeconds: base + 120, latestSeconds: base + 480, frozenTimeSeconds: null, speedKnots: 75, remainingFuelMinutes: 80 },
    { id: 'YR-C172', callsign: 'YR-CRA', modelName: 'Cessna 172N Skyhawk', category: 'GeneralAviation', flightRules: 'VFR', hasInstrumentAvionics: true, maxCrosswindKnots: 15, etaSeconds: base + 360, earliestSeconds: base + 300, latestSeconds: base + 660, frozenTimeSeconds: null, speedKnots: 95, remainingFuelMinutes: 90 },
  ];
}

export function realisticCraiovaTraffic(): CraiovaAircraft[] {
  return [
    { id: 'W4-3751', callsign: 'WZZ3751', modelName: 'Airbus A320-232', category: 'CommercialJet', flightRules: 'IFR', hasInstrumentAvionics: true, maxCrosswindKnots: 33, etaSeconds: 0, earliestSeconds: 0, latestSeconds: 240, frozenTimeSeconds: null, speedKnots: 145, remainingFuelMinutes: 110 },
    { id: 'W4-3762', callsign: 'WZZ3762', modelName: 'Airbus A321neo', category: 'CommercialJet', flightRules: 'IFR', hasInstrumentAvionics: true, maxCrosswindKnots: 35, etaSeconds: 360, earliestSeconds: 300, latestSeconds: 720, frozenTimeSeconds: null, speedKnots: 150, remainingFuelMinutes: 125 },
    ...light(120),
  ];
}

export function liveTraffic(): LiveTrafficResponse {
  const traffic = realisticCraiovaTraffic();
  return { source: 'Trafic simulat realist (OpenSky bypass / mod demonstrativ)', count: traffic.length, traffic };
}

// ---------- CraiovaAdvisoryEngine ----------

export function alternates(weather: WeatherCondition, cruiseSpeed = 70): AlternateAerodrome[] {
  const speed = cruiseSpeed <= 0 ? 70 : cruiseSpeed;
  const wind = Math.max(weather.windSpeedKnots, weather.windGustKnots);
  const field = (name: string, code: string, km: number, brg: number, rwyA: [number, string], rwyB: [number, string], reason: (rwy: string, cross: number, minutes: number) => string): AlternateAerodrome => {
    const a = crosswind(weather.windDirectionDegrees, wind, rwyA[0]);
    const b = crosswind(weather.windDirectionDegrees, wind, rwyB[0]);
    const useB = b.headwindKnots > a.headwindKnots;
    const best = useB ? b : a;
    const label = useB ? rwyB[1] : rwyA[1];
    const minutes = roundEven((km / (speed * 1.852)) * 60, 1);
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
    };
  };
  return [
    field('Aerodromul Balta Verde Craiova', 'LRBV', 11.8, 245, [130, '13 (130°)'], [310, '31 (310°)'], (r, c) => `Pistă înierbată 600m. La vânt din ${weather.windDirectionDegrees}°, vântul lateral pe pista ${r} este de ${c} kts (mult redus față de Craiova).`),
    field('Aerodrom Podari (ULM Field)', 'PODARI', 14.5, 225, [20, '02 (020°)'], [200, '20 (200°)'], (r, c) => `Teren dedicat ULM/Savannah. Pista ${r} este orientată aproape pe axul vântului de sud, oferind un vânt lateral minim de doar ${c} kts.`),
    field('Aerodrom Slatina', 'SLATINA', 46.0, 75, [80, '08 (080°)'], [260, '26 (260°)'], (_r, _c, m) => `Aerodrom de rezervă estic la ${m} minute zbor.`),
  ];
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
      const alts = alternates(weather, ac.speedKnots ?? 100);
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

  const isCommercial = (a: CraiovaAircraft) => a.category === 'CommercialJet' || a.category === 'RegionalTurboprop';
  return {
    airport: { icao: 'LRCV', iata: 'CRA', name: 'Aeroportul Internațional Craiova', latitude: 44.3181, longitude: 23.8886, elevationFeet: 626, runways: '09/27 (2500m x 45m, Asfalt)' },
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
  };
}
