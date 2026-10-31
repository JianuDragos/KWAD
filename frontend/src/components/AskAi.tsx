// Întrebări pentru modelul AI local (POST /api/craiova/explain). Modelul doar alege enunțuri aprobate
// de backend din datele reale (METAR + trafic), deci răspunsul nu poate conține fapte inventate.
import { useRef, useState, type FormEvent } from 'react';
import { ApiError, explain } from '../api/client';
import type { Explanation } from '../contracts/live';

const SUGGESTIONS = ['Ce pistă e în folosință și de ce?', 'Cum e vremea la Craiova?', 'Sunt avioane în așteptare?'];

/** Motivele de rezervă din backend, spuse pe înțelesul controlorului. */
const FALLBACK_REASON: Record<string, string> = {
  inference_unavailable: 'modelul AI nu rulează',
  timeout: 'modelul AI nu a răspuns în 30 de secunde',
  no_matching_statement: 'întrebarea nu se potrivește cu datele disponibile',
  invalid_selection: 'modelul a dat un răspuns invalid',
  invalid_response: 'modelul a dat un răspuns invalid',
  incomplete_response: 'răspunsul modelului a fost incomplet',
  response_too_large: 'răspunsul modelului a fost prea mare',
};

export function AskAi() {
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
      const result = await explain(text, controller.signal);
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
      <h3 className="panel__sub">Întreabă AI</h3>
      <form className="ai__form" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="ai-question">
          Întrebare despre trafic și vreme
        </label>
        <input
          id="ai-question"
          className="ai__input"
          value={question}
          maxLength={1200}
          placeholder="De ex. de ce e pista 27 în folosință?"
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button className="btn btn--primary" type="submit" disabled={busy || !question.trim()}>
          {busy ? 'Se gândește…' : 'Întreabă'}
        </button>
      </form>
      <div className="ai__chips">
        {SUGGESTIONS.map((s) => (
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
        {busy && <p className="muted small">Modelul local caută răspunsul (pe acest laptop durează 10–20 de secunde)…</p>}
        {error && !busy && <p className="notice notice--err">{error}</p>}
        {answer && !busy && (
          <div className="ai__answer">
            <p className="muted small">„{asked}”</p>
            {answer.mode === 'deterministic_fallback' && (
              <p className="notice notice--warn">
                Fără selecție AI ({FALLBACK_REASON[answer.fallbackReason ?? ''] ?? answer.fallbackReason ?? 'motiv necunoscut'}). Mai jos e raportul complet al
                backendului.
              </p>
            )}
            <ul className="ai__sentences">
              {answer.sentences.map((s, i) => (
                <li key={answer.statementIds[i] ?? i}>{s}</li>
              ))}
            </ul>
            <p className="muted small">
              Surse: {answer.sourceIds.join('; ')}. Răspunsul e compus doar din enunțuri verificate de backend.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
