// Viraje cu înclinare limitată: traseele sintetice trec prin puncte cu colțuri ascuțite, dar un avion nu poate
// schimba direcția instantaneu. Fiecare colț devine un arc tangent la cele două segmente (viraj „fly-by”),
// cu raza dată de viteză și de unghiul maxim de înclinare: R = V² / (g · tan φ).
import { bearingDeg, destination, distanceNm, type LatLon } from './geomath';
import type { TrackPoint } from './interpolate';

/** Înclinare maximă în exploatare normală (pasageri, proceduri standard). */
export const BANK_LIMIT_NORMAL_DEG = 30;
/** Înclinare maximă admisă în situații critice (evitare, ratare); nu se folosește pe traseele planificate. */
export const BANK_LIMIT_CRITICAL_DEG = 60;

const G = 9.80665;
const MPS_PER_KT = 0.514444;
const M_PER_NM = 1852;

/** Raza virajului (NM) la viteza dată și înclinarea dată. */
export function turnRadiusNm(speedKt: number, bankDeg: number): number {
  const v = speedKt * MPS_PER_KT;
  return (v * v) / (G * Math.tan((bankDeg * Math.PI) / 180)) / M_PER_NM;
}

/** Înclinarea necesară pentru un viraj de rază dată (grade). */
export function bankForRadius(speedKt: number, radiusNm: number): number {
  const v = speedKt * MPS_PER_KT;
  return (Math.atan((v * v) / (G * radiusNm * M_PER_NM)) * 180) / Math.PI;
}

const ll = (p: TrackPoint): LatLon => ({ lat: p.latitudeDeg, lon: p.longitudeDeg });
const signedTurn = (from: number, to: number) => ((to - from + 540) % 360) - 180;

/**
 * Rotunjește colțurile traseului. Timpii la începutul și sfârșitul fiecărui arc se iau de pe segmentele originale,
 * deci ora de sosire la prag nu se schimbă. Dacă arcul la înclinarea normală nu încape între două puncte
 * apropiate, raza scade până la jumătatea segmentului mai scurt, dar nu sub raza de la înclinarea critică.
 */
export function smoothTurns(track: TrackPoint[], maxBankDeg = BANK_LIMIT_NORMAL_DEG): TrackPoint[] {
  if (track.length < 3) return track;
  const out: TrackPoint[] = [track[0]];
  for (let i = 1; i < track.length - 1; i++) {
    const a = track[i - 1];
    const p = track[i];
    const c = track[i + 1];
    const lenIn = distanceNm(ll(a), ll(p));
    const lenOut = distanceNm(ll(p), ll(c));
    const dtIn = p.timeSeconds - a.timeSeconds;
    const dtOut = c.timeSeconds - p.timeSeconds;
    const bIn = bearingDeg(ll(a), ll(p));
    const bOut = bearingDeg(ll(p), ll(c));
    const delta = signedTurn(bIn, bOut);
    if (lenIn < 0.02 || lenOut < 0.02 || dtIn <= 0 || dtOut <= 0 || Math.abs(delta) < 2 || Math.abs(delta) > 175) {
      out.push(p);
      continue;
    }
    const speedKt = (lenIn / dtIn) * 3600;
    const half = Math.tan((Math.abs(delta) * Math.PI) / 360);
    const fit = (Math.min(lenIn, lenOut) / 2) / half;
    const radius = Math.max(Math.min(turnRadiusNm(speedKt, maxBankDeg), fit), turnRadiusNm(speedKt, BANK_LIMIT_CRITICAL_DEG));
    // shortcut: dacă nici la 60° arcul nu încape între puncte, îl strângem (înclinare peste limită); apare doar la puncte
    // de traseu la sub ~1 NM unul de altul — de corectat la sursa traseului dacă devine vizibil.
    const d = Math.min(radius * half, Math.min(lenIn, lenOut) / 2);
    const r = d / half;

    const fIn = d / lenIn;
    const fOut = d / lenOut;
    const t1 = p.timeSeconds - fIn * dtIn;
    const t2 = p.timeSeconds + fOut * dtOut;
    const alt1 = p.altitudeMeters + (a.altitudeMeters - p.altitudeMeters) * fIn;
    const alt2 = p.altitudeMeters + (c.altitudeMeters - p.altitudeMeters) * fOut;
    const side = Math.sign(delta);
    const start = destination(ll(p), (bIn + 180) % 360, d);
    const center = destination(start, (bIn + 90 * side + 360) % 360, r);
    const steps = Math.max(2, Math.ceil(Math.abs(delta) / 10));
    for (let k = 0; k <= steps; k++) {
      const f = k / steps;
      const heading = bIn + delta * f;
      const pos = destination(center, (heading - 90 * side + 720) % 360, r);
      out.push({
        timeSeconds: t1 + (t2 - t1) * f,
        latitudeDeg: pos.lat,
        longitudeDeg: pos.lon,
        altitudeMeters: alt1 + (alt2 - alt1) * f,
        source: p.source,
      });
    }
  }
  out.push(track[track.length - 1]);
  return out;
}
