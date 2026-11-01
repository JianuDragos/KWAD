import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CraiovaCustomEvaluationRequest, CraiovaSimulationResult, TrafficPresetId } from '../contracts/backend';
import * as mockBackend from '../api/mockBackend';

// Clientul HTTP e înlocuit: testăm logica stării (revizii, răspunsuri vechi, reset, preset Eurasia, seek decolare), nu rețeaua.
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
  fetchScenarioTraffic.mockReset().mockImplementation((_signal?: AbortSignal, preset: TrafficPresetId = 'default') =>
    Promise.resolve(mockBackend.liveTraffic(preset)),
  );
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

  it('tick avansează doar în redare (inclusiv viteza ×300) și se oprește la final', async () => {
    const useApp = await freshStore();
    await useApp.getState().load();
    const { startSeconds, endSeconds } = useApp.getState().evaluation!.traffic;
    useApp.getState().tick(10);
    expect(useApp.getState().simTimeSeconds).toBe(startSeconds);
    useApp.getState().togglePlay();
    useApp.getState().setSpeed(60);
    useApp.getState().tick(1);
    expect(useApp.getState().simTimeSeconds).toBe(startSeconds + 60);
    useApp.getState().tick(1e6);
    expect(useApp.getState().simTimeSeconds).toBe(endSeconds);
    expect(useApp.getState().playing).toBe(false);
  });

  it('comută pe scenariul Eurasia Long-Haul (China ZBAA → LRCV), vedere continentală și permite seek la decolare', async () => {
    const useApp = await freshStore();
    await useApp.getState().load();
    expect(useApp.getState().showSectors).toBe(true);
    expect(useApp.getState().showAllRoutes).toBe(true);

    await useApp.getState().setTrafficPreset('eurasia');
    const s = useApp.getState();
    expect(s.scenario?.trafficPreset).toBe('eurasia');
    expect(s.view).toBe('continental');
    expect(s.timelineScope).toBe('mission');
    expect(s.evaluation?.traffic.flights.some((f) => f.id === 'CA-841' && f.origin.icao === 'ZBAA')).toBe(true);
    expect(s.simTimeSeconds).toBe(s.evaluation?.traffic.missionStartSeconds);

    // Revenim pe timeline 'approach', apoi facem seek la decolarea din Londra: timelineScope trece automat pe 'mission'
    useApp.getState().setTimelineScope('approach');
    expect(useApp.getState().simTimeSeconds).toBe(s.evaluation!.traffic.startSeconds);

    const londonFlight = s.evaluation!.traffic.flights.find((f) => f.id === 'W4-3751')!;
    useApp.getState().seek(londonFlight.takeoffSeconds);
    expect(useApp.getState().simTimeSeconds).toBe(londonFlight.takeoffSeconds);
    expect(useApp.getState().timelineScope).toBe('mission');
  });
});

async function proposedStore() {
  const useApp = await freshStore();
  await useApp.getState().load();
  const { minArrivalDistance } = await import('../sim/traffic');
  const traffic = useApp.getState().evaluation!.traffic;
  for (let t = traffic.startSeconds; t < traffic.endSeconds; t++) {
    const d = minArrivalDistance(traffic, t);
    if (d !== null && d <= 29 && d > 20) {
      useApp.getState().seek(t);
      return useApp;
    }
  }
  throw new Error('Scenariul de test nu traversează fereastra de propunere');
}

