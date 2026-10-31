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
