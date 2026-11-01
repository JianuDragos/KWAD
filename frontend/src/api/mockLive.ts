// Date de exemplu pentru pagina live în modul mock (npm run dev:mock), când serverul .NET nu rulează.
// Formele copiază recordurile LiveFlightState / MetarDecoded din backend.
import type { CraiovaSimulationResult } from '../contracts/backend';
import type { Explanation, LiveFlight, LivePositions, Metar } from '../contracts/live';
import { destination } from '../sim/geomath';

const now = () => Math.floor(Date.now() / 1000);

// Patru survoluri reale observate deasupra Craiovei (OpenSky, 31 oct 2026) și o sosire inventată.
const BASE: Omit<LiveFlight, 'timePosition' | 'lastContact'>[] = [
  { icao24: '4ba9b0', callsign: 'THY5AD', originCountry: 'Turkey', latitude: 44.3142, longitude: 24.1946, baroAltitudeMeters: 10355, onGround: false, velocityKnots: 464, trueTrackDegrees: 308, verticalRateMs: 0, squawk: '5331', flightRules: 'IFR', distanceFromLrcvKm: 24.4, bearingFromLrcvDegrees: 91 },
  { icao24: '504e8e', callsign: 'FIE3248', originCountry: 'Republic of Moldova', latitude: 44.7141, longitude: 24.0833, baroAltitudeMeters: 10668, onGround: false, velocityKnots: 436, trueTrackDegrees: 106, verticalRateMs: 0, squawk: '0411', flightRules: 'IFR', distanceFromLrcvKm: 46.6, bearingFromLrcvDegrees: 20 },
  { icao24: '4bce02', callsign: 'SXS9RM', originCountry: 'Turkey', latitude: 44.7812, longitude: 23.9762, baroAltitudeMeters: 10973, onGround: false, velocityKnots: 465, trueTrackDegrees: 307, verticalRateMs: 0, squawk: '3214', flightRules: 'IFR', distanceFromLrcvKm: 52, bearingFromLrcvDegrees: 8 },
  { icao24: '4070e9', callsign: 'EXS7AC', originCountry: 'United Kingdom', latitude: 44.4501, longitude: 23.502, baroAltitudeMeters: 10973, onGround: false, velocityKnots: 455, trueTrackDegrees: 312, verticalRateMs: 0, squawk: '5364', flightRules: 'IFR', distanceFromLrcvKm: 33.8, bearingFromLrcvDegrees: 295 },
  // Pe prelungirea axului pistei 26 (latitudinea pragului 26), ca să arate ca o apropiere reală.
  { icao24: '4a8137', callsign: 'WZZ3751', originCountry: 'Romania', latitude: 44.3185, longitude: 24.12, baroAltitudeMeters: 1100, onGround: false, velocityKnots: 180, trueTrackDegrees: 268, verticalRateMs: -4, squawk: '4721', flightRules: 'IFR', distanceFromLrcvKm: 18.5, bearingFromLrcvDegrees: 84 },
  { icao24: 'vfr001', callsign: 'YR-VFR', originCountry: 'Romania', latitude: 44.1182, longitude: 23.8886, baroAltitudeMeters: 900, onGround: false, velocityKnots: 75, trueTrackDegrees: 0, verticalRateMs: 0, squawk: '7000', flightRules: 'VFR', distanceFromLrcvKm: 22.2, bearingFromLrcvDegrees: 180 },
];

const START = now();
/** După atâtea secunde avioanele de exemplu o iau de la capăt, ca harta să nu rămână goală. */
const LOOP_SECONDS = 20 * 60;

export function livePositions(): LivePositions {
  const t = now();
  const elapsed = (t - 3 - START) % LOOP_SECONDS;
  const flights = BASE.map((f) => {
    const p = destination({ lat: f.latitude!, lon: f.longitude! }, f.trueTrackDegrees!, (f.velocityKnots! * elapsed) / 3600);
    return { ...f, latitude: p.lat, longitude: p.lon, timePosition: t - 3, lastContact: t - 2 };
  });
  return { queryTimeUtc: new Date().toISOString(), source: 'Date de exemplu (mock)', totalCount: flights.length, airborneCount: flights.length, flights };
}

export function metar(): Metar {
  return {
    station: 'LRCV',
    rawMetar: 'LRCV 310730Z 24009KT 7000 BKN003 OVC007 11/11 Q1020',
    observationTimeUtc: '2026-10-31T07:30:00Z',
    windDirectionDegrees: 240,
    windSpeedKnots: 9,
    windGustKnots: null,
    isWindVariable: false,
    visibilityMeters: 7000,
    skyConditionDescription: 'Cer mai mult acoperit (plafon) la 90 m; Cer acoperit complet (plafon) la 210 m',
    temperatureCelsius: 11,
    dewPointCelsius: 11,
    qnhHpa: 1020,
    weatherPhenomena: null,
    flightCategory: 'LIFR',
  };
}

