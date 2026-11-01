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

export function AskAi({ context, suggestions = DEFAULT_SUGGESTIONS }: { context?: ExplainContext; suggestions?: string[] }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  // Răspunsul ține minte scenariul pentru care a fost cerut: după o schimbare de trafic sau vreme nu mai e valabil.
  const [reply, setReply] = useState<{ explanation: Explanation; scenario: ExplainContext['evaluationResult'] } | null>(null);
  const answer = reply && reply.scenario === context?.evaluationResult ? reply.explanation : null;
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
      setReply({ explanation: result, scenario: context?.evaluationResult });
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
          <span className="ai__title">Mod AI</span>
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
                <p className="ai__direct">{primaryText}</p>

                {ver && (
                  <p
                    className={`ai__verify ${ver.hallucinationBlocked ? 'is-blocked' : ''}`}
                    title="Fiecare cifră din răspuns e comparată cu datele calculate de aplicație."
                  >
                    {ver.hallucinationBlocked
                      ? 'Răspunsul modelului conținea cifre neconfirmate și a fost înlocuit cu datele aplicației'
                      : `Cifre verificate: ${ver.verifiedNumbers.length} din ${ver.totalNumbersInAnswer}`}
                    <span className="ai__verify-meta">{(ver.latencyMs / 1000).toFixed(1)} s</span>
                  </p>
                )}

                <div className="ai__actions">
                  <button type="button" className="ai__link" onClick={() => setShowProof((v) => !v)} aria-expanded={showProof}>
                    {showProof ? 'Ascunde faptele' : `Vezi faptele (${ver?.citations.length ?? answer.sentences.length})`}
                  </button>
                  <button
                    type="button"
                    className="ai__new"
                    onClick={() => {
                      setReply(null);
                      setQuestion('');
                    }}
                  >
                    Altă întrebare
                  </button>
                </div>

                {showProof && (
                  <div className="ai__proof">
                    <ul className="ai__sentences">
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
