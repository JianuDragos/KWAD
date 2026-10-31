// Calcule mici pentru pagina cu date reale. Funcții pure, testate în live.test.ts.
import type { LiveFlight } from '../contracts/live';
import { runwayTrueBearing, type RunwayId } from '../data/geo';
import { destination, type LatLon } from './geomath';

/** Cât de mult avansăm cel mult o poziție OpenSky; peste asta avionul se oprește acolo (date vechi), nu sare înapoi. */
export const MAX_EXTRAPOLATION_SECONDS = 30;

/**
 * Poziția estimată acum, pe direcția și viteza raportate (dead reckoning), ca avioanele să nu sară
 * din 15 în 15 secunde. Întoarce null fără coordonate.
 */
export function extrapolate(f: LiveFlight, nowUnixSeconds: number): (LatLon & { extrapolatedSeconds: number }) | null {
  if (f.latitude == null || f.longitude == null) return null;
  const from = { lat: f.latitude, lon: f.longitude };
  const age = nowUnixSeconds - (f.timePosition ?? f.lastContact);
  if (f.onGround || f.velocityKnots == null || f.trueTrackDegrees == null || age <= 0) return { ...from, extrapolatedSeconds: 0 };
  const seconds = Math.min(age, MAX_EXTRAPOLATION_SECONDS);
  return { ...destination(from, f.trueTrackDegrees, (f.velocityKnots * seconds) / 3600), extrapolatedSeconds: seconds };
}

/** Pista cu cel mai mult vânt de față (METAR raportează direcția adevărată). Fără vânt definit: 27, pista cu ILS. */
export function runwayForWind(windDirectionDegrees: number | null, windSpeedKnots: number): RunwayId {
  if (windDirectionDegrees == null || windSpeedKnots === 0) return '27';
  const headwind = (rwy: RunwayId) => Math.cos(((windDirectionDegrees - runwayTrueBearing(rwy)) * Math.PI) / 180);
  return headwind('09') > headwind('27') ? '09' : '27';
}

/** Codurile ICAO de operator (primele 3 litere din indicativ) ale companiilor care trec frecvent pe aici. */
const AIRLINES: Record<string, string> = {
  WZZ: 'Wizz Air', WUK: 'Wizz Air UK', WMT: 'Wizz Air Malta', ROT: 'TAROM', RYR: 'Ryanair', RUK: 'Ryanair UK',
  LDA: 'Lauda Europe', THY: 'Turkish Airlines', PGT: 'Pegasus Airlines', SXS: 'SunExpress', EXS: 'Jet2.com',
  DLH: 'Lufthansa', AUA: 'Austrian Airlines', SWR: 'Swiss', AFR: 'Air France', BAW: 'British Airways',
  KLM: 'KLM', LOT: 'LOT Polish Airlines', AEE: 'Aegean Airlines', ITY: 'ITA Airways', EZY: 'easyJet',
  EJU: 'easyJet Europe', VLG: 'Vueling', TRA: 'Transavia', QTR: 'Qatar Airways', UAE: 'Emirates',
  ETD: 'Etihad Airways', FDB: 'flydubai', ELY: 'El Al', ASL: 'Air Serbia', LZB: 'Bulgaria Air',
  TVS: 'Smartwings', ENT: 'Enter Air', FIA: 'FlyOne',
};

/** Compania aeriană după indicativ; null dacă nu e un zbor de linie cunoscut (nu ghicim). */
export function airlineFor(callsign: string): string | null {
  return /^[A-Z]{3}\d/.test(callsign) ? (AIRLINES[callsign.slice(0, 3)] ?? null) : null;
}

/** Săgeată pentru urcare / coborâre în blocul de date, ca pe scope; sub 1 m/s e zbor la nivel. */
export function trendArrow(verticalRateMs: number | null): string {
  if (verticalRateMs == null || Math.abs(verticalRateMs) < 1) return '';
  return verticalRateMs > 0 ? '↑' : '↓';
}

/** Componentele vântului pe o pistă, în noduri, rotunjite la întreg. */
export function windComponents(windDirectionDegrees: number, windSpeedKnots: number, rwy: RunwayId) {
  const a = ((windDirectionDegrees - runwayTrueBearing(rwy)) * Math.PI) / 180;
  return { crosswind: Math.round(Math.abs(windSpeedKnots * Math.sin(a))), headwind: Math.round(windSpeedKnots * Math.cos(a)) };
}
