import type {
  CraiovaCustomEvaluationRequest,
  CraiovaSimulationResult,
  EvaluationRequest,
  LiveTrafficResponse,
  PlanningResponse,
} from '../contracts/backend';
import * as mock from './mockBackend';

export const API_MOCK = import.meta.env.VITE_API_MOCK === '1';

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...init.headers } });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('Backendul nu răspunde. Pornește „AERIS API” (dotnet run) sau rulează frontendul cu npm run dev:mock.', 0);
  }
  if (!response.ok) {
    // Backendul are două formate de eroare: { error } (validare scenariu) și ProblemDetails (JSON invalid).
    const body = await response.json().catch(() => null);
    if (!body && response.status >= 500) {
      // Proxy-ul Vite răspunde cu 5xx fără corp JSON când serverul .NET nu e pornit.
      throw new ApiError(`Backendul nu răspunde (HTTP ${response.status}). Pornește „AERIS API” (dotnet run) sau rulează frontendul cu npm run dev:mock.`, response.status);
    }
    const message = body?.error ?? body?.title ?? `HTTP ${response.status}`;
    throw new ApiError(message, response.status);
  }
  return (await response.json()) as T;
}

/** Latență artificială în mock, ca să se vadă stările de încărcare. */
function mockDelay<T>(produce: () => T, signal?: AbortSignal, ms = 350): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        resolve(produce());
      } catch (e) {
        reject(e instanceof mock.MockBadRequest ? new ApiError(e.message, 400) : e);
      }
    }, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}

/** Lista de aeronave a scenariului. Mereu forceSimulated=true: datele live nu sunt repetabile. */
export function fetchScenarioTraffic(signal?: AbortSignal): Promise<LiveTrafficResponse> {
  if (API_MOCK) return mockDelay(() => mock.liveTraffic(), signal);
  return request('/api/craiova/live-traffic?forceSimulated=true', { signal });
}

export function evaluateCraiova(body: CraiovaCustomEvaluationRequest, signal?: AbortSignal): Promise<CraiovaSimulationResult> {
  if (API_MOCK) {
    return mockDelay(
      () => mock.evaluateSimulation(body.aircrafts ?? mock.realisticCraiovaTraffic(), body.weather!, 'Scenariu personalizat utilizator'),
      signal,
    );
  }
  return request('/api/craiova/evaluate', { method: 'POST', body: JSON.stringify(body), signal });
}

/** Variantele de inserare VFR (fluxul cererii VFR; îl folosește timeline-ul / formularul lui Daha). */
export function evaluatePlanning(body: EvaluationRequest, signal?: AbortSignal): Promise<PlanningResponse> {
  if (API_MOCK) return mockDelay(() => mock.evaluatePlanning(body.aircrafts, body.rules), signal);
  return request('/api/planning/evaluate', { method: 'POST', body: JSON.stringify(body), signal });
}