/** În mock nu rulează niciun model: răspunsul traduce calculele matematice din scenariu în limbaj natural. */
export function explanation(question?: string, evalResult?: CraiovaSimulationResult): Explanation {
  if (evalResult) {
    const qLower = (question ?? '').toLowerCase();
    const matchedAdv = evalResult.advisories.find(
      (a) => qLower.includes(a.callsign.toLowerCase()) || qLower.includes(a.aircraftId.toLowerCase()),
    );
    const directAnswer = matchedAdv
      ? `${matchedAdv.callsign} (${matchedAdv.modelName}): stare ${matchedAdv.advisoryStatus} pe pista RWY ${matchedAdv.assignedRunway}, vânt lateral ${matchedAdv.currentCrosswindKnots} kt (limită ${matchedAdv.maxCrosswindLimitKnots} kt). ${matchedAdv.advisoryReason}`
      : `Pe pista activă RWY ${evalResult.activeRunway} (vânt lateral ${evalResult.activeRunwayCrosswindKnots} kt), ${evalResult.stats.clearedToLandCount} aeronave sunt aprobate la aterizare, ${evalResult.stats.holdingInOrbitCount} în așteptare și ${evalResult.stats.divertAdvisedCount} redirecționate.`;

    const sentences = [directAnswer];
    const statementIds = [matchedAdv ? `flight_${matchedAdv.aircraftId}` : 'decision'];
    return {
      scenarioRevision: 1,
      mode: 'deterministic_fallback',
      statementIds,
      sentences,
      sourceIds: ['SIM-MATH-4D', 'ROMATSA-AIP-DB'],
      fallbackReason: 'inference_unavailable',
      directAnswer,
      verification: {
        isVerified: true,
        engineUsed: 'Mock Determinist Frontend',
        runtimeEndpoint: 'mock-local',
        latencyMs: 5,
        totalNumbersInAnswer: 3,
        verifiedNumbers: [String(evalResult.activeRunway), String(evalResult.activeRunwayCrosswindKnots)],
        unverifiedNumbers: [],
        hallucinationBlocked: false,
        verificationSummary: 'Mod mock: răspuns generat determinist din evaluarea curentă.',
        citations: [{ id: statementIds[0], sourceId: 'SIM-MATH-4D', text: directAnswer }],
      },
    };
  }
  const direct = 'Pe LRCV pista activă este 26, cu vânt 240° la 9 kt și vizibilitate 7000 m (LIFR); 5 aeronave sunt aprobate pentru apropiere.';
  return {
    scenarioRevision: 1,
    mode: 'deterministic_fallback',
    statementIds: ['decision', 'weather'],
    sentences: [direct],
    sourceIds: ['SIM-1', 'LRCV 310730Z 24009KT 7000 BKN003 OVC007 11/11 Q1020'],
    fallbackReason: 'inference_unavailable',
    directAnswer: direct,
    verification: {
      isVerified: true,
      engineUsed: 'Mock Determinist Frontend',
      runtimeEndpoint: 'mock-local',
      latencyMs: 4,
      totalNumbersInAnswer: 4,
      verifiedNumbers: ['26', '240', '9', '7000', '5'],
      unverifiedNumbers: [],
      hallucinationBlocked: false,
      verificationSummary: 'Mod mock: toate valorile provin direct din snapshotul local.',
      citations: [{ id: 'decision', sourceId: 'SIM-1', text: direct }],
    },
  };
}

export function vfrTracking() {
  const positions = livePositions();
  const vfrFlights = positions.flights.filter((f) => f.flightRules === 'VFR').map((f) => ({ flightId: f.icao24, callsign: f.callsign, pointCode: 'VFR-S', distanceToPointMeters: 800, etaViaPointMinutes: 18.5, isVmcValid: false, status: 'VFR SUSPENDED — IMC' }));
  return {
    queryTimeUtc: new Date().toISOString(),
    source: positions.source, totalCount: positions.totalCount, airborneCount: positions.airborneCount,
    boundingBoxLamin: 43.8, boundingBoxLamax: 44.8, boundingBoxLomin: 23.3, boundingBoxLomax: 24.5,
    vmc: { status: 'IMC' as const, isVmcValid: false, visibilityMeters: 7000, ceilingFeet: 300, windDirectionDegrees: 240, windSpeedKnots: 9, crosswindRunway08Knots: 7.3, crosswindRunway26Knots: 7.3, crosswindRunway09Knots: 7.3, crosswindRunway27Knots: 7.3, rawMetar: metar().rawMetar },
    points: [
      { code: 'VFR-S', lat: 44.1182, long: 23.8886, radiusMeters: 1500 },
      { code: 'VFR-N', lat: 44.5182, long: 23.8886, radiusMeters: 1500 },
      { code: 'VFR-W', lat: 44.2493, long: 23.6355, radiusMeters: 1500 },
    ],
    flights: positions.flights.map((f) => { const track = vfrFlights.find((v) => v.flightId === f.icao24); return track ? { ...f, vfrEtaMinutes: track.etaViaPointMinutes, vfrEntryPointCode: track.pointCode } : f; }),
    vfrFlights,
  };
}
