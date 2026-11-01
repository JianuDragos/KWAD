import { describe, expect, it } from 'vitest';
import * as mock from '../api/mockBackend';
import { FALLBACK_FIRS } from '../data/airspace';
import { ARP, runwayTrueBearing, threshold } from '../data/geo';
import { WEATHER_PRESETS } from '../data/weatherPresets';
import { bearingDeg, distanceNm } from './geomath';
import { positionAt } from './interpolate';
import { buildTacticalTraffic, minArrivalDistance, type VfrPlan } from './traffic';

const aircrafts = mock.realisticCraiovaTraffic();
const calm = WEATHER_PRESETS.find((p) => p.id === 'calm')!.weather;
const result = mock.evaluateSimulation(aircrafts, calm, 'test');
const pending: VfrPlan = { status: 'proposed', acceptedAtSeconds: null, rejectionReason: null };
const accepted: VfrPlan = { status: 'accepted', acceptedAtSeconds: -500, rejectionReason: null };

function build(plan = pending, input = aircrafts) {
  return buildTacticalTraffic(input, result, FALLBACK_FIRS, plan);
}

describe('plan tactic integrat Demo', () => {
  it('ține toate VFR-urile în aer până la sfârșitul ferestrei fără Accept, inclusiv după refuz', () => {
    const model = build();
    const rejected = build({ status: 'rejected', acceptedAtSeconds: null, rejectionReason: 'gate' });
    expect(rejected.flights).toEqual(model.flights);
    for (const f of model.flights.filter((f) => f.aircraft.flightRules === 'VFR')) {
      expect(f.kind).toBe('hold');
      expect(f.slot).toBeNull();
      expect(f.resolvedLandingSeconds).toBeNull();
      const final = positionAt(f.track, model.endSeconds)!;
      expect(final).not.toBeNull();
      expect(final.altitudeMeters).toBeGreaterThan(400);
      expect(distanceNm(final, ARP)).toBeGreaterThan(1);
    }
  });

  it('Accept duce toate aeronavele la pragul pistei, VFR după ultimul IFR', () => {
    const model = build(accepted);
    const ifr = model.flights.filter((f) => f.aircraft.flightRules === 'IFR');
    const lastIfr = Math.max(...ifr.map((f) => f.resolvedLandingSeconds!));
    const thr = threshold(model.runway);
    for (const f of model.flights) {
      expect(f.resolvedLandingSeconds).not.toBeNull();
      expect(f.slot).not.toBeNull();
      const atLanding = positionAt(f.track, f.resolvedLandingSeconds!)!;
      expect(distanceNm(atLanding, thr)).toBeLessThan(0.001);
      expect(f.track.every((p, i) => i === 0 || p.timeSeconds >= f.track[i - 1].timeSeconds)).toBe(true);
      if (f.aircraft.flightRules === 'VFR') expect(f.resolvedLandingSeconds).toBeGreaterThan(lastIfr);
    }
  });

  it('Accept nu rescrie trecutul și nu mută aeronavele la momentul deciziei', () => {
    const before = build();
    const after = build(accepted);
    for (const f of before.flights) {
      const next = after.flights.find((n) => n.id === f.id)!;
      for (const t of [-700, -600, accepted.acceptedAtSeconds!]) {
        expect(positionAt(next.track, t)).toEqual(positionAt(f.track, t));
      }
    }
  });

  it('menține minimum 4 NM între VFR-uri pe finala comună, inclusiv viteze diferite', () => {
    const model = build(accepted);
    const flights = [...model.flights].sort((a, b) => a.resolvedLandingSeconds! - b.resolvedLandingSeconds!);
    const thr = threshold(model.runway);
    const inbound = (runwayTrueBearing(model.runway) + 180) % 360;
    for (let i = 1; i < flights.length; i++) {
      const leader = flights[i - 1];
      const follower = flights[i];
      const required = follower.aircraft.flightRules === 'IFR' ? 5 : 4;
      for (let t = -500; t < leader.resolvedLandingSeconds!; t += 1) {
        const a = positionAt(leader.track, t);
        const b = positionAt(follower.track, t);
        if (!a || !b) continue;
        const aOnFinal = Math.abs(((bearingDeg(thr, a) - inbound + 540) % 360) - 180) < 0.5;
        const bOnFinal = Math.abs(((bearingDeg(thr, b) - inbound + 540) % 360) - 180) < 0.5;
        if (aOnFinal && bOnFinal && distanceNm(b, thr) <= 6) {
          expect(distanceNm(a, b)).toBeGreaterThanOrEqual(required - 0.01);
        }
      }
    }
  });

  it('alege aceeași durată minimă indiferent de ordinea VFR-urilor din API', () => {
    const first = build(accepted);
    const reversed = build(accepted, [...aircrafts].reverse());
    const finish = (model: ReturnType<typeof build>) => Math.max(...model.flights.map((f) => f.resolvedLandingSeconds!));
    expect(finish(reversed)).toBeCloseTo(finish(first), 5);
    expect(first.flights.filter((f) => f.aircraft.flightRules === 'VFR').map((f) => f.id))
      .toEqual(reversed.flights.filter((f) => f.aircraft.flightRules === 'VFR').map((f) => f.id));
  });

  it('nu folosește VFR-urile din holding pentru pragul sosirilor IFR', () => {
    const model = build();
    expect(minArrivalDistance(model, model.startSeconds)).toBeGreaterThan(30);
    expect(minArrivalDistance(model, model.endSeconds, model.startSeconds)).toBeLessThan(20);
  });
});

it('rezolvă întregul grup standard cu ROMATSA și păstrează optimul la reordonarea datelor', () => {
  const input = mock.liveTraffic().traffic;
  const response = mock.evaluateSimulation(input, calm, 'test');
  const a = buildTacticalTraffic(input, response, FALLBACK_FIRS, accepted);
  const b = buildTacticalTraffic([...input].reverse(), response, FALLBACK_FIRS, accepted);
  const finish = (model: typeof a) => Math.max(...model.flights.map((f) => f.resolvedLandingSeconds!));
  expect(a.flights).toHaveLength(9);
  expect(a.flights.every((f) => f.slot !== null && f.resolvedLandingSeconds !== null)).toBe(true);
  expect(finish(a)).toBeCloseTo(finish(b), 5);
});


it.each(WEATHER_PRESETS)('$id: ambele scenarii încep cu minimum două minute înainte de prima trecere prin 30 NM', ({ weather }) => {
  for (const preset of ['default', 'eurasia'] as const) {
    const input = mock.liveTraffic(preset).traffic;
    const response = mock.evaluateSimulation(input, weather, 'test');
    const model = buildTacticalTraffic(input, response, FALLBACK_FIRS, { ...pending, status: 'idle' });
    // Scanare în timp, independentă de calculul momentului de notificare din generator.
    let first30: number | null = null;
    for (let t = Math.max(model.missionStartSeconds, model.startSeconds - 1800); t < model.endSeconds; t++) {
      const distance = minArrivalDistance(model, t);
      if (distance !== null && distance <= 30) { first30 = t; break; }
    }
    expect(first30).not.toBeNull();
    expect(first30! - model.startSeconds).toBeGreaterThanOrEqual(120);
    expect(minArrivalDistance(model, model.startSeconds)).toBeGreaterThan(30);
  }
});
