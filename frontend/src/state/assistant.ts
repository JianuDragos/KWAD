// Starea persistentă a tab-ului „Asistent”: conversație multi-turn ATC, selecție sursă (Simulare vs. Trafic real) și verificare C#.
import { create } from 'zustand';
import { ApiError, explain, type ExplainContext } from '../api/client';
import type { Explanation } from '../contracts/live';
import { setMode } from './mode';
import { useApp } from './store';

export type AssistantContextSource = 'demo' | 'live';

export interface AssistantMessage {
  id: string;
  role: 'controller' | 'assistant';
  text: string;
  contextSource: AssistantContextSource;
  createdAtLabel: string;
  explanation?: Explanation;
  isError?: boolean;
}

export type VfrApproachRecommendationStatus = 'pending' | 'accepted' | 'rejected';

export interface VfrApproachRecommendation {
  status: VfrApproachRecommendationStatus;
  rejectionNotice: string | null;
  dismissed: boolean;
  timestamp: string | null;
}

interface AssistantState {
  messages: AssistantMessage[];
  contextSource: AssistantContextSource;
  busy: boolean;
  draft: string;
  vfrRecommendation: VfrApproachRecommendation;

  setContextSource: (source: AssistantContextSource) => void;
  setDraft: (draft: string) => void;
  clearHistory: () => void;
  sendPrompt: (question: string, forceSource?: AssistantContextSource) => Promise<void>;
  openWithQuestion: (question: string, source: AssistantContextSource) => void;
  acceptVfrApproachRecommendation: () => void;
  rejectVfrApproachRecommendation: () => void;
  resetVfrApproachRecommendation: () => void;
  dismissVfrNotificationBanner: () => void;
}

let activeController: AbortController | null = null;
let msgCounter = 0;

function nowTimeLabel(): string {
  return new Date().toTimeString().slice(0, 8);
}

export const useAssistant = create<AssistantState>()((set, get) => ({
  messages: [],
  contextSource: 'demo',
  busy: false,
  draft: '',
  vfrRecommendation: {
    status: 'pending',
    rejectionNotice: null,
    dismissed: false,
    timestamp: null,
  },

  setContextSource: (contextSource) => set({ contextSource }),
  setDraft: (draft) => set({ draft }),
  clearHistory: () => {
    activeController?.abort();
    set({ messages: [], busy: false });
  },

  acceptVfrApproachRecommendation: () => {
    const acceptNotice =
      'S-a acceptat recomandarea Asistentului: aeronavele VFR vor urma procedura optimă de apropiere și eșalonare.';
    const userMsg: AssistantMessage = {
      id: `msg-${++msgCounter}`,
      role: 'controller',
      text: acceptNotice,
      contextSource: get().contextSource,
      createdAtLabel: nowTimeLabel(),
    };
    useApp.getState().clearVfrOverrides();
    set((s) => ({
      vfrRecommendation: {
        status: 'accepted',
        rejectionNotice: null,
        dismissed: false,
        timestamp: nowTimeLabel(),
      },
      messages: [...s.messages, userMsg],
    }));
  },

  rejectVfrApproachRecommendation: () => {
    const rejectionNotice = 'S-a refuzat recomandarea si se vor urma indicatiile controlorului de trafic aerian';
    const userMsg: AssistantMessage = {
      id: `msg-${++msgCounter}`,
      role: 'controller',
      text: rejectionNotice,
      contextSource: get().contextSource,
      createdAtLabel: nowTimeLabel(),
    };
    set((s) => ({
      vfrRecommendation: {
        status: 'rejected',
        rejectionNotice,
        dismissed: false,
        timestamp: nowTimeLabel(),
      },
      messages: [...s.messages, userMsg],
    }));
  },

  resetVfrApproachRecommendation: () => {
    set({
      vfrRecommendation: {
        status: 'pending',
        rejectionNotice: null,
        dismissed: false,
        timestamp: null,
      },
    });
  },

  dismissVfrNotificationBanner: () => {
    set((s) => ({
      vfrRecommendation: {
        ...s.vfrRecommendation,
        dismissed: true,
      },
    }));
  },

  sendPrompt: async (rawQuestion, forceSource) => {
    const question = rawQuestion.trim();
    if (!question) return;

    const source = forceSource ?? get().contextSource;
    if (forceSource) set({ contextSource: forceSource });

    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;

    const userMsg: AssistantMessage = {
      id: `msg-${++msgCounter}`,
      role: 'controller',
      text: question,
      contextSource: source,
      createdAtLabel: nowTimeLabel(),
    };

    set((s) => ({
      messages: [...s.messages, userMsg],
      busy: true,
      draft: s.draft.trim() === question ? '' : s.draft,
    }));

    let explainContext: ExplainContext | undefined;
    if (source === 'demo') {
      const appState = useApp.getState();
      explainContext = {
        weather: appState.scenario?.weather,
        aircrafts: appState.scenario?.aircrafts,
        evaluationResult: appState.evaluation?.result,
      };
    }

    try {
      const res = await explain(question, controller.signal, explainContext);
      if (activeController !== controller) return;
      const primaryText = res.directAnswer?.trim() || res.sentences.join(' ');
      const aiMsg: AssistantMessage = {
        id: `msg-${++msgCounter}`,
        role: 'assistant',
        text: primaryText,
        contextSource: source,
        createdAtLabel: nowTimeLabel(),
        explanation: res,
      };
      set((s) => ({ messages: [...s.messages, aiMsg], busy: false }));
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      const errText = e instanceof ApiError ? e.message : 'Analiza tactică nu a putut fi obținută de la backend.';
      const errMsg: AssistantMessage = {
        id: `msg-${++msgCounter}`,
        role: 'assistant',
        text: errText,
        contextSource: source,
        createdAtLabel: nowTimeLabel(),
        isError: true,
      };
      set((s) => ({ messages: [...s.messages, errMsg], busy: false }));
    }
  },

  openWithQuestion: (question, source) => {
    set({ contextSource: source });
    setMode('assistant');
    void get().sendPrompt(question, source);
  },
}));
