// Starea paginii Live: poziții OpenSky și METAR, cu interogare periodică.
import { create } from 'zustand';
import { ApiError, fetchLivePositions, fetchMetar, fetchVfrTracking } from '../api/client';
import type { LivePositions, Metar, VfrTracking } from '../contracts/live';

/**
 * OpenSky anonim dă 400 de credite pe zi; un apel pe zona Craiova costă 1 credit.
 * La 15 s ajung pentru ~100 de minute de pagină deschisă pe zi.
 * METAR-ul este și partajat în cache-ul backendului; tab-urile nu provoacă cereri dese către sursa meteo.
 */
export const POSITIONS_EVERY_MS = 15_000;
export const METAR_EVERY_MS = 5 * 60_000;

interface LiveState {
  positions: LivePositions | null;
  metar: Metar | null;
  vfrTracking: VfrTracking | null;
  positionsError: string | null;
  metarError: string | null;
  vfrTrackingError: string | null;
  updatedAtMs: number | null;
  selectedIcao: string | null;
  select: (icao: string | null) => void;
  /** Direcțiile estimate (vectorul de 5 minute) pentru toate avioanele; oprit implicit, sunt doar estimări. */
  showRoutes: boolean;
  setShowRoutes: (show: boolean) => void;
  /** Pornește interogarea; întoarce funcția de oprire. Se oprește singură cât tab-ul e ascuns. */
  start: () => () => void;
}

const message = (e: unknown) => (e instanceof ApiError ? e.message : 'Serviciul de date reale nu răspunde.');

export const useLive = create<LiveState>()((set, get) => {
  let lastMetarRequestAtMs: number | null = null;
  let lastPositionsRequestAtMs: number | null = null;
  async function loadPositions() {
    // Revenirea în tab cere imediat, dar nu mai des decât intervalul: schimbările dese de tab ar consuma cota OpenSky.
    const now = Date.now();
    if (lastPositionsRequestAtMs !== null && now - lastPositionsRequestAtMs < POSITIONS_EVERY_MS - 1000) return;
    lastPositionsRequestAtMs = now;
    try {
      const positions = await fetchLivePositions();
      // Două cereri pot fi în zbor deodată (de ex. la revenirea în tab); un răspuns mai vechi
      // decât cel afișat ar muta avioanele înapoi, deci îl ignorăm.
      const shown = get().positions;
      if (shown && Date.parse(positions.queryTimeUtc) < Date.parse(shown.queryTimeUtc)) return;
      set({ positions, positionsError: null, updatedAtMs: Date.now() });
    } catch (e) {
      set({ positionsError: message(e) });
    }
  }
  async function loadMetar() {
    const now = Date.now();
    if (lastMetarRequestAtMs !== null && now - lastMetarRequestAtMs < METAR_EVERY_MS) return;
    lastMetarRequestAtMs = now;
    try {
      set({ metar: await fetchMetar(), metarError: null });
    } catch (e) {
      set({ metarError: message(e) });
    }
    try {
      const runway = get().metar?.windDirectionDegrees != null && get().metar!.windDirectionDegrees! >= 180 ? '26' : '08';
      const vfrTracking = await fetchVfrTracking(runway);
      set({ vfrTracking, positions: vfrTracking, vfrTrackingError: null, updatedAtMs: Date.now() });
    } catch (e) {
      set({ vfrTrackingError: message(e) });
    }
  }

  return {
    positions: null,
    metar: null,
    vfrTracking: null,
    positionsError: null,
    metarError: null,
    vfrTrackingError: null,
    updatedAtMs: null,
    selectedIcao: null,
    select: (selectedIcao) => set({ selectedIcao }),
    showRoutes: false,
    setShowRoutes: (showRoutes) => set({ showRoutes }),
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
