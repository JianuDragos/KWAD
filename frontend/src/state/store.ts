// Starea comună pentru hartă, panou și timeline (un singur proprietar: Radu; Daha propune schimbări).
import { create } from 'zustand';
import type { CraiovaAircraft, CraiovaSimulationResult, TrafficPresetId, WeatherCondition } from '../contracts/backend';
import { ApiError, evaluateCraiova, fetchScenarioTraffic } from '../api/client';
import { FALLBACK_FIRS, loadFirsDataset, type FirEntry } from '../data/airspace';
import { DEFAULT_PRESET_ID, WEATHER_PRESETS } from '../data/weatherPresets';
import { buildTacticalTraffic, minArrivalDistance, type TrafficModel, type VfrPlan } from '../sim/traffic';

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
  vfrPlan: VfrPlan;
  minDistanceToLrcvNm: number | null;

  simTimeSeconds: number;
  playing: boolean;
  speed: Speed;
  selectedId: string | null;
  view: MapViewPreset;
  viewNonce: number;
  showSectors: boolean;
  showAllRoutes: boolean;
  /** Legenda culorilor de altitudine pe hartă; se pornește din Setări. */
  showAltitudeLegend: boolean;
  timelineScope: TimelineScope;

  load: () => Promise<void>;
  setTrafficPreset: (preset: TrafficPresetId) => Promise<void>;
  setWeatherPreset: (id: string) => void;
  acceptVfrPlan: () => boolean;
  rejectVfrPlan: () => boolean;
  reset: () => void;
  tick: (dtRealSeconds: number) => void;
  togglePlay: () => void;
  setSpeed: (s: Speed) => void;
  seek: (t: number) => void;
  select: (id: string | null) => void;
  setView: (v: MapViewPreset) => void;
  setShowSectors: (show: boolean) => void;
  setShowAllRoutes: (show: boolean) => void;
  setShowAltitudeLegend: (show: boolean) => void;
  setTimelineScope: (scope: TimelineScope) => void;
}

const newVfrPlan = (): VfrPlan => ({ status: 'idle', acceptedAtSeconds: null, rejectionReason: null });

let inFlight: AbortController | null = null;

