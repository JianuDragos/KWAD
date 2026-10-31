// Starea paginii Live: poziții OpenSky și METAR, cu interogare periodică.
import { create } from 'zustand';
import { ApiError, fetchLivePositions, fetchMetar } from '../api/client';
import type { LivePositions, Metar } from '../contracts/live';

/**
 * OpenSky anonim dă 400 de credite pe zi; un apel pe zona Craiova costă 1 credit.
 * La 15 s ajung pentru ~100 de minute de pagină deschisă pe zi.
 * shortcut: fără cache în backend, fiecare tab deschis consumă separat; de mutat cache-ul în backend.
 */
export const POSITIONS_EVERY_MS = 15_000;
export const METAR_EVERY_MS = 5 * 60_000;

interface LiveState {
  positions: LivePositions | null;
  metar: Metar | null;
  positionsError: string | null;
  metarError: string | null;
  updatedAtMs: number | null;
  selectedIcao: string | null;
  select: (icao: string | null) => void;
  /** Pornește interogarea; întoarce funcția de oprire. Se oprește singură cât tab-ul e ascuns. */
  start: () => () => void;
}

const message = (e: unknown) => (e instanceof ApiError ? e.message : 'Serviciul de date reale nu răspunde.');

export const useLive = create<LiveState>()((set) => {
  async function loadPositions() {
    try {
      const positions = await fetchLivePositions();
      set({ positions, positionsError: null, updatedAtMs: Date.now() });
    } catch (e) {
      set({ positionsError: message(e) });
    }
  }
  async function loadMetar() {
    try {
      set({ metar: await fetchMetar(), metarError: null });
    } catch (e) {
      set({ metarError: message(e) });
    }
  }

  return {
    positions: null,
    metar: null,
    positionsError: null,
    metarError: null,
    updatedAtMs: null,
    selectedIcao: null,
    select: (selectedIcao) => set({ selectedIcao }),
    start: () => {
      let timers: number[] = [];
      const run = () => {
        timers.forEach(clearInterval);
        timers = [];
        if (document.visibilityState !== 'visible') return;
        void loadPositions();
        void loadMetar();
        timers = [window.setInterval(loadPositions, POSITIONS_EVERY_MS), window.setInterval(loadMetar, METAR_EVERY_MS)];
      };
      run();
      document.addEventListener('visibilitychange', run);
      return () => {
        timers.forEach(clearInterval);
        document.removeEventListener('visibilitychange', run);
      };
    },
  };
});
