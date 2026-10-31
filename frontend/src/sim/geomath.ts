// Calcule pe sferă pentru distanțe mici (zona CTR Craiova). Unități: grade, NM.

export type LatLon = { lat: number; lon: number };

const EARTH_RADIUS_NM = 3440.065;
const RAD = Math.PI / 180;

export function distanceNm(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(h));
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