export const useApp = create<AppState>()((set, get) => {
  function updateClock(t: number, from = get().simTimeSeconds) {
    const s = get();
    const traffic = s.evaluation?.traffic;
    if (!traffic || s.evaluation?.revision !== s.scenario?.revision) {
      set({ simTimeSeconds: t });
      return;
    }
    const distance = minArrivalDistance(traffic, t);
    const crossedDistance = minArrivalDistance(traffic, t, from);
    let vfrPlan = s.vfrPlan;
    if ((vfrPlan.status === 'idle' || vfrPlan.status === 'proposed') &&
        traffic.flights.some((f) => f.aircraft.flightRules === 'VFR') && crossedDistance !== null) {
      if (crossedDistance <= 20) vfrPlan = { ...vfrPlan, status: 'rejected', rejectionReason: 'gate' };
      else if (crossedDistance <= 30) vfrPlan = { ...vfrPlan, status: 'proposed' };
    }
    set({ simTimeSeconds: t, minDistanceToLrcvNm: distance, vfrPlan });
  }

  async function evaluate(scenario: Scenario, resetClock: boolean) {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    set({ status: 'loading', error: null });
    try {
      const result = await evaluateCraiova({ weather: scenario.weather, aircrafts: scenario.aircrafts, useTrajectoryEngine: true }, controller.signal);
      // Răspuns pentru o revizie veche: îl ignorăm.
      if (get().scenario?.revision !== scenario.revision) return;
      const traffic = buildTacticalTraffic(scenario.aircrafts, result, get().firs, get().vfrPlan);
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
      updateClock(get().simTimeSeconds, get().simTimeSeconds);
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
    vfrPlan: newVfrPlan(),
    minDistanceToLrcvNm: null,
    simTimeSeconds: 0,
    playing: false,
    speed: 10,
    selectedId: null,
    view: 'wide',
    viewNonce: 0,
    showSectors: true,
    showAltitudeLegend: false,
    showAllRoutes: true,
    timelineScope: 'approach',

    load: async () => {
      set({ status: 'loading', error: null });
      void loadFirsDataset().then((ds) => {
        if (ds.firs.length > FALLBACK_FIRS.length) {
          set((s) => {
            if (!s.evaluation || !s.scenario) return { firs: ds.firs };
            const updatedTraffic = buildTacticalTraffic(s.scenario.aircrafts, s.evaluation.result, ds.firs, s.vfrPlan);
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
        set({ scenario, initialScenario: scenario, vfrPlan: newVfrPlan(), minDistanceToLrcvNm: null });
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
      set({ status: 'loading', error: null, playing: false, selectedId: null, vfrPlan: newVfrPlan(), minDistanceToLrcvNm: null });
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
      if (get().vfrPlan.status === 'accepted' || get().vfrPlan.status === 'rejected') return;
      const current = get().scenario;
      const preset = WEATHER_PRESETS.find((p) => p.id === id);
      if (!current || !preset) return;
      const scenario = { ...current, revision: current.revision + 1, weatherPresetId: id, weather: preset.weather };
      set({ scenario });
      void evaluate(scenario, false);
    },

    acceptVfrPlan: () => {
      updateClock(get().simTimeSeconds);
      const s = get();
      const distance = s.minDistanceToLrcvNm;
      if (s.status !== 'ok' || !s.scenario || !s.evaluation || s.evaluation.revision !== s.scenario.revision ||
          s.vfrPlan.status !== 'proposed' || distance === null || distance <= 20 || distance > 30) return false;
      const vfrPlan: VfrPlan = { status: 'accepted', acceptedAtSeconds: s.simTimeSeconds, rejectionReason: null };
      const traffic = buildTacticalTraffic(s.scenario.aircrafts, s.evaluation.result, s.firs, vfrPlan);
      set({ vfrPlan, evaluation: { ...s.evaluation, traffic } });
      return true;
    },

    rejectVfrPlan: () => {
      updateClock(get().simTimeSeconds);
      if (get().vfrPlan.status !== 'proposed') return false;
      set({ vfrPlan: { status: 'rejected', acceptedAtSeconds: null, rejectionReason: 'manual' } });
      return true;
    },

    reset: () => {
      const initial = get().initialScenario;
      if (!initial) return;
      const scenario = { ...initial, revision: (get().scenario?.revision ?? 0) + 1 };
      set({ scenario, playing: false, selectedId: null, timelineScope: 'approach', vfrPlan: newVfrPlan(), minDistanceToLrcvNm: null });
      void evaluate(scenario, true);
    },

    tick: (dt) => {
      const { playing, speed, evaluation, simTimeSeconds, status, scenario } = get();
      if (!playing || !evaluation || status !== 'ok' || evaluation.revision !== scenario?.revision) return;
      const next = simTimeSeconds + dt * speed;
      updateClock(Math.min(next, evaluation.traffic.endSeconds));
      if (next >= evaluation.traffic.endSeconds) set({ playing: false });
    },
    togglePlay: () => set((s) => ({ playing: !s.playing })),
    setSpeed: (speed) => set({ speed }),
    seek: (t) => {
      if (get().status !== 'ok') return;
      const ev = get().evaluation;
      if (!ev) return;
      const minSeek = Math.min(ev.traffic.missionStartSeconds, ev.traffic.startSeconds);
      const clamped = clamp(t, minSeek, ev.traffic.endSeconds);
      updateClock(clamped);
      if (clamped < ev.traffic.startSeconds - 60) set({ timelineScope: 'mission' });
    },
    select: (selectedId) => set({ selectedId }),
    setView: (view) => set((s) => ({ view, viewNonce: s.viewNonce + 1 })),
    setShowSectors: (showSectors) => set({ showSectors }),
    setShowAllRoutes: (showAllRoutes) => set({ showAllRoutes }),
    setShowAltitudeLegend: (showAltitudeLegend) => set({ showAltitudeLegend }),
    setTimelineScope: (timelineScope) => {
      set({ timelineScope });
      const { evaluation, simTimeSeconds } = get();
      if (evaluation && timelineScope === 'approach' && simTimeSeconds < evaluation.traffic.startSeconds) {
        updateClock(evaluation.traffic.startSeconds);
      }
    },
  };
});

/** Rezultatul afișat aparține altei revizii decât scenariul curent (se recalculează). */
export function useIsStale(): boolean {
  return useApp((s) => !!s.evaluation && !!s.scenario && s.evaluation.revision !== s.scenario.revision);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
