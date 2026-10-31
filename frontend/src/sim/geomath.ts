// Calcule pe sferă (distanță, azimut, punct destinație și arc ortodromic Great-Circle pentru rute lungi). Unități: grade, NM.

export type LatLon = { lat: number; lon: number };

const EARTH_RADIUS_NM = 3440.065;
const RAD = Math.PI / 180;

export function distanceNm(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Direcția adevărată de la a la b, în grade [0, 360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * RAD;
  const φ2 = b.lat * RAD;
  const Δλ = (b.lon - a.lon) * RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** Punctul aflat la distanța dată, pe direcția adevărată dată. */
export function destination(from: LatLon, bearing: number, distNm: number): LatLon {
  const δ = distNm / EARTH_RADIUS_NM;
  const θ = bearing * RAD;
  const φ1 = from.lat * RAD;
  const λ1 = from.lon * RAD;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: φ2 / RAD, lon: λ2 / RAD };
}

/** Interpolează sferic (SLERP) un punct pe cercul mare (Great Circle) la fracțiunea f ∈ [0, 1] între a și b. */
export function greatCircleInterpolate(a: LatLon, b: LatLon, fraction: number): LatLon {
  if (fraction <= 0) return a;
  if (fraction >= 1) return b;

  const φ1 = a.lat * RAD;
  const λ1 = a.lon * RAD;
  const φ2 = b.lat * RAD;
  const λ2 = b.lon * RAD;

  const x1 = Math.cos(φ1) * Math.cos(λ1);
  const y1 = Math.cos(φ1) * Math.sin(λ1);
  const z1 = Math.sin(φ1);

  const x2 = Math.cos(φ2) * Math.cos(λ2);
  const y2 = Math.cos(φ2) * Math.sin(λ2);
  const z2 = Math.sin(φ2);

  const dot = Math.max(-1, Math.min(1, x1 * x2 + y1 * y2 + z1 * z2));
  const ω = Math.acos(dot);
  if (ω < 1e-6) {
    return {
      lat: a.lat + (b.lat - a.lat) * fraction,
      lon: a.lon + (b.lon - a.lon) * fraction,
    };
  }

  const sinω = Math.sin(ω);
  const k1 = Math.sin((1 - fraction) * ω) / sinω;
  const k2 = Math.sin(fraction * ω) / sinω;
  const x = k1 * x1 + k2 * x2;
  const y = k1 * y1 + k2 * y2;
  const z = k1 * z1 + k2 * z2;

  return {
    lat: Math.atan2(z, Math.hypot(x, y)) / RAD,
    lon: Math.atan2(y, x) / RAD,
  };
}

/** Eșantionează arcul ortodromic (inclusiv capetele a și b) astfel încât niciun segment să nu depășească maxSegmentNm. */
export function greatCirclePoints(a: LatLon, b: LatLon, maxSegmentNm = 55): LatLon[] {
  const total = distanceNm(a, b);
  const steps = Math.max(1, Math.min(96, Math.ceil(total / Math.max(5, maxSegmentNm))));
  const out: LatLon[] = [a];
  for (let i = 1; i < steps; i++) {
    out.push(greatCircleInterpolate(a, b, i / steps));
  }
  out.push(b);
  return out;
}
