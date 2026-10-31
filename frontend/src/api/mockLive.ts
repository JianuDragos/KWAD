// Date de exemplu pentru pagina live în modul mock (npm run dev:mock), când serverul .NET nu rulează.
// Formele copiază recordurile LiveFlightState / MetarDecoded din backend.
import type { Explanation, LiveFlight, LivePositions, Metar } from '../contracts/live';
import { destination } from '../sim/geomath';

const now = () => Math.floor(Date.now() / 1000);

// Patru survoluri reale observate deasupra Craiovei (OpenSky, 31 oct 2026) și o sosire inventată.
const BASE: Omit<LiveFlight, 'timePosition' | 'lastContact'>[] = [
  { icao24: '4ba9b0', callsign: 'THY5AD', originCountry: 'Turkey', latitude: 44.3142, longitude: 24.1946, baroAltitudeMeters: 10355, onGround: false, velocityKnots: 464, trueTrackDegrees: 308, verticalRateMs: 0, squawk: '5331', distanceFromLrcvKm: 24.4, bearingFromLrcvDegrees: 91 },
  { icao24: '504e8e', callsign: 'FIE3248', originCountry: 'Republic of Moldova', latitude: 44.7141, longitude: 24.0833, baroAltitudeMeters: 10668, onGround: false, velocityKnots: 436, trueTrackDegrees: 106, verticalRateMs: 0, squawk: '0411', distanceFromLrcvKm: 46.6, bearingFromLrcvDegrees: 20 },
  { icao24: '4bce02', callsign: 'SXS9RM', originCountry: 'Turkey', latitude: 44.7812, longitude: 23.9762, baroAltitudeMeters: 10973, onGround: false, velocityKnots: 465, trueTrackDegrees: 307, verticalRateMs: 0, squawk: '3214', distanceFromLrcvKm: 52, bearingFromLrcvDegrees: 8 },
  { icao24: '4070e9', callsign: 'EXS7AC', originCountry: 'United Kingdom', latitude: 44.4501, longitude: 23.502, baroAltitudeMeters: 10973, onGround: false, velocityKnots: 455, trueTrackDegrees: 312, verticalRateMs: 0, squawk: '5364', distanceFromLrcvKm: 33.8, bearingFromLrcvDegrees: 295 },
  // Pe prelungirea axului pistei 27 (latitudinea pragului 27), ca să arate ca o apropiere reală.
  { icao24: '4a8137', callsign: 'WZZ3751', originCountry: 'Romania', latitude: 44.3185, longitude: 24.12, baroAltitudeMeters: 1100, onGround: false, velocityKnots: 180, trueTrackDegrees: 268, verticalRateMs: -4, squawk: '4721', distanceFromLrcvKm: 18.5, bearingFromLrcvDegrees: 84 },
];

const START = now();
/** După atâtea secunde avioanele de exemplu o iau de la capăt, ca harta să nu rămână goală. */
const LOOP_SECONDS = 20 * 60;

export function livePositions(): LivePositions {
  const t = now();
  // Avioanele avansează între interogări, ca datele reale; altfel ar sări înapoi la fiecare actualizare.
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
    skyConditionDescription: 'Broken la 300 ft, overcast la 700 ft',
    temperatureCelsius: 11,
    dewPointCelsius: 11,
    qnhHpa: 1020,
    weatherPhenomena: null,
    flightCategory: 'LIFR',
  };
}

/** În mock nu rulează niciun model: răspunsul arată ca rezerva backendului când modelul lipsește. */
export function explanation(): Explanation {
  return {
    scenarioRevision: 1,
    mode: 'deterministic_fallback',
    statementIds: ['decision', 'weather', 'limits'],
    sentences: [
      'Snapshot simulare LRCV: pista activă 27; 5 aeronave evaluate, 5 cu apropiere recomandată, 0 în așteptare și 0 cu deviere recomandată.',
      'METAR LRCV: vânt 240° 9 kt, vizibilitate 7000 m, plafon la 300 ft. Categorie: LIFR.',
      'Acesta este un rezultat de simulare și suport decizional. Nu este o autorizare ATC și nu înlocuiește procedurile, verificările sau judecata controlorului.',
    ],
    sourceIds: ['SIM-1', 'LRCV 310730Z 24009KT 7000 BKN003 OVC007 11/11 Q1020', 'RULES-1'],
    fallbackReason: 'inference_unavailable',
  };
}
