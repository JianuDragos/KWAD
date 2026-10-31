import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CraiovaCustomEvaluationRequest, CraiovaSimulationResult } from '../contracts/backend';
import * as mockBackend from '../api/mockBackend';

// Clientul HTTP e înlocuit: testăm logica stării (revizii, răspunsuri vechi, reset), nu rețeaua.
vi.mock('../api/client', () => ({
  API_MOCK: false,
  ApiError: class ApiError extends Error {},
  fetchScenarioTraffic: vi.fn(),
  evaluateCraiova: vi.fn(),
  evaluatePlanning: vi.fn(),
}));

const client = await import('../api/client');
const fetchScenarioTraffic = vi.mocked(client.fetchScenarioTraffic);
const evaluateCraiova = vi.mocked(client.evaluateCraiova);

const evaluateNow = (body: CraiovaCustomEvaluationRequest) =>
  Promise.resolve(mockBackend.evaluateSimulation(body.aircrafts!, body.weather!, 'test'));

async function freshStore() {
  vi.resetModules();
  const { useApp } = await import('./store');
  return useApp;
}

beforeEach(() => {
  fetchScenarioTraffic.mockReset().mockResolvedValue(mockBackend.liveTraffic());
  evaluateCraiova.mockReset().mockImplementation(evaluateNow);
});

describe('store', () => {
  it('ignoră răspunsul unei revizii vechi care sosește ultimul', async () => {
    const useApp = await freshStore();
    await useApp.getState().load();

    const pending: { body: CraiovaCustomEvaluationRequest; resolve: (r: CraiovaSimulationResult) => void }[] = [];
    evaluateCraiova.mockImplementation((body) => new Promise((resolve) => pending.push({ body, resolve })));

    useApp.getState().setWeatherPreset('west'); // revizia 2
    useApp.getState().setWeatherPreset('cross-critical'); // revizia 3
    const [older, newer] = pending;
    newer.resolve(mockBackend.evaluateSimulation(newer.body.aircrafts!, newer.body.weather!, 'test'));
    await Promise.resolve();
    older.resolve(mockBackend.evaluateSimulation(older.body.aircrafts!, older.body.weather!, 'test'));
    await new Promise((r) => setTimeout(r, 0));

    const s = useApp.getState();
    expect(s.scenario?.revision).toBe(3);
    expect(s.evaluation?.revision).toBe(3);
    expect(s.evaluation?.result.weather.windDirectionDegrees).toBe(180);
  });

  it('reset readuce exact scenariul inițial și ceasul la început', async () => {
    const useApp = await freshStore();
    await useApp.getState().load();
    const initial = useApp.getState().evaluation!;

    useApp.getState().setWeatherPreset('cross-critical');
    await new Promise((r) => setTimeout(r, 0));
    useApp.getState().seek(initial.traffic.startSeconds + 500);
    useApp.getState().select('YR-SAV');

    useApp.getState().reset();
    await new Promise((r) => setTimeout(r, 0));
    const s = useApp.getState();
    expect(s.scenario?.weatherPresetId).toBe('calm');
    expect(s.evaluation?.traffic).toEqual(initial.traffic);
    expect(s.simTimeSeconds).toBe(initial.traffic.startSeconds);
    expect(s.selectedId).toBeNull();
    expect(s.playing).toBe(false);
  });

  it('o eroare de backend păstrează ultimul rezultat, marcat depășit', async () => {
    const useApp = await freshStore();
    await useApp.getState().load();
    evaluateCraiova.mockRejectedValue(new client.ApiError('Backendul nu răspunde', 0));
    useApp.getState().setWeatherPreset('west');
    await new Promise((r) => setTimeout(r, 0));
    const s = useApp.getState();
    expect(s.status).toBe('error');
    expect(s.error).toBe('Backendul nu răspunde');
    expect(s.evaluation?.revision).toBe(1);
    expect(s.scenario?.revision).toBe(2);
  });

  it('tick avansează doar în redare și se oprește la final', async () => {
    const useApp = await freshStore();
    await useApp.getState().load();
    const { startSeconds, endSeconds } = useApp.getState().evaluation!.traffic;
    useApp.getState().tick(10);
    expect(useApp.getState().simTimeSeconds).toBe(startSeconds);
    useApp.getState().togglePlay();
    useApp.getState().setSpeed(30);
    useApp.getState().tick(2);
    expect(useApp.getState().simTimeSeconds).toBe(startSeconds + 60);
    useApp.getState().tick(1e6);
    expect(useApp.getState().simTimeSeconds).toBe(endSeconds);
    expect(useApp.getState().playing).toBe(false);
  });
});
