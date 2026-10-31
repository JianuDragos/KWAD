// Starea comună pentru hartă, panou și timeline (un singur proprietar: Radu; Daha propune schimbări).
import { create } from 'zustand';
import type { CraiovaAircraft, CraiovaSimulationResult, WeatherCondition } from '../contracts/backend';
import { ApiError, evaluateCraiova, fetchScenarioTraffic } from '../api/client';
import { DEFAULT_PRESET_ID, WEATHER_PRESETS } from '../data/weatherPresets';
import { buildTraffic, type TrafficModel } from '../sim/traffic';

export const SPEEDS = [1, 5, 10, 30] as const;
export type Speed = (typeof SPEEDS)[number];

/** Backendul calculează orele față de o bază fixă „14:00” (ScenarioRules.BaseTimeOffsetSeconds), fără dată. */
export const BASE_TIME_OFFSET_SECONDS = 50400;

type LoadStatus = 'idle' | 'loading' | 'ok' | 'error';

export interface Scenario {
  /** Crește la fiecare modificare; rezultatele cu altă revizie sunt depășite. */
  revision: number;
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

  useTrajectoryEngine: boolean;
  setUseTrajectoryEngine: (enabled: boolean) => void;

  simTimeSeconds: number;
  playing: boolean;
  speed: Speed;
  selectedId: string | null;
  view: 'wide' | 'close';
  basemap: 'none' | 'osm';

  load: () => Promise<void>;
  setWeatherPreset: (id: string) => void;
  reset: () => void;
  tick: (dtRealSeconds: number) => void;
  togglePlay: () => void;
  setSpeed: (s: Speed) => void;
  seek: (t: number) => void;
  select: (id: string | null) => void;
  setView: (v: 'wide' | 'close') => void;
  setBasemap: (b: 'none' | 'osm') => void;
}

let inFlight: AbortController | null = null;

export const useApp = create<AppState>()((set, get) => {
  async function evaluate(scenario: Scenario, resetClock: boolean) {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    set({ status: 'loading', error: null });
    try {
      const useTraj = get().useTrajectoryEngine;
      const result = await evaluateCraiova({ weather: scenario.weather, aircrafts: scenario.aircrafts, useTrajectoryEngine: useTraj }, controller.signal);
      // Răspuns pentru o revizie veche: îl ignorăm.
      if (get().scenario?.revision !== scenario.revision) return;
      const traffic = buildTraffic(scenario.aircrafts, result, useTraj);
      set((s) => ({
        status: 'ok',
        evaluation: { revision: scenario.revision, result, traffic },
        simTimeSeconds: resetClock ? traffic.startSeconds : clamp(s.simTimeSeconds, traffic.startSeconds, traffic.endSeconds),
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
    useTrajectoryEngine: true,
    simTimeSeconds: 0,
    playing: false,
    speed: 5,
    selectedId: null,
    view: 'wide',
    basemap: 'none',

    load: async () => {
      set({ status: 'loading', error: null });
      try {
        const live = await fetchScenarioTraffic();
        const preset = WEATHER_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!;
        const scenario: Scenario = { revision: 1, aircrafts: live.traffic, weatherPresetId: preset.id, weather: preset.weather, source: live.source };
        set({ scenario, initialScenario: scenario });
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

    setUseTrajectoryEngine: (enabled) => {
      const current = get().scenario;
      if (!current) {
        set({ useTrajectoryEngine: enabled });
        return;
      }
      const scenario = { ...current, revision: current.revision + 1 };
      set({ useTrajectoryEngine: enabled, scenario });
      void evaluate(scenario, false);
    },

    reset: () => {
      const initial = get().initialScenario;
      if (!initial) return;
      const scenario = { ...initial, revision: (get().scenario?.revision ?? 0) + 1 };
      set({ scenario, playing: false, selectedId: null });
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
      if (ev) set({ simTimeSeconds: clamp(t, ev.traffic.startSeconds, ev.traffic.endSeconds) });
    },
    select: (selectedId) => set({ selectedId }),
    setView: (view) => set({ view }),
    setBasemap: (basemap) => set({ basemap }),
  };
});

/** Rezultatul afișat aparține altei revizii decât scenariul curent (se recalculează). */
export function useIsStale(): boolean {
  return useApp((s) => !!s.evaluation && !!s.scenario && s.evaluation.revision !== s.scenario.revision);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
