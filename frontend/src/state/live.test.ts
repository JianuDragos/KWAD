import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as mockLive from '../api/mockLive';

// Clientul HTTP e înlocuit: testăm ritmul interogărilor, pauza și erorile, nu rețeaua.
vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {},
  fetchLivePositions: vi.fn(),
  fetchMetar: vi.fn(),
}));

// Testele rulează în Node: un `document` minim, cu vizibilitate controlabilă.
const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
const setVisibility = (v: DocumentVisibilityState) => {
  doc.visibilityState = v;
  doc.dispatchEvent(new Event('visibilitychange'));
};

async function freshStore() {
  vi.resetModules();
  const client = await import('../api/client');
  const positions = vi.mocked(client.fetchLivePositions).mockResolvedValue(mockLive.livePositions());
  const metar = vi.mocked(client.fetchMetar).mockResolvedValue(mockLive.metar());
  const { useLive, POSITIONS_EVERY_MS, METAR_EVERY_MS } = await import('./live');
  return { useLive, positions, metar, client, POSITIONS_EVERY_MS, METAR_EVERY_MS };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', globalThis);
  doc.visibilityState = 'visible';
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useLive', () => {
  it('cere imediat, apoi pozițiile la 15 s și METAR-ul la 5 min', async () => {
    const { useLive, positions, metar, POSITIONS_EVERY_MS, METAR_EVERY_MS } = await freshStore();
    const stop = useLive.getState().start();
    expect(positions).toHaveBeenCalledTimes(1);
    expect(metar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POSITIONS_EVERY_MS * 2);
    expect(positions).toHaveBeenCalledTimes(3);
    expect(metar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(METAR_EVERY_MS);
    expect(metar).toHaveBeenCalledTimes(2);
    stop();
  });

  it('nu cere nimic cât tab-ul e ascuns și reia imediat la revenire (cota OpenSky)', async () => {
    const { useLive, positions, POSITIONS_EVERY_MS } = await freshStore();
    const stop = useLive.getState().start();
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(POSITIONS_EVERY_MS * 10);
    expect(positions).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    expect(positions).toHaveBeenCalledTimes(2);
    stop();
  });

  it('după oprire nu mai cere nimic', async () => {
    const { useLive, positions, POSITIONS_EVERY_MS } = await freshStore();
    useLive.getState().start()();
    await vi.advanceTimersByTimeAsync(POSITIONS_EVERY_MS * 4);
    setVisibility('visible');
    expect(positions).toHaveBeenCalledTimes(1);
  });

  it('o eroare păstrează ultimele poziții și o raportează', async () => {
    const { useLive, positions, client, POSITIONS_EVERY_MS } = await freshStore();
    const stop = useLive.getState().start();
    await vi.advanceTimersByTimeAsync(0);
    const first = useLive.getState().positions;
    expect(first).not.toBeNull();
    positions.mockRejectedValue(new client.ApiError('Serviciul de planificare nu răspunde.', 0));
    await vi.advanceTimersByTimeAsync(POSITIONS_EVERY_MS);
    expect(useLive.getState().positions).toBe(first);
    expect(useLive.getState().positionsError).toBe('Serviciul de planificare nu răspunde.');
    stop();
  });
});
