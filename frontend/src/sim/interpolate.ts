export type TrackSource = 'historical' | 'synthetic' | 'projected';

export type TrackPoint = {
  timeSeconds: number;
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeMeters: number;
  source: TrackSource;
};

export type Interpolated = {
  lat: number;
  lon: number;
  altitudeMeters: number;
  /** null când avionul nu se deplasează între cele două puncte; păstrezi direcția anterioară. */
  headingDeg: number | null;
  gapSeconds: number;
  source: TrackSource | 'mixed';
};

/** Poziția la timpul t. În afara punctelor cunoscute întoarce null: nu inventăm poziții. */
export function positionAt(track: TrackPoint[], t: number): Interpolated | null {
  const n = track.length;
  if (n === 0 || t < track[0].timeSeconds || t > track[n - 1].timeSeconds) return null;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (track[m].timeSeconds <= t) lo = m;
    else hi = m;
  }
  const a = track[lo];
  const b = track[hi];
  const span = b.timeSeconds - a.timeSeconds;
  const f = span > 0 ? (t - a.timeSeconds) / span : 0;
  const moved = a.latitudeDeg !== b.latitudeDeg || a.longitudeDeg !== b.longitudeDeg;
  return {
    lat: a.latitudeDeg + (b.latitudeDeg - a.latitudeDeg) * f,
    lon: a.longitudeDeg + (b.longitudeDeg - a.longitudeDeg) * f,
    altitudeMeters: a.altitudeMeters + (b.altitudeMeters - a.altitudeMeters) * f,
    headingDeg: moved ? trackBearingDeg(a, b) : null,
    gapSeconds: span,
    source: f === 0 ? a.source : f === 1 ? b.source : a.source === b.source ? a.source : 'mixed',
  };
}

export function trackBearingDeg(a: TrackPoint, b: TrackPoint): number {
  const r = Math.PI / 180;
  const φ1 = a.latitudeDeg * r;
  const φ2 = b.latitudeDeg * r;
  const Δλ = (b.longitudeDeg - a.longitudeDeg) * r;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) / r + 360) % 360;
}

/** Urma parcursă până la t (fără puncte din viitor), terminată în poziția curentă. */
export function trailUntil(track: TrackPoint[], t: number): [number, number][] {
  const out: [number, number][] = [];
  for (const p of track) {
    if (p.timeSeconds > t) break;
    out.push([p.latitudeDeg, p.longitudeDeg]);
  }
  const now = positionAt(track, t);
  if (now) out.push([now.lat, now.lon]);
  return out;
}
