import { describe, expect, it } from 'vitest';
import { arrivalRoute, publishedAltitudeFt, threshold } from '../data/geo';
import { WEATHER_PRESETS } from '../data/weatherPresets';
import * as mock from '../api/mockBackend';
import { distanceNm } from './geomath';
import { positionAt, trailUntil, type TrackPoint } from './interpolate';
import { buildTraffic } from './traffic';

const P = (t: number, lat: number, lon: number, alt = 0, source: TrackPoint['source'] = 'synthetic'): TrackPoint => ({
  timeSeconds: t,
  latitudeDeg: lat,
  longitudeDeg: lon,
  altitudeMeters: alt,
  source,
});

describe('positionAt', () => {
  const track = [P(0, 44, 23, 1000), P(10, 44.1, 23, 0), P(20, 44.1, 23.1, 0, 'historical')];

  it('nu inventează poziții în afara datelor', () => {
    expect(positionAt(track, -1)).toBeNull();
    expect(positionAt(track, 21)).toBeNull();
    expect(positionAt([], 0)).toBeNull();
  });
  it('interpolează liniar și păstrează sursa pe puncte exacte', () => {
    const mid = positionAt(track, 5)!;
    expect(mid.lat).toBeCloseTo(44.05);
    expect(mid.altitudeMeters).toBe(500);
    expect(mid.headingDeg).toBe(0);
    expect(positionAt(track, 10)!.source).toBe('synthetic');
    expect(positionAt(track, 20)!.source).toBe('historical');
    expect(positionAt(track, 15)!.source).toBe('mixed');
  });
  it('direcție null la un singur punct, fără NaN la timpi egali', () => {
    expect(positionAt([P(5, 44, 23)], 5)!.headingDeg).toBeNull();
    expect(Number.isNaN(positionAt([P(5, 44, 23), P(5, 45, 23)], 5)!.lat)).toBe(false);
  });
  it('urma se oprește la T', () => {
    expect(trailUntil(track, 5)).toEqual([[44, 23], [44.05, 23]]);
  });
});

describe('geometria AIP', () => {
  it('citește restricțiile publicate', () => {
    expect(publishedAltitudeFt('+FL060 -250kt')).toBe(6000);
    expect(publishedAltitudeFt('+4000ft -230kt')).toBe(4000);
    expect(publishedAltitudeFt('@2500ft -185kt')).toBe(2500);
    expect(publishedAltitudeFt(undefined)).toBeNull();
  });
  it('tranziția TITEK → RWY 26 are lungimile din AIP', () => {
    const r = arrivalRoute('26', 'TITEK');
    expect(r.map((p) => p.id)).toEqual(['TITEK', 'CV520', 'CV514', 'OZZET', 'CV508', 'THR26']);
    const legs = r.slice(1).map((p, i) => Number(distanceNm(r[i], p).toFixed(1)));
    expect(legs).toEqual([15.5, 10.9, 6.0, 6.0, 5.7]);
  });
});

describe('mock = backendul KWAD', () => {
  it('reproduce exemplul din documentul motorului', () => {
    const res = mock.evaluatePlanning(
      [
        { id: 'IFR1', flightRules: 'IFR', etaSeconds: 0, earliestSeconds: 0, latestSeconds: 180 },
        { id: 'IFR2', flightRules: 'IFR', etaSeconds: 240, earliestSeconds: 240, latestSeconds: 600 },
        { id: 'IFR3', flightRules: 'IFR', etaSeconds: 480, earliestSeconds: 480, latestSeconds: 840 },
        { id: 'VFR', flightRules: 'VFR', etaSeconds: 360, earliestSeconds: 300, latestSeconds: 420 },
      ],
      { minimumGapSeconds: 120 },
    );
    expect(res.validVariants.map((v) => v.sequenceOrder.join(' '))).toEqual(['IFR1 IFR2 VFR IFR3', 'IFR1 VFR IFR2 IFR3']);
    expect(res.validVariants.map((v) => v.totalDelaySeconds)).toEqual([0, 360]);
    expect(res.validVariants[1].maxDelaySeconds).toBe(240);
    expect(res.rejectedVariants.map((v) => v.rejectionReason)).toEqual([
      'Aeronava IFR1 depășește limita maximă permisă (180s). Calculat: 480s.',
      'Aeronava VFR depășește limita maximă permisă (420s). Calculat: 600s.',
    ]);
    expect(res.validVariants[0].schedule.map((s) => s.formattedTime)).toEqual(['14:00', '14:04', '14:06', '14:08']);
  });

  it('reproduce bugul: doar primul VFR primește slot', () => {
    const calm = WEATHER_PRESETS.find((p) => p.id === 'calm')!.weather;
    const res = mock.evaluateSimulation(mock.realisticCraiovaTraffic(), calm, 'test');
    const withSlot = res.advisories.filter((a) => a.assignedLandingSlot).map((a) => a.aircraftId);
    expect(res.advisories.every((a) => a.advisoryStatus === 'ClearedForApproach')).toBe(true);
    expect(withSlot).toEqual(['W4-3751', 'W4-3762', 'YR-SAV']);
  });

  it('vânt lateral critic: avioanele mici nu sunt aprobate', () => {
    const critical = WEATHER_PRESETS.find((p) => p.id === 'cross-critical')!.weather;
    const res = mock.evaluateSimulation(mock.realisticCraiovaTraffic(), critical, 'test');
    expect(res.activeRunway).toBe('09');
    expect(res.stats.clearedToLandCount).toBe(2);
    expect(res.stats.holdingInOrbitCount).toBe(3);
  });
});

describe('buildTraffic', () => {
  const aircrafts = mock.realisticCraiovaTraffic();

  it.each(WEATHER_PRESETS)('$id: aterizarea pe hartă cade exact la timpul din backend', ({ weather }) => {
    const res = mock.evaluateSimulation(aircrafts, weather, 'test');
    const model = buildTraffic(aircrafts, res);
    expect(model.flights).toHaveLength(aircrafts.length);
    for (const f of model.flights) {
      expect(f.track.length).toBeGreaterThan(1);
      if (f.landingSeconds !== null) {
        const thr = threshold(model.runway);
        const atThr = f.track.find((p) => p.timeSeconds === f.landingSeconds)!;
        expect(atThr).toBeDefined();
        expect(atThr.latitudeDeg).toBeCloseTo(thr.lat, 6);
        expect(f.landingSeconds).toBe(f.slot?.calculatedTimeSeconds ?? f.aircraft.etaSeconds);
      }
      for (let i = 1; i < f.track.length; i++) expect(f.track[i].timeSeconds).toBeGreaterThanOrEqual(f.track[i - 1].timeSeconds);
    }
  });

  it('este determinist (reset repetabil)', () => {
    const res = mock.evaluateSimulation(aircrafts, WEATHER_PRESETS[0].weather, 'test');
    expect(buildTraffic(aircrafts, res)).toEqual(buildTraffic(aircrafts, res));
  });

  it('pista din backend 09/27 devine 08/26 pe hartă', () => {
    const west = mock.evaluateSimulation(aircrafts, WEATHER_PRESETS.find((p) => p.id === 'west')!.weather, 'test');
    expect(west.activeRunway).toBe('27');
    expect(buildTraffic(aircrafts, west).runway).toBe('26');
  });
});
