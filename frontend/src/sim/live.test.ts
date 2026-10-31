import { describe, expect, it } from 'vitest';
import * as mockLive from '../api/mockLive';
import { livePositionsSchema, metarSchema, type LiveFlight } from '../contracts/live';
import { bearingDeg, distanceNm } from './geomath';
import { MAX_EXTRAPOLATION_SECONDS, airlineFor, extrapolate, runwayForWind, trendArrow, windComponents } from './live';

const flight = (over: Partial<LiveFlight> = {}): LiveFlight => ({
  icao24: 'abc123',
  callsign: 'TEST1',
  latitude: 44.3,
  longitude: 23.9,
  baroAltitudeMeters: 3000,
  onGround: false,
  velocityKnots: 360,
  trueTrackDegrees: 90,
  verticalRateMs: 0,
  timePosition: 1000,
  lastContact: 1000,
  distanceFromLrcvKm: 1,
  bearingFromLrcvDegrees: 0,
  ...over,
});

describe('extrapolate', () => {
  it('avansează pe direcția și viteza raportate', () => {
    const p = extrapolate(flight(), 1010)!; // 10 s la 360 kt = 1 NM spre est
    const from = { lat: 44.3, lon: 23.9 };
    expect(distanceNm(from, p)).toBeCloseTo(1, 3);
    expect(bearingDeg(from, p)).toBeCloseTo(90, 0);
    expect(p.extrapolatedSeconds).toBe(10);
  });
  it('date vechi: se oprește la limită, nu sare înapoi la poziția raportată', () => {
    const atLimit = extrapolate(flight(), 1000 + MAX_EXTRAPOLATION_SECONDS)!;
    expect(extrapolate(flight(), 1000 + MAX_EXTRAPOLATION_SECONDS + 60)).toEqual(atLimit);
    expect(atLimit.extrapolatedSeconds).toBe(MAX_EXTRAPOLATION_SECONDS);
  });
  it('nu extrapolează la sol sau fără viteză', () => {
    expect(extrapolate(flight({ onGround: true }), 1010)!.extrapolatedSeconds).toBe(0);
    expect(extrapolate(flight({ velocityKnots: null }), 1010)!.extrapolatedSeconds).toBe(0);
  });
  it('fără coordonate nu inventează poziția', () => {
    expect(extrapolate(flight({ latitude: null }), 1010)).toBeNull();
  });
});

describe('vânt și pistă', () => {
  it('alege pista cu vânt de față', () => {
    expect(runwayForWind(240, 9)).toBe('27');
    expect(runwayForWind(90, 6)).toBe('09');
    expect(runwayForWind(null, 3)).toBe('27');
    expect(runwayForWind(90, 0)).toBe('27');
  });
  it('vânt perpendicular pe pistă: totul e lateral', () => {
    expect(windComponents(179, 20, '27')).toEqual({ crosswind: 20, headwind: 0 });
  });
  it('săgeata de tendință ignoră variațiile sub 1 m/s', () => {
    expect([trendArrow(5), trendArrow(-5), trendArrow(0.5), trendArrow(null)]).toEqual(['↑', '↓', '', '']);
  });
});

describe('schemele datelor reale', () => {
  it('acceptă datele de exemplu (aceeași formă ca backendul)', () => {
    expect(livePositionsSchema.safeParse(mockLive.livePositions()).success).toBe(true);
    expect(metarSchema.safeParse(mockLive.metar()).success).toBe(true);
  });
  it('respinge o poziție cu câmp lipsă', () => {
    const data = mockLive.livePositions();
    const broken = { ...data, flights: data.flights.map(({ lastContact: _drop, ...rest }) => rest) };
    expect(livePositionsSchema.safeParse(broken).success).toBe(false);
  });
});

describe('airlineFor', () => {
  it('recunoaște operatorul din indicativ, fără să ghicească', () => {
    expect(airlineFor('WZZ3751')).toBe('Wizz Air');
    expect(airlineFor('THY5AD')).toBe('Turkish Airlines');
    expect(airlineFor('XYZ123')).toBeNull(); // operator necunoscut
    expect(airlineFor('YR-CRA')).toBeNull(); // înmatriculare, nu zbor de linie
  });
});
