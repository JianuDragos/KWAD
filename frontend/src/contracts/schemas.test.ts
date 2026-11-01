import { describe, expect, it } from 'vitest';
import * as mock from '../api/mockBackend';
import * as mockLive from '../api/mockLive';
import { WEATHER_PRESETS } from '../data/weatherPresets';
import { explanationSchema } from './live';
import { describeIssue, liveTrafficSchema, planningResponseSchema, simulationResultSchema } from './schemas';

describe('schemele răspunsurilor', () => {
  it('acceptă toate răspunsurile mock-ului (Standard și Eurasia Long-Haul)', () => {
    expect(liveTrafficSchema.safeParse(mock.liveTraffic('default')).success).toBe(true);
    const eurasiaLive = liveTrafficSchema.safeParse(mock.liveTraffic('eurasia'));
    expect(eurasiaLive.success).toBe(true);
    if (eurasiaLive.success) {
      expect(eurasiaLive.data.traffic.some((a) => a.id === 'CA-841' && a.departureIcao === 'ZBAA')).toBe(true);
    }

    for (const p of WEATHER_PRESETS) {
      expect(simulationResultSchema.safeParse(mock.evaluateSimulation(mock.realisticCraiovaTraffic(), p.weather, 't')).success).toBe(true);
      expect(simulationResultSchema.safeParse(mock.evaluateSimulation(mock.eurasiaLongHaulTraffic(), p.weather, 'eurasia')).success).toBe(true);
    }
    const plan = mock.evaluatePlanning(
      [{ id: 'A', flightRules: 'IFR', etaSeconds: 0, earliestSeconds: 0, latestSeconds: 60 }],
      { minimumGapSeconds: 120 },
    );
    expect(planningResponseSchema.safeParse(plan).success).toBe(true);
  });

  it('validează răspunsul AI direct în română împreună cu raportul de verificare anti-halucinație', () => {
    const evalRes = mock.evaluateSimulation(mock.realisticCraiovaTraffic(), WEATHER_PRESETS[0].weather, 't');
    const exp = mockLive.explanation('Cât combustibil mai are YR-5123?', evalRes);
    const parsed = explanationSchema.safeParse(exp);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.directAnswer).toContain('YR-5123');
      expect(parsed.data.verification?.isVerified).toBe(true);
      expect(parsed.data.verification?.citations.length).toBeGreaterThan(0);
    }
  });

  it('calculează predicția viitorului, doi pași înainte, takeoff-to-landing cu coordonate origine și redirecționarea VFR', () => {
    const crossCritical = WEATHER_PRESETS.find((p) => p.id === 'cross-critical')!.weather;
    const res = mock.evaluateSimulation(mock.eurasiaLongHaulTraffic(), crossCritical, 'test');
    expect(res.futurePrediction).toBeDefined();
    expect(res.futurePrediction?.horizons.map((h) => h.horizonMinutes)).toEqual([0, 5, 10, 15, 30, 45]);

    const chinaJet = res.advisories.find((a) => a.aircraftId === 'CA-841')!;
    expect(chinaJet.takeoffToLanding?.departureAerodromeIcao).toBe('ZBAA');
    expect(chinaJet.takeoffToLanding?.departureLatitude).toBeCloseTo(40.074, 2);
    expect(chinaJet.takeoffToLanding?.departureLongitude).toBeCloseTo(116.591, 2);
    expect(chinaJet.takeoffToLanding?.totalRouteDistanceNm).toBeGreaterThan(3800);
    expect(chinaJet.takeoffToLanding?.phases).toHaveLength(6);

    const jet = res.advisories.find((a) => a.aircraftId === 'W4-3751')!;
    expect(jet.takeoffToLanding?.departureAerodromeIcao).toBe('EGGW');
    expect(jet.twoStepsAhead?.stepOneAhead.timeSeconds).toBeGreaterThan(jet.twoStepsAhead!.currentState.timeSeconds);
    expect(jet.twoStepsAhead?.stepTwoAhead.timeSeconds).toBeGreaterThan(jet.twoStepsAhead!.stepOneAhead.timeSeconds);

    const vfr = res.advisories.find((a) => a.aircraftId === 'YR-SAV')!;
    expect(vfr.vfrRedirection).toBeDefined();
    expect(vfr.vfrRedirection?.bestAlternateCode).toBe('LRCW');
    expect(vfr.vfrRedirection?.pointOfNoReturnMinutes).toBeGreaterThan(15);
  });

  it('un câmp redenumit în backend dă o eroare cu calea câmpului', () => {
    const res = mock.evaluateSimulation(mock.realisticCraiovaTraffic(), WEATHER_PRESETS[0].weather, 't');
    const renamed = { ...res, advisories: res.advisories.map(({ advisoryStatus, ...rest }) => ({ ...rest, status: advisoryStatus })) };
    const parsed = simulationResultSchema.safeParse(renamed);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(describeIssue(parsed.error)).toMatch(/^advisories\.0\.advisoryStatus: /);
  });

  it('enum-uri numerice (backend fără JsonStringEnumConverter) sunt respinse', () => {
    const live = mock.liveTraffic();
    const numeric = { ...live, traffic: live.traffic.map((a) => ({ ...a, flightRules: 0 })) };
    expect(liveTrafficSchema.safeParse(numeric).success).toBe(false);
  });
});
