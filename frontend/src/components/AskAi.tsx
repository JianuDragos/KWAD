// Întrebări pentru modelul AI local 4B (POST /api/craiova/explain). Modelul doar alege și traduce în
// limbaj natural enunțurile matematice aprobate de backend (din datele reale sau din scenariul Demo).
import { useRef, useState, type FormEvent } from 'react';
import { ApiError, explain, type ExplainContext } from '../api/client';
import type { Explanation } from '../contracts/live';

const DEFAULT_SUGGESTIONS = [
  'Care este predicția viitorului pe 45 min?',
  'Explică analiza cu 2 pași înainte',
  'De ce orbităm sau redirecționăm VFR la Podari?',
  'Care e distanța de aterizare și unghiul de derivă?',
];

/** Motivele de rezervă din backend, spuse pe înțelesul controlorului. */
const FALLBACK_REASON: Record<string, string> = {
  inference_unavailable: 'modelul AI local (4B) nu rulează — traducere deterministă activă',
  timeout: 'modelul AI nu a răspuns în 30 de secunde',
  no_matching_statement: 'întrebarea nu se potrivește cu datele disponibile',
  invalid_selection: 'modelul a dat un răspuns invalid',
  invalid_response: 'modelul a dat un răspuns invalid',
  incomplete_response: 'răspunsul modelului a fost incomplet',
  response_too_large: 'răspunsul modelului a fost prea mare',
};

export function AskAi({ context, suggestions = DEFAULT_SUGGESTIONS }: { context?: ExplainContext; suggestions?: string[] }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Explanation | null>(null);
  const [asked, setAsked] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  async function ask(q: string) {
    const text = q.trim();
    if (!text) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setBusy(true);
    setError(null);
    try {
      const result = await explain(text, controller.signal, context);
      setAnswer(result);
      setAsked(text);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError(e instanceof ApiError ? e.message : 'Analiza AI nu a putut fi obținută.');
    } finally {
      if (inFlight.current === controller) setBusy(false);
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(question);
  };

  return (
    <section className="ai" aria-label="Analiză AI">
      <h3 className="panel__sub">Interpretare AI 4B (Calcul → Limbaj Natural)</h3>
      <form className="ai__form" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="ai-question">
          Întrebare despre calcule matematice, predicție și trafic
        </label>
        <input
          id="ai-question"
          className="ai__input"
          value={question}
          maxLength={1200}
          placeholder="Întreabă despre predicție, PNR, Podari, TOD…"
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button className="btn btn--primary" type="submit" disabled={busy || !question.trim()}>
          {busy ? 'Calcul…' : 'Explică'}
        </button>
      </form>
      <div className="ai__chips">
        {suggestions.map((s) => (
          <button
            key={s}
            className="ai__chip"
            disabled={busy}
            onClick={() => {
              setQuestion(s);
              void ask(s);
            }}
          >
            {s}
          </button>
        ))}
      </div>

      <div aria-live="polite">
        {busy && <p className="muted small">Se sintetizează calculele fizice în limbaj natural…</p>}
        {error && !busy && <p className="notice notice--err">{error}</p>}
        {answer && !busy && (
          <div className="ai__answer">
            <p className="muted small">„{asked}”</p>
            {answer.mode === 'deterministic_fallback' && (
              <p className="notice notice--warn small">
                 Sinteza matematică directă ({FALLBACK_REASON[answer.fallbackReason ?? ''] ?? answer.fallbackReason ?? 'rezervă deterministă'}):
              </p>
            )}
            <ul className="ai__sentences">
              {answer.sentences.map((s, i) => (
                <li key={answer.statementIds[i] ?? i}>{s}</li>
              ))}
            </ul>
            <p className="muted small">
              Surse verificate: {answer.sourceIds.join('; ')}.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
