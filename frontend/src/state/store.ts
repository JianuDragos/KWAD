// Starea comună pentru hartă, panou și timeline (un singur proprietar: Radu; Daha propune schimbări).
import { create } from 'zustand';
import type { CraiovaAircraft, CraiovaSimulationResult, TrafficPresetId, WeatherCondition } from '../contracts/backend';
import { ApiError, evaluateCraiova, fetchScenarioTraffic } from '../api/client';
import { FALLBACK_FIRS, loadFirsDataset, type FirEntry } from '../data/airspace';
import { DEFAULT_PRESET_ID, WEATHER_PRESETS } from '../data/weatherPresets';
import { buildTraffic, type TrafficModel } from '../sim/traffic';

export const SPEEDS = [1, 10, 60] as const;
export type Speed = (typeof SPEEDS)[number];
export type MapViewPreset = 'continental' | 'wide' | 'close';
export type TimelineScope = 'approach' | 'mission';

/** Backendul calculează orele față de o bază fixă „14:00” (ScenarioRules.BaseTimeOffsetSeconds), fără dată. */
export const BASE_TIME_OFFSET_SECONDS = 50400;

type LoadStatus = 'idle' | 'loading' | 'ok' | 'error';

export interface Scenario {
  /** Crește la fiecare modificare; rezultatele cu altă revizie sunt depășite. */
  revision: number;
  trafficPreset: TrafficPresetId;
  aircrafts: CraiovaAircraft[];
  weatherPresetId: string;
  weather: WeatherCondition;
  source: string;
}

interface Evaluation {
  revision: number;
  result: CraiovaSimulationResult;
  traffic: TrafficModel;
}

interface AppState {
  scenario: Scenario | null;
  initialScenario: Scenario | null;
  status: LoadStatus;
  error: string | null;
  evaluation: Evaluation | null;
  firs: FirEntry[];

  simTimeSeconds: number;
  playing: boolean;
  speed: Speed;
  selectedId: string | null;
  view: MapViewPreset;
  viewNonce: number;
  showSectors: boolean;
  showAllRoutes: boolean;
  timelineScope: TimelineScope;

  load: () => Promise<void>;
  setTrafficPreset: (preset: TrafficPresetId) => Promise<void>;
  setWeatherPreset: (id: string) => void;
  reset: () => void;
  tick: (dtRealSeconds: number) => void;
  togglePlay: () => void;
  setSpeed: (s: Speed) => void;
  seek: (t: number) => void;
  select: (id: string | null) => void;
  setView: (v: MapViewPreset) => void;
  setShowSectors: (show: boolean) => void;
  setShowAllRoutes: (show: boolean) => void;
  setTimelineScope: (scope: TimelineScope) => void;
}

let inFlight: AbortController | null = null;

