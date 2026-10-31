// Utilitare mici pentru MapView ca să păstrăm componenta curată.
import { destination, type LatLon } from '../sim/geomath';
import { trackBearingDeg, type TrackPoint } from '../sim/interpolate';

export { destination };

export function trackBearingDegSafe(a: TrackPoint, b: TrackPoint): number {
  return trackBearingDeg(a, b);
}

export function isInboundTowards(pos: LatLon, target: LatLon, trackDeg: number | null, toleranceDeg = 38): boolean {
  if (trackDeg == null) return false;
  const rad = Math.PI / 180;
  const dLon = (target.lon - pos.lon) * rad;
  const y = Math.sin(dLon) * Math.cos(target.lat * rad);
  const x =
    Math.cos(pos.lat * rad) * Math.sin(target.lat * rad) -
    Math.sin(pos.lat * rad) * Math.cos(target.lat * rad) * Math.cos(dLon);
  const brg = (Math.atan2(y, x) / rad + 360) % 360;
  let diff = Math.abs(brg - trackDeg) % 360;
  if (diff > 180) diff = 360 - diff;
  return diff <= toleranceDeg;
}
