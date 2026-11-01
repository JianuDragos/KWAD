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
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Explanation | null>(null);
  const [asked, setAsked] = useState('');
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

  const ver = answer?.verification ?? null;
  const primaryText = answer?.directAnswer?.trim() || answer?.sentences.join(' ') || '';

  return (
    <section className="ai" aria-label="Asistent AI Verificat">
      <div className="ai__hdr">
        <h3 className="panel__sub">Asistent AI 4B (Răspuns Direct &amp; Verificat)</h3>
        {ver && !busy && (
          <span className={`ai__mode-pill ${answer?.mode === 'grounded_selection' ? 'is-llm' : 'is-det'}`} title={ver.runtimeEndpoint ?? ''}>
            {answer?.mode === 'grounded_selection' ? '● Qwen3-4B Activ' : '○ Q&A Determinist'}
          </span>
        )}
      </div>

      <form className="ai__form" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="ai-question">
          Solicită analiză tactică ATC (secvențiere, vânt lateral, PNR/combustibil, separare 4D)
        </label>
        <input
          id="ai-question"
          className="ai__input"
          value={question}
          maxLength={1200}
          placeholder="Solicită analiză tactică ATC (secvențiere, PNR/combustibil, conflict 4D, alternativă VFR)…"
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button className="btn btn--primary" type="submit" disabled={busy || !question.trim()}>
          {busy ? 'Gândește…' : 'Întreabă'}
        </button>
      </form>

      <div className="ai__chips">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
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
        {busy && <p className="muted small">Qwen3-4B formulează răspunsul și verifică cifrele față de motorul AERIS…</p>}
        {error && !busy && <p className="notice notice--err">{error}</p>}
        {answer && !busy && (
          <div className="ai__answer">
            <p className="ai__question muted small">Întrebare: „{asked}”</p>

            {/* Răspunsul conversațional direct la întrebarea pusă */}
            <div className="ai__direct">{primaryText}</div>

            {/* Bara de verificare anti-halucinație */}
            {ver && (
              <div className="ai__verify-bar">
                <span className={`ai__verify-badge ${ver.hallucinationBlocked ? 'is-blocked' : 'is-ok'}`}>
                  {ver.hallucinationBlocked
                    ? '🛡 Scut anti-halucinație activat (răspuns corectat C#)'
                    : `✓ Verificat fără halucinații (${ver.verifiedNumbers.length}/${ver.totalNumbersInAnswer} cifre confirmate)`}
                </span>
                <span className="ai__verify-meta num muted small">
                  {ver.engineUsed} · {(ver.latencyMs / 1000).toFixed(2)}s
                </span>
              </div>
            )}

            {answer.mode === 'deterministic_fallback' && answer.fallbackReason && (
              <p className="notice notice--warn small">
                Notă: {FALLBACK_REASON[answer.fallbackReason] ?? answer.fallbackReason}.
              </p>
            )}

            {/* Sertar interactiv pentru verificarea umană a surselor și cifrelor */}
            <button type="button" className="btn-link ai__proof-toggle" onClick={() => setShowProof((v) => !v)}>
              {showProof
                ? '▾ Ascunde verificarea matematică și faptele sursă'
                : `▸ Verifică răspunsul (${ver?.citations.length ?? answer.sentences.length} fapte sursă & cifre verificate)`}
            </button>

            {showProof && (
              <div className="ai__proof">
                {ver && <p className="small muted">{ver.verificationSummary}</p>}

                {ver && ver.verifiedNumbers.length > 0 && (
                  <div className="ai__nums">
                    <span className="ai__proof-lbl">Valori numerice verificate 1:1 în backend:</span>
                    <div className="ai__num-list">
                      {ver.verifiedNumbers.map((n) => (
                        <span key={n} className="ai__num-chip num">
                          ✓ {n}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {ver && ver.unverifiedNumbers.length > 0 && (
                  <div className="ai__nums">
                    <span className="ai__proof-lbl txt-warn">Valori blocate (neprezente în backend):</span>
                    <div className="ai__num-list">
                      {ver.unverifiedNumbers.map((n) => (
                        <span key={n} className="ai__num-chip ai__num-chip--blocked num">
                          ✕ {n}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="ai__citations">
                  <span className="ai__proof-lbl">Fapte primare AERIS folosite ca bază (Ground Truth):</span>
                  <ul className="ai__citation-list">
                    {(ver?.citations ?? answer.sentences.map((t, i) => ({ id: answer.statementIds[i] ?? String(i), sourceId: answer.sourceIds[0] ?? 'AERIS', text: t }))).map((c) => (
                      <li key={c.id} className="ai__citation">
                        <span className="ai__citation-tag num">
                          [{c.id} · {c.sourceId}]
                        </span>{' '}
                        <span>{c.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <p className="muted small">Suport decizional bazat pe simulare deterministă — nu constituie autorizare ATC.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
