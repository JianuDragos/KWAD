import { describe, expect, it } from 'vitest';
import { bearingDeg, destination, distanceNm } from './geomath';
import type { TrackPoint } from './interpolate';
import { BANK_LIMIT_NORMAL_DEG, bankForRadius, smoothTurns, turnRadiusNm } from './turns';

const pt = (t: number, lat: number, lon: number): TrackPoint => ({ timeSeconds: t, latitudeDeg: lat, longitudeDeg: lon, altitudeMeters: 1000, source: 'synthetic' });

/** Viraj de 90° la 250 kt, cu segmente de 10 NM. */
function rightAngleTrack(): TrackPoint[] {
  const a = { lat: 44.3, lon: 23.5 };
  const p = destination(a, 90, 10);
  const c = destination(p, 180, 10);
  const leg = (10 / 250) * 3600;
  return [pt(0, a.lat, a.lon), pt(leg, p.lat, p.lon), pt(2 * leg, c.lat, c.lon)];
}

describe('smoothTurns', () => {
  it('raza la 30° și 250 kt e de ~1,6 NM', () => {
    expect(turnRadiusNm(250, 30)).toBeCloseTo(1.58, 1);
    expect(bankForRadius(250, turnRadiusNm(250, 30))).toBeCloseTo(30, 5);
  });

  it('înlocuiește colțul cu un arc la cel mult 30° înclinare, fără să schimbe capetele', () => {
    const src = rightAngleTrack();
    const out = smoothTurns(src);
    expect(out[0]).toEqual(src[0]);
    expect(out[out.length - 1]).toEqual(src[src.length - 1]);
    expect(out.length).toBeGreaterThan(src.length);

    // Fără salturi de direcție: între două puncte consecutive, capul se schimbă cu cel mult 10°.
    const ll = (q: TrackPoint) => ({ lat: q.latitudeDeg, lon: q.longitudeDeg });
    for (let i = 2; i < out.length; i++) {
      const h1 = bearingDeg(ll(out[i - 2]), ll(out[i - 1]));
      const h2 = bearingDeg(ll(out[i - 1]), ll(out[i]));
      expect(Math.abs(((h2 - h1 + 540) % 360) - 180)).toBeLessThanOrEqual(10.5);
    }

    // Raza arcului (din trei puncte ale lui) corespunde unei înclinări de cel mult 30°.
    const arc = out.slice(1, -1);
    const [p1, p2, p3] = [arc[0], arc[Math.floor(arc.length / 2)], arc[arc.length - 1]].map(ll);
    const chord = distanceNm(p1, p3);
    const turn = Math.abs(((bearingDeg(p2, p3) - bearingDeg(p1, p2) + 540) % 360) - 180) * 2;
    const radius = chord / (2 * Math.sin((turn * Math.PI) / 360));
    expect(bankForRadius(250, radius)).toBeLessThanOrEqual(BANK_LIMIT_NORMAL_DEG + 1);
  });

  it('lasă neschimbate segmentele drepte', () => {
    const a = { lat: 44.3, lon: 23.5 };
    const b = destination(a, 90, 5);
    const c = destination(b, 90, 5);
    const src = [pt(0, a.lat, a.lon), pt(72, b.lat, b.lon), pt(144, c.lat, c.lon)];
    expect(smoothTurns(src)).toEqual(src);
  });
});
