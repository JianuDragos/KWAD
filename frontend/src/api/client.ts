import type {
  CraiovaAircraft,
  CraiovaCustomEvaluationRequest,
  CraiovaSimulationResult,
  EvaluationRequest,
  LiveTrafficResponse,
  PlanningResponse,
  WeatherCondition,
} from '../contracts/backend';
import type { z } from 'zod';
import { describeIssue, liveTrafficSchema, planningResponseSchema, simulationResultSchema } from '../contracts/schemas';
import { explanationSchema, livePositionsSchema, metarSchema, vfrTrackingSchema, type Explanation, type LivePositions, type Metar, type VfrTracking } from '../contracts/live';
import * as mock from './mockBackend';
import * as mockLive from './mockLive';

export const API_MOCK = import.meta.env.VITE_API_MOCK === '1';

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Verifică forma răspunsului; un contract schimbat devine o eroare clară, cu numele câmpului. */
function parseResponse<T>(path: string, schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    // Detaliile tehnice merg doar în consolă; utilizatorul nu vede rute sau structura serverului.
    console.error(`Răspuns invalid de la ${path}: ${describeIssue(parsed.error)}`);
    throw new ApiError('Serviciul de planificare a trimis date neașteptate.', 200);
  }
  return parsed.data;
}

const UNAVAILABLE = 'Serviciul de planificare nu răspunde.';

async function request<T>(path: string, schema: z.ZodType<T>, init: RequestInit & { signal?: AbortSignal } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...init.headers } });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    console.error(`${path}: fără răspuns (pornește backendul cu dotnet run sau rulează npm run dev:mock)`, e);
    throw new ApiError(UNAVAILABLE, 0);
  }
  if (!response.ok) {
    // Backendul are două formate de eroare: { error } (validare scenariu) și ProblemDetails (JSON invalid).
    const body = await response.json().catch(() => null);
    if (!body && response.status >= 500) {
      // Proxy-ul Vite răspunde cu 5xx fără corp JSON când serverul .NET nu e pornit.
      console.error(`${path}: HTTP ${response.status} fără corp (backend oprit? dotnet run sau npm run dev:mock)`);
      throw new ApiError(UNAVAILABLE, response.status);
    }
    const message = body?.error ?? body?.title ?? `HTTP ${response.status}`;
    throw new ApiError(message, response.status);
  }
  const data: unknown = await response.json().catch(() => null);
  return parseResponse(path, schema, data);
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
// În mock trecem răspunsurile prin aceleași scheme, ca mock-ul și schemele să nu poată diverge.

export function fetchScenarioTraffic(signal?: AbortSignal): Promise<LiveTrafficResponse> {
  const path = '/api/craiova/live-traffic?forceSimulated=true';
  if (API_MOCK) return mockDelay(() => parseResponse(path, liveTrafficSchema, mock.liveTraffic()), signal);
  return request(path, liveTrafficSchema, { signal });
}

export function evaluateCraiova(body: CraiovaCustomEvaluationRequest, signal?: AbortSignal): Promise<CraiovaSimulationResult> {
  const path = '/api/craiova/evaluate';
  if (API_MOCK) {
    return mockDelay(
      () =>
        parseResponse(
          path,
          simulationResultSchema,
          mock.evaluateSimulation(
            body.aircrafts ?? mock.realisticCraiovaTraffic(),
            body.weather!,
            'Scenariu personalizat utilizator',
            body.useTrajectoryEngine ?? true,
          ),
        ),
      signal,
    );
  }
  return request(path, simulationResultSchema, { method: 'POST', body: JSON.stringify(body), signal });
}

/** Variantele de inserare VFR (fluxul cererii VFR; îl folosește timeline-ul / formularul lui Daha). */
export function evaluatePlanning(body: EvaluationRequest, signal?: AbortSignal): Promise<PlanningResponse> {
  const path = '/api/planning/evaluate';
  if (API_MOCK) return mockDelay(() => parseResponse(path, planningResponseSchema, mock.evaluatePlanning(body.aircrafts, body.rules)), signal);
  return request(path, planningResponseSchema, { method: 'POST', body: JSON.stringify(body), signal });
}

// ---------- Date reale (pagina Live) ----------

/** Pozițiile reale din OpenSky, prin backend (fără cache: fiecare apel consumă din cota OpenSky). */
export function fetchLivePositions(signal?: AbortSignal): Promise<LivePositions> {
  const path = '/api/craiova/live-positions';
  if (API_MOCK) return mockDelay(() => parseResponse(path, livePositionsSchema, mockLive.livePositions()), signal);
  return request(path, livePositionsSchema, { signal });
}

/** METAR-ul curent LRCV, decodat de backend (sursa: aviationweather.gov). */
export function fetchMetar(signal?: AbortSignal): Promise<Metar> {
  const path = '/api/weather/metar/decoded';
  if (API_MOCK) return mockDelay(() => parseResponse(path, metarSchema, mockLive.metar()), signal);
  return request(path, metarSchema, { signal });
}

export interface ExplainContext {
  weather?: WeatherCondition;
  aircrafts?: CraiovaAircraft[];
  evaluationResult?: CraiovaSimulationResult;
}

/** Întrebare pentru modelul AI local (4B); răspunsul traduce calculele matematice aprobate de backend în limbaj natural. */
export function explain(question: string, signal?: AbortSignal, context?: ExplainContext): Promise<Explanation> {
  const path = '/api/craiova/explain';
  if (API_MOCK) {
    return mockDelay(
      () => parseResponse(path, explanationSchema, mockLive.explanation(question, context?.evaluationResult)),
      signal,
      700,
    );
  }
  const payload: Record<string, unknown> = { question };
  if (context?.weather) payload.weather = context.weather;
  if (context?.aircrafts) payload.aircrafts = context.aircrafts;
  return request(path, explanationSchema, { method: 'POST', body: JSON.stringify(payload), signal });
}

export function fetchVfrTracking(runway: string, signal?: AbortSignal): Promise<VfrTracking> {
  const path = `/api/craiova/vfr/tracking?runway=${encodeURIComponent(runway)}`;
  if (API_MOCK) return mockDelay(() => parseResponse(path, vfrTrackingSchema, mockLive.vfrTracking()), signal);
  return request(path, vfrTrackingSchema, { signal });
}
