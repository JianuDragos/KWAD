import { describe, expect, it } from 'vitest';
import * as mock from '../api/mockBackend';
import { WEATHER_PRESETS } from '../data/weatherPresets';
import { describeIssue, liveTrafficSchema, planningResponseSchema, simulationResultSchema } from './schemas';

describe('schemele răspunsurilor', () => {
  it('acceptă toate răspunsurile mock-ului (aceeași formă ca backendul)', () => {
    expect(liveTrafficSchema.safeParse(mock.liveTraffic()).success).toBe(true);
    for (const p of WEATHER_PRESETS) {
      expect(simulationResultSchema.safeParse(mock.evaluateSimulation(mock.realisticCraiovaTraffic(), p.weather, 't')).success).toBe(true);
    }
    const plan = mock.evaluatePlanning(
      [{ id: 'A', flightRules: 'IFR', etaSeconds: 0, earliestSeconds: 0, latestSeconds: 60 }],
      { minimumGapSeconds: 120 },
    );
    expect(planningResponseSchema.safeParse(plan).success).toBe(true);
  });

  it('calculează predicția viitorului 4D, doi pași înainte, takeoff-to-landing și redirecționarea VFR', () => {
    const crossCritical = WEATHER_PRESETS.find((p) => p.id === 'cross-critical')!.weather;
    const res = mock.evaluateSimulation(mock.realisticCraiovaTraffic(), crossCritical, 'test');
    expect(res.futurePrediction).toBeDefined();
    expect(res.futurePrediction?.horizons.map((h) => h.horizonMinutes)).toEqual([0, 5, 10, 15, 30, 45]);

    const jet = res.advisories.find((a) => a.aircraftId === 'W4-3751')!;
    expect(jet.takeoffToLanding?.phases).toHaveLength(6);
    expect(jet.twoStepsAhead?.stepOneAhead.timeSeconds).toBeGreaterThan(jet.twoStepsAhead!.currentState.timeSeconds);
    expect(jet.twoStepsAhead?.stepTwoAhead.timeSeconds).toBeGreaterThan(jet.twoStepsAhead!.stepOneAhead.timeSeconds);

    const vfr = res.advisories.find((a) => a.aircraftId === 'YR-SAV')!;
    expect(vfr.vfrRedirection).toBeDefined();
    expect(vfr.vfrRedirection?.bestAlternateCode).toBe('PODARI');
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
