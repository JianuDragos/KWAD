// Întrebări libere în limba română pentru modelul AI local 4B (Qwen3-4B-Instruct-2507) + panou de verificare matematică.
// Modelul răspunde direct la întrebarea pusă, iar verificatorul C# controlează fiecare valoare numerică față de faptele AERIS.
import { useRef, useState, type FormEvent } from 'react';
import { ApiError, explain, type ExplainContext } from '../api/client';
import type { Explanation } from '../contracts/live';

const DEFAULT_SUGGESTIONS = [
  'Care avion aterizează primul și la ce oră?',
  'Cât combustibil mai are YR-5123 și ce îi recomanzi?',
  'De unde vine WZZ3751 și care e distanța de aterizare?',
  'Există conflicte de separare sau turbulență de siaj?',
];

const FALLBACK_REASON: Record<string, string> = {
  inference_unavailable: 'serverul LLM local este oprit — a răspuns motorul Q&A determinist C#',
  timeout: 'modelul 4B a depășit limita de timp — s-a folosit răspunsul determinist',
  no_matching_statement: 'nicio regulă selectată — s-a folosit răspunsul determinist',
  invalid_selection: 'format JSON invalid de la model — s-a folosit răspunsul determinist',
  invalid_response: 'răspuns invalid de la model — s-a folosit răspunsul determinist',
  incomplete_response: 'răspuns incomplet — s-a folosit răspunsul determinist',
  response_too_large: 'răspuns prea lung — s-a folosit răspunsul determinist',
};

export function AskAi({ context, suggestions = DEFAULT_SUGGESTIONS }: { context?: ExplainContext; suggestions?: string[] }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Explanation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showProof, setShowProof] = useState(false);
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

  const ver = answer?.verification ?? null;
  const primaryText = answer?.directAnswer?.trim() || answer?.sentences.join(' ') || '';

  return (
    <section className={`ai ${open ? 'is-open' : ''}`} aria-label="Mod AI">
      <button type="button" className="ai__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="ai__led" title="Modelul rulează pe acest laptop și explică doar calculele verificate de aplicație, fără să inventeze date." />
        <span className="ai__heading">
          <span className="ai__title">Mod AI (Qwen3-4B)</span>
          <span className="ai__sub">Întreabă despre trafic, sloturi, vânt și proceduri</span>
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
                  type="button"
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
                Qwen3-4B formulează răspunsul și verifică cifrele față de motorul AERIS…
              </div>
            )}
            {error && !busy && <p className="notice notice--err">{error}</p>}
            {answer && !busy && (
              <div className="ai__answer">
                <div className="ai__direct" style={{ fontSize: '13.5px', lineHeight: '1.45' }}>
                  {primaryText}
                </div>

                {ver && (
                  <div className="ai__verify-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                    <span className={`ai__verify-badge ${ver.hallucinationBlocked ? 'is-blocked' : 'is-ok'}`} style={{ fontSize: '11px' }}>
                      {ver.hallucinationBlocked
                        ? '🛡 Scut anti-halucinație activat'
                        : `✓ Verificat (${ver.verifiedNumbers.length}/${ver.totalNumbersInAnswer} cifre confirmate)`}
                    </span>
                    <span className="ai__verify-meta num muted small">
                      {(ver.latencyMs / 1000).toFixed(1)}s
                    </span>
                  </div>
                )}

                {answer.mode === 'deterministic_fallback' && answer.fallbackReason && (
                  <p className="notice notice--warn small" style={{ margin: '4px 0' }}>
                    Notă: {FALLBACK_REASON[answer.fallbackReason] ?? answer.fallbackReason}.
                  </p>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                  <button type="button" className="btn-link ai__proof-toggle small" onClick={() => setShowProof((v) => !v)}>
                    {showProof ? '▾ Ascunde fapte' : `▸ Verifică fapte (${ver?.citations.length ?? answer.sentences.length})`}
                  </button>
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

                {showProof && (
                  <div className="ai__proof" style={{ marginTop: '6px' }}>
                    <ul className="ai__sentences" style={{ margin: 0, paddingLeft: '16px', fontSize: '12.5px' }}>
                      {answer.sentences.map((s, i) => (
                        <li key={answer.statementIds[i] ?? i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
