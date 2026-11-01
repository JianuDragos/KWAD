// Întrebări pentru modelul AI local (POST /api/craiova/explain). Modelul doar alege și traduce în
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

export function AskAi({ context, suggestions = DEFAULT_SUGGESTIONS }: { context?: ExplainContext; suggestions?: string[] }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Explanation | null>(null);
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
    <section className={`ai ${open ? 'is-open' : ''}`} aria-label="Mod AI">
      <button type="button" className="ai__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="ai__led" title="Modelul rulează pe acest laptop și explică doar calculele verificate de aplicație, fără să inventeze date." />
        <span className="ai__heading">
          <span className="ai__title">Mod AI</span>
          <span className="ai__sub">Întreabă despre trafic, sloturi și vreme</span>
        </span>
        <span className="ai__chev" aria-hidden="true" />
      </button>
      {open && (
        <div className="ai__body">
          <form className="ai__form" onSubmit={onSubmit}>
            <label className="sr-only" htmlFor="ai-question">
              Întrebare despre trafic, predicție și calcule
            </label>
            <input
              id="ai-question"
              className="ai__input"
              value={question}
              maxLength={1200}
              placeholder="Pune o întrebare despre trafic…"
              onChange={(e) => setQuestion(e.target.value)}
            />
            <button className="ai__send" type="submit" disabled={busy || !question.trim()} aria-label="Întreabă">
              ↑
            </button>
          </form>
          {!answer && !busy && (
            <div className="ai__chips">
              {suggestions.map((s) => (
                <button
                  key={s}
                  className="ai__chip"
                  onClick={() => {
                    setQuestion(s);
                    void ask(s);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <div aria-live="polite">
            {busy && (
              <div className="ai__thinking">
                <span className="ai__dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                Modelul local caută răspunsul (10–20 s)…
              </div>
            )}
            {error && !busy && <p className="notice notice--err">{error}</p>}
            {answer && !busy && (
              <div className="ai__answer">
                <ul className="ai__sentences">
                  {answer.sentences.map((s, i) => (
                    <li key={answer.statementIds[i] ?? i}>{s}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="ai__new"
                  onClick={() => {
                    setAnswer(null);
                    setQuestion('');
                  }}
                >
                  Altă întrebare
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
