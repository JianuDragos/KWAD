// Traiectorii sintetice pe trasee AIP reale. Doar afișare: timpul de sosire vine din backend,
// aici doar desenăm cum ajunge avionul la acel timp. Toate punctele sunt marcate „synthetic”.
import { bearingDeg, destination, distanceNm, type LatLon } from './geomath';
import type { TrackPoint } from './interpolate';
import { feetToMeters } from './units';

export type PlannedFix = LatLon & { id: string; altitudeFt: number };

/** Leg i = de la fixes[i] la fixes[i+1]; speedsKt are lungimea fixes.length - 1. */
export function trackArrivingAt(fixes: PlannedFix[], speedsKt: number[], arrivalSeconds: number): TrackPoint[] {
  if (fixes.length === 0) return [];
  if (speedsKt.length !== fixes.length - 1) throw new Error('Câte o viteză pentru fiecare segment');
  const offsets = [0];
  for (let i = 1; i < fixes.length; i++) {
    const legSeconds = (distanceNm(fixes[i - 1], fixes[i]) / speedsKt[i - 1]) * 3600;
    offsets.push(offsets[i - 1] + legSeconds);
  }
  const shift = arrivalSeconds - offsets[offsets.length - 1];
  return fixes.map((f, i) => point(offsets[i] + shift, f, f.altitudeFt));
}

/** Continuă un track cu un segment până la `to`, la viteza dată. */
export function appendLeg(track: TrackPoint[], to: LatLon, altitudeFt: number, speedKt: number): TrackPoint[] {
  const last = track[track.length - 1];
  const from = { lat: last.latitudeDeg, lon: last.longitudeDeg };
  const seconds = (distanceNm(from, to) / speedKt) * 3600;
  return [...track, point(last.timeSeconds + seconds, to, altitudeFt)];
}

/** Ture de așteptare circulare în jurul unui centru, în sensul acelor de ceasornic, până la untilSeconds. */
export function appendOrbit(
  track: TrackPoint[],
  center: LatLon,
  radiusNm: number,
  altitudeFt: number,
  speedKt: number,
  untilSeconds: number,
): TrackPoint[] {
  const out = [...track];
  const last = out[out.length - 1];
  const steps = 16;
  const stepSeconds = ((2 * Math.PI * radiusNm) / steps / speedKt) * 3600;
  let angle = bearingDeg(center, { lat: last.latitudeDeg, lon: last.longitudeDeg });
  let t = last.timeSeconds;
  // intrarea în cerc
  const entry = destination(center, angle, radiusNm);
  t += (distanceNm({ lat: last.latitudeDeg, lon: last.longitudeDeg }, entry) / speedKt) * 3600;
  out.push(point(t, entry, altitudeFt));
  while (t < untilSeconds) {
    angle = (angle + 360 / steps) % 360;
    t += stepSeconds;
    out.push(point(t, destination(center, angle, radiusNm), altitudeFt));
  }
  return out;
}

/** Punct „înainte de IAF”, pe prelungirea primului segment, ca avionul să fie vizibil înainte de intrare. */
export function inboundExtension(first: LatLon, second: LatLon, distNm: number): LatLon {
  return destination(first, (bearingDeg(first, second) + 180) % 360, distNm);
}

function point(timeSeconds: number, p: LatLon, altitudeFt: number): TrackPoint {
  return {
    timeSeconds,
    latitudeDeg: p.lat,
    longitudeDeg: p.lon,
    altitudeMeters: feetToMeters(altitudeFt),
    source: 'synthetic',
  };
}
