// Calcule mici pentru pagina cu date reale. Funcții pure, testate în live.test.ts.
import type { LiveFlight } from '../contracts/live';
import { runwayTrueBearing, type RunwayId } from '../data/geo';
import { destination, type LatLon } from './geomath';

/** Cât de mult avansăm o poziție OpenSky între două interogări; peste asta o lăsăm pe loc (date vechi). */
export const MAX_EXTRAPOLATION_SECONDS = 30;

/**
 * Poziția estimată acum, pe direcția și viteza raportate (dead reckoning), ca avioanele să nu sară
 * din 15 în 15 secunde. Întoarce null fără coordonate.
 */
export function extrapolate(f: LiveFlight, nowUnixSeconds: number): (LatLon & { extrapolatedSeconds: number }) | null {
  if (f.latitude == null || f.longitude == null) return null;
  const from = { lat: f.latitude, lon: f.longitude };
  const age = nowUnixSeconds - (f.timePosition ?? f.lastContact);
  if (f.onGround || f.velocityKnots == null || f.trueTrackDegrees == null || age <= 0 || age > MAX_EXTRAPOLATION_SECONDS) {
    return { ...from, extrapolatedSeconds: 0 };
  }
  return { ...destination(from, f.trueTrackDegrees, (f.velocityKnots * age) / 3600), extrapolatedSeconds: age };
}

/** Pista cu cel mai mult vânt de față (METAR raportează direcția adevărată). Fără vânt definit: 27, pista cu ILS. */
export function runwayForWind(windDirectionDegrees: number | null, windSpeedKnots: number): RunwayId {
  if (windDirectionDegrees == null || windSpeedKnots === 0) return '27';
  const headwind = (rwy: RunwayId) => Math.cos(((windDirectionDegrees - runwayTrueBearing(rwy)) * Math.PI) / 180);
  return headwind('09') > headwind('27') ? '09' : '27';
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