describe('poarta tactică 30–20 NM', () => {
  it('nu permite Accept înainte de propunere și nu aplică aterizările VFR implicit', async () => {
    const app = await freshStore();
    await app.getState().load();
    expect(app.getState().vfrPlan.status).toBe('idle');
    expect(app.getState().acceptVfrPlan()).toBe(false);
    expect(app.getState().evaluation!.traffic.flights.filter((f) => f.aircraft.flightRules === 'VFR')
      .every((f) => f.kind === 'hold' && f.resolvedLandingSeconds === null)).toBe(true);
  });

  it('acceptă o singură dată în fereastră și păstrează Accept după trecerea pragului', async () => {
    const app = await proposedStore();
    expect(app.getState().vfrPlan.status).toBe('proposed');
    expect(app.getState().acceptVfrPlan()).toBe(true);
    expect(app.getState().acceptVfrPlan()).toBe(false);
    expect(app.getState().rejectVfrPlan()).toBe(false);
    app.getState().seek(300);
    expect(app.getState().vfrPlan.status).toBe('accepted');
    expect(app.getState().evaluation!.traffic.flights.every((f) => f.resolvedLandingSeconds !== null)).toBe(true);
  });

  it('refuzul manual este definitiv pentru grup, inclusiv după seek înapoi', async () => {
    const app = await proposedStore();
    const t = app.getState().simTimeSeconds;
    expect(app.getState().rejectVfrPlan()).toBe(true);
    expect(app.getState().vfrPlan.rejectionReason).toBe('manual');
    app.getState().seek(app.getState().evaluation!.traffic.startSeconds);
    app.getState().seek(t);
    expect(app.getState().acceptVfrPlan()).toBe(false);
    app.getState().setWeatherPreset('west');
    expect(app.getState().vfrPlan.status).toBe('rejected');
    expect(app.getState().scenario!.weatherPresetId).toBe('calm');
  });

  it('un salt peste prag și peste aterizarea IFR declanșează Auto-Reject', async () => {
    const app = await freshStore();
    await app.getState().load();
    app.getState().seek(app.getState().evaluation!.traffic.endSeconds);
    expect(app.getState().vfrPlan.status).toBe('rejected');
    expect(app.getState().vfrPlan.rejectionReason).toBe('gate');
    expect(app.getState().acceptVfrPlan()).toBe(false);
  });

  it('redarea accelerată nu poate sări peste Auto-Reject', async () => {
    const app = await proposedStore();
    app.getState().setSpeed(60);
    app.getState().togglePlay();
    app.getState().tick(20);
    expect(app.getState().vfrPlan.status).toBe('rejected');
    expect(app.getState().vfrPlan.rejectionReason).toBe('gate');
  });

  it('Reset creează un grup nou; schimbarea traficului nu păstrează refuzul vechi', async () => {
    const app = await proposedStore();
    app.getState().rejectVfrPlan();
    app.getState().reset();
    await new Promise((r) => setTimeout(r, 0));
    expect(app.getState().vfrPlan.status).toBe('idle');
    expect(app.getState().playing).toBe(false);
    app.getState().seek(app.getState().evaluation!.traffic.endSeconds);
    await app.getState().setTrafficPreset('eurasia');
    expect(app.getState().vfrPlan.status).toBe('idle');
  });

  it('nu acceptă un plan cu revizie veche în timp ce se recalculează', async () => {
    const app = await proposedStore();
    evaluateCraiova.mockImplementation(() => new Promise(() => {}));
    app.getState().setWeatherPreset('west');
    expect(app.getState().acceptVfrPlan()).toBe(false);
    expect(app.getState().status).toBe('loading');
  });
});

describe('limitele exacte ale ferestrei tactice', () => {
  it('propune la exact 30 NM și blochează Accept la exact 20 NM', async () => {
    const app = await freshStore();
    await app.getState().load();
    const { destination } = await import('../sim/geomath');
    const { ARP } = await import('../data/geo');
    const evaluation = app.getState().evaluation!;
    const ifr = evaluation.traffic.flights.find((f) => f.aircraft.flightRules === 'IFR')!;
    const vfr = evaluation.traffic.flights.filter((f) => f.aircraft.flightRules === 'VFR');
    const track = [35, 30, 20, 0].map((distance, i) => {
      const p = destination(ARP, 0, distance);
      return { timeSeconds: i * 100, latitudeDeg: p.lat, longitudeDeg: p.lon, altitudeMeters: 1700, source: 'synthetic' as const };
    });
    app.setState({ simTimeSeconds: 0, evaluation: { ...evaluation, traffic: { ...evaluation.traffic,
      flights: [{ ...ifr, track, takeoffSeconds: 0, resolvedLandingSeconds: 300 }, ...vfr] } } });
    app.getState().seek(100);
    expect(app.getState().minDistanceToLrcvNm).toBe(30);
    expect(app.getState().vfrPlan.status).toBe('proposed');
    app.getState().seek(200);
    expect(app.getState().minDistanceToLrcvNm).toBe(20);
    expect(app.getState().vfrPlan.status).toBe('rejected');
    expect(app.getState().acceptVfrPlan()).toBe(false);
  });
});
