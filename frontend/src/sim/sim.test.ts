import { describe, expect, it } from 'vitest';
import { ARP, LRCW, arrivalRoute, publishedAltitudeFt, threshold } from '../data/geo';
import { WEATHER_PRESETS } from '../data/weatherPresets';
import * as mock from '../api/mockBackend';
import type { AircraftInput, WeatherCondition } from '../contracts/backend';
import { bearingDeg, destination, distanceNm } from './geomath';
import { positionAt, trailUntil, type TrackPoint } from './interpolate';
import { altitudeBand } from './units';
import { appendOrbit } from './synthetic';
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
  it('tranziția TITEK → RWY 27 are lungimile din AIP', () => {
    const r = arrivalRoute('27', 'TITEK');
    expect(r.map((p) => p.id)).toEqual(['TITEK', 'CV520', 'CV514', 'OZZET', 'CV508', 'THR27']);
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

  const ifr = (id: string, eta: number, lo: number, hi: number, frozen: number | null = null): AircraftInput => ({
    id,
    flightRules: 'IFR',
    etaSeconds: eta,
    earliestSeconds: lo,
    latestSeconds: hi,
    frozenTimeSeconds: frozen,
  });

  it('timp blocat în fereastră și la distanță suficientă: rămâne exact', () => {
    const res = mock.evaluatePlanning([ifr('A', 0, 0, 300), ifr('B', 100, 100, 600, 400)], { minimumGapSeconds: 120 });
    expect(res.validVariants[0].schedule.map((s) => s.calculatedTimeSeconds)).toEqual([0, 400]);
  });

  it('timp blocat prea aproape de precedentul: varianta e respinsă cu motiv', () => {
    const res = mock.evaluatePlanning([ifr('A', 0, 0, 300), ifr('B', 100, 100, 600, 119)], { minimumGapSeconds: 120 });
    expect(res.validVariants).toHaveLength(0);
    expect(res.rejectedVariants[0].rejectionReason).toBe('Aeronava B încalcă intervalul minim de 120s față de 0s.');
  });

  it('timp blocat exact la intervalul minim: acceptat', () => {
    const res = mock.evaluatePlanning([ifr('A', 0, 0, 300), ifr('B', 100, 100, 600, 120)], { minimumGapSeconds: 120 });
    expect(res.validVariants).toHaveLength(1);
  });

  it('validatorul respinge datele greșite înainte de calcul (400 în backend)', () => {
    expect(() => mock.evaluatePlanning([ifr('A', 0, 0, 300, 500)], { minimumGapSeconds: 120 })).toThrow('Timpul blocat (500s) pentru A este în afara ferestrei permise.');
    expect(() => mock.evaluatePlanning([ifr('A', 0, 400, 300)], { minimumGapSeconds: 120 })).toThrow(mock.MockBadRequest);
    expect(() => mock.evaluatePlanning([ifr('A', 0, 0, 300), ifr('A', 0, 0, 300)], { minimumGapSeconds: 120 })).toThrow('duplicate');
    expect(() => mock.evaluatePlanning([], { minimumGapSeconds: 120 })).toThrow('goală');
  });

  it('VFR neeligibil: zero variante valide, motiv explicit', () => {
    const res = mock.evaluatePlanning([ifr('A', 0, 0, 300), { ...ifr('V', 60, 0, 300), flightRules: 'VFR' }], { minimumGapSeconds: 120, allowVfr: false });
    expect(res.validVariants).toHaveLength(0);
    expect(res.rejectedVariants[0].rejectionReason).toBe('Zborurile VFR sunt neeligibile în scenariu.');
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

  const lowFuelSavannah = aircrafts.map((a) => (a.id === 'YR-SAV' ? { ...a, remainingFuelMinutes: 30 } : a));

  it('combustibil puțin + vânt lateral: deviere spre alternativa cu cel mai mic vânt lateral', () => {
    const critical = WEATHER_PRESETS.find((p) => p.id === 'cross-critical')!.weather;
    const res = mock.evaluateSimulation(lowFuelSavannah, critical, 'test');
    const f = buildTraffic(lowFuelSavannah, res).flights.find((x) => x.id === 'YR-SAV')!;
    expect(f.kind).toBe('divert');
    expect(f.alternate?.code).toBe('PODARI');
    const end = f.track[f.track.length - 1];
    expect(distanceNm({ lat: end.latitudeDeg, lon: end.longitudeDeg }, destination(ARP, 225, 14.5 / 1.852))).toBeLessThan(0.01);
  });

  it('„Balta Verde / LRBV” din backend se desenează la coordonatele AIP ale LRCW', () => {
    // Vânt din 310°: pista 13/31 a terenului are vânt lateral 0, deci e alternativa aleasă.
    const nw: WeatherCondition = { windDirectionDegrees: 310, windSpeedKnots: 26, windGustKnots: 26, visibilityMeters: 9999 };
    const res = mock.evaluateSimulation(lowFuelSavannah, nw, 'test');
    const f = buildTraffic(lowFuelSavannah, res).flights.find((x) => x.id === 'YR-SAV')!;
    expect(f.alternate?.code).toBe('LRBV');
    expect(f.alternate?.point).toEqual(LRCW);
  });

  it('scenariu fără avioane: fereastră de ceas validă, nu Infinity', () => {
    const res = mock.evaluateSimulation([], WEATHER_PRESETS[0].weather, 'test');
    const m = buildTraffic([], res);
    expect(m.flights).toEqual([]);
    expect(Number.isFinite(m.startSeconds) && Number.isFinite(m.endSeconds)).toBe(true);
    expect(m.endSeconds).toBeGreaterThan(m.startSeconds);
  });

  it('harta folosește pista dată de backend (09/27)', () => {
    const west = mock.evaluateSimulation(aircrafts, WEATHER_PRESETS.find((p) => p.id === 'west')!.weather, 'test');
    expect(west.activeRunway).toBe('27');
    expect(buildTraffic(aircrafts, west).runway).toBe('27');
  });
});

describe('appendOrbit', () => {
  it('se rotește în sensul acelor de ceasornic (direcția crește) și ține raza', () => {
    const center = { lat: 44.3, lon: 23.9 };
    const north = destination(center, 0, 3);
    const start: TrackPoint[] = [P(0, north.lat, north.lon)];
    const orbit = appendOrbit(start, center, 1.2, 1500, 90, 600);
    const bearings = orbit.slice(1, 4).map((p) => bearingDeg(center, { lat: p.latitudeDeg, lon: p.longitudeDeg }));
    expect(bearings[0]).toBeCloseTo(0, 1);
    expect(bearings[1]).toBeCloseTo(22.5, 1);
    expect(bearings[2]).toBeCloseTo(45, 1);
    for (const p of orbit.slice(1)) expect(distanceNm(center, { lat: p.latitudeDeg, lon: p.longitudeDeg })).toBeCloseTo(1.2, 3);
    expect(orbit[orbit.length - 1].timeSeconds).toBeGreaterThanOrEqual(600);
  });
});

describe('altitudeBand', () => {
  it('pune avionul în banda corectă; limitele aparțin benzii de deasupra', () => {
    const ft = (f: number) => f * 0.3048;
    expect(altitudeBand(ft(628))).toBe('alt-0'); // pe pistă
    expect(altitudeBand(ft(1500))).toBe('alt-1');
    expect(altitudeBand(ft(4999))).toBe('alt-1');
    expect(altitudeBand(ft(9000))).toBe('alt-2');
    expect(altitudeBand(ft(24000))).toBe('alt-3');
    expect(altitudeBand(ft(36000))).toBe('alt-4');
    expect(altitudeBand(null)).toBe('alt-unknown');
  });
});