export const useApp = create<AppState>()((set, get) => {
  async function evaluate(scenario: Scenario, resetClock: boolean) {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    set({ status: 'loading', error: null });
    try {
      const result = await evaluateCraiova({ weather: scenario.weather, aircrafts: scenario.aircrafts, useTrajectoryEngine: true }, controller.signal);
      // Răspuns pentru o revizie veche: îl ignorăm.
      if (get().scenario?.revision !== scenario.revision) return;
      const traffic = buildTraffic(scenario.aircrafts, result, get().firs);
      const minSeek = Math.min(traffic.missionStartSeconds, traffic.startSeconds);
      set((s) => ({
        status: 'ok',
        evaluation: { revision: scenario.revision, result, traffic },
        simTimeSeconds: resetClock
          ? s.timelineScope === 'mission'
            ? traffic.missionStartSeconds
            : traffic.startSeconds
          : clamp(s.simTimeSeconds, minSeek, traffic.endSeconds),
      }));
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      set({ status: 'error', error: e instanceof ApiError ? e.message : String(e) });
    }
  }

  return {
    scenario: null,
    initialScenario: null,
    status: 'idle',
    error: null,
    evaluation: null,
    firs: FALLBACK_FIRS,
    simTimeSeconds: 0,
    playing: false,
    speed: 10,
    selectedId: null,
    view: 'wide',
    viewNonce: 0,
    showSectors: true,
    showAllRoutes: true,
    timelineScope: 'approach',

    load: async () => {
      set({ status: 'loading', error: null });
      void loadFirsDataset().then((ds) => {
        if (ds.firs.length > FALLBACK_FIRS.length) {
          set((s) => {
            if (!s.evaluation || !s.scenario) return { firs: ds.firs };
            const updatedTraffic = buildTraffic(s.scenario.aircrafts, s.evaluation.result, ds.firs);
            return { firs: ds.firs, evaluation: { ...s.evaluation, traffic: updatedTraffic } };
          });
        }
      });

      try {
        const live = await fetchScenarioTraffic();
        const preset = WEATHER_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!;
        const scenario: Scenario = {
          revision: 1,
          trafficPreset: 'default',
          aircrafts: live.traffic,
          weatherPresetId: preset.id,
          weather: preset.weather,
          source: live.source,
        };
        set({ scenario, initialScenario: scenario });
        await evaluate(scenario, true);
      } catch (e) {
        set({ status: 'error', error: e instanceof ApiError ? e.message : String(e) });
      }
    },

    setTrafficPreset: async (trafficPreset) => {
      const current = get().scenario;
      const weatherPresetId = current?.weatherPresetId ?? DEFAULT_PRESET_ID;
      const weather = current?.weather ?? WEATHER_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!.weather;
      const nextRev = (current?.revision ?? 0) + 1;
      set({ status: 'loading', error: null, playing: false, selectedId: null });
      try {
        const live = await fetchScenarioTraffic(undefined, trafficPreset);
        const scenario: Scenario = {
          revision: nextRev,
          trafficPreset,
          aircrafts: live.traffic,
          weatherPresetId,
          weather,
          source: live.source,
        };
        const nextView: MapViewPreset = trafficPreset === 'eurasia' ? 'continental' : 'wide';
        set((s) => ({
          scenario,
          view: nextView,
          viewNonce: s.viewNonce + 1,
          timelineScope: trafficPreset === 'eurasia' ? 'mission' : s.timelineScope,
        }));
        await evaluate(scenario, true);
      } catch (e) {
        set({ status: 'error', error: e instanceof ApiError ? e.message : String(e) });
      }
    },

    setWeatherPreset: (id) => {
      const current = get().scenario;
      const preset = WEATHER_PRESETS.find((p) => p.id === id);
      if (!current || !preset) return;
      const scenario = { ...current, revision: current.revision + 1, weatherPresetId: id, weather: preset.weather };
      set({ scenario });
      void evaluate(scenario, false);
    },

    reset: () => {
      const initial = get().initialScenario;
      if (!initial) return;
      const scenario = { ...initial, revision: (get().scenario?.revision ?? 0) + 1 };
      set({ scenario, playing: false, selectedId: null, timelineScope: 'approach' });
      void evaluate(scenario, true);
    },

    tick: (dt) => {
      const { playing, speed, evaluation, simTimeSeconds } = get();
      if (!playing || !evaluation) return;
      const next = simTimeSeconds + dt * speed;
      if (next >= evaluation.traffic.endSeconds) set({ simTimeSeconds: evaluation.traffic.endSeconds, playing: false });
      else set({ simTimeSeconds: next });
    },
    togglePlay: () => set((s) => ({ playing: !s.playing })),
    setSpeed: (speed) => set({ speed }),
    seek: (t) => {
      const ev = get().evaluation;
      if (!ev) return;
      const minSeek = Math.min(ev.traffic.missionStartSeconds, ev.traffic.startSeconds);
      const clamped = clamp(t, minSeek, ev.traffic.endSeconds);
      set((s) => ({
        simTimeSeconds: clamped,
        timelineScope: clamped < ev.traffic.startSeconds - 60 ? 'mission' : s.timelineScope,
      }));
    },
    select: (selectedId) => set({ selectedId }),
    setView: (view) => set((s) => ({ view, viewNonce: s.viewNonce + 1 })),
    setShowSectors: (showSectors) => set({ showSectors }),
    setShowAllRoutes: (showAllRoutes) => set({ showAllRoutes }),
    setTimelineScope: (timelineScope) =>
      set((s) => {
        if (!s.evaluation) return { timelineScope };
        if (timelineScope === 'approach' && s.simTimeSeconds < s.evaluation.traffic.startSeconds) {
          return { timelineScope, simTimeSeconds: s.evaluation.traffic.startSeconds };
        }
        return { timelineScope };
      }),
  };
});

/** Rezultatul afișat aparține altei revizii decât scenariul curent (se recalculează). */
export function useIsStale(): boolean {
  return useApp((s) => !!s.evaluation && !!s.scenario && s.evaluation.revision !== s.scenario.revision);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
