// Tab-ul dedicat „Asistent”: spațiu de conversație tactică ATC (Qwen3-4B + verificare matematică C#)
// și panou interactiv de analiză & decizie pentru problemele operaționale (VFR Așteptare Rând vs. Redirecționare Alternativă).
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { WEATHER_PRESETS } from '../data/weatherPresets';
import { getAwaitingVfrFlights, type FlightView, type VfrResolutionAction } from '../sim/traffic';
import { clockLabel } from '../sim/units';
import { useAssistant, type AssistantMessage } from '../state/assistant';
import { useLive } from '../state/live';
import { setMode } from '../state/mode';
import { BASE_TIME_OFFSET_SECONDS, useApp } from '../state/store';

interface TacticalCategory {
  id: string;
  title: string;
  roleNote: string;
  prompts: string[];
}

const DEMO_TACTICAL_CATEGORIES: TacticalCategory[] = [
  {
    id: 'vfr-decision',
    title: '1. Decizie VFR: Așteptare Rând vs. Alternativă',
    roleNote: 'Evaluează PNR, combustibilul și plafonul de vânt lateral pe LRCV față de Podari / Balta Verde / Slatina.',
    prompts: [
      'Analizează aeronavele VFR în așteptare: care pot ateriza pe LRCV după IFR și care trebuie redirecționate?',
      'Calculează marja PNR, combustibilul rămas și aerodromul alternativ optim pentru YR-5123.',
      'Compară condițiile de aterizare pe Podari și Balta Verde pentru traficul VFR afectat de vânt.',
    ],
  },
  {
    id: 'sequencing',
    title: '2. Secvențiere Pistă & Separare 4D',
    roleNote: 'Ordinea cronologică la prag, întârzierile alocate și protecția la turbulența de siaj EASA.',
    prompts: [
      'Care este ordinea programată la aterizare pe pista activă și ce întârzieri apar?',
      'Există conflicte de separare 4D sau restricții de turbulență de siaj între zborurile active?',
      'Care este situația generală a sectorului LRCV și câte aeronave sunt în holding?',
    ],
  },
  {
    id: 'weather-window',
    title: '3. Limite Vânt & Fereastră Meteo (T+0..T+45m)',
    roleNote: 'Evoluția forfecării vântului (2000/5000 ft), altitudinea de densitate și fereastra optimă VFR.',
    prompts: [
      'Când apare o fereastră meteo sigură pentru aterizarea VFR pe LRCV în următoarele 45 de minute?',
      'Care sunt componentele de vânt lateral și frontal pe pista activă și la 2000 ft?',
    ],
  },
  {
    id: 'kinematics',
    title: '4. Profil Coborâre (TOD) & Ocupare Pistă (LDR/ROT)',
    roleNote: 'Punctul Top of Descent, rata de coborâre pe glisada de 3°, distanța de frânare și ROT.',
    prompts: [
      'Care sunt distanța TOD, distanța de aterizare LDR și timpul de ocupare a pistei pentru WZZ3751?',
      'De unde vine zborul cel mai lung din scenariu și la ce oră are slotul pe LRCV?',
    ],
  },
];

const LIVE_TACTICAL_CATEGORIES: TacticalCategory[] = [
  {
    id: 'live-wx',
    title: '1. Analiză METAR & Pistă Activă LRCV',
    roleNote: ' Evaluează vântul real, vizibilitatea, plafonul și eligibilitatea VMC/IMC pe Craiova.',
    prompts: [
      'Care este starea meteo actuală pe LRCV conform METAR și ce pistă este activă?',
      'Sunt îndeplinite condițiile VMC pentru operarea zborurilor VFR în acest moment?',
    ],
  },
  {
    id: 'live-radar',
    title: '2. Trafic Radar Activ & Secvențiere',
    roleNote: 'Aeronave detectate în timp real în sectorul Craiova și estimările de sosire.',
    prompts: [
      'Câte aeronave sunt în zbor acum în zona Craiova și ce reguli de zbor au?',
      'Care este ordinea estimată la aterizare pentru traficul real detectat?',
    ],
  },
];

const FALLBACK_LABELS: Record<string, string> = {
  inference_unavailable: 'serverul LLM local este oprit — a răspuns motorul determinist C#',
  timeout: 'modelul 4B a depășit timpul limită — s-a folosit sinteza deterministă C#',
  no_matching_statement: 'nicio regulă selectată — s-a folosit sinteza deterministă C#',
  invalid_selection: 'format JSON invalid — s-a folosit sinteza deterministă C#',
  invalid_response: 'răspuns invalid — s-a folosit sinteza deterministă C#',
  incomplete_response: 'răspuns incomplet — s-a folosit sinteza deterministă C#',
  response_too_large: 'răspuns prea amplu — s-a folosit sinteza deterministă C#',
};

const clock = (s: number) => clockLabel(BASE_TIME_OFFSET_SECONDS + s, false);

export function AssistantView() {
  const messages = useAssistant((s) => s.messages);
  const busy = useAssistant((s) => s.busy);
  const draft = useAssistant((s) => s.draft);
  const contextSource = useAssistant((s) => s.contextSource);
  const { setDraft, sendPrompt } = useAssistant.getState();

  const [activeCategory, setActiveCategory] = useState<string>('vfr-decision');
  const threadEndRef = useRef<HTMLDivElement>(null);

  // Când suntem pe sursa Live în Asistent, pornim feed-ul METAR + OpenSky pentru afișarea stării curente
  useEffect(() => (contextSource === 'live' ? useLive.getState().start() : undefined), [contextSource]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, busy]);

  const categories = contextSource === 'demo' ? DEMO_TACTICAL_CATEGORIES : LIVE_TACTICAL_CATEGORIES;
  const currentCat = categories.find((c) => c.id === activeCategory) ?? categories[0];

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || busy) return;
    void sendPrompt(draft);
  };

  return (
    <div className="assistant-workspace">
      {/* Coloana principală: Conversație tactică ATC + Întrebări operaționale structurate */}
      <section className="assistant-chat" aria-label="Conversație Asistent Tactic ATC">
        <header className="assistant-chat__hdr">
          <div>
            <h1 className="assistant-chat__title">Asistent Tactic ATC · Suport Decizional Craiova (LRCV)</h1>
            <p className="muted small">
               Analiză conversațională în limba română ancorată strict în calculele fizice AERIS (zero cifre inventate, verificare C# la fiecare răspuns).
            </p>
          </div>
        </header>

        {/* Matricea întrebărilor tactice care ajută real controlorul TWR/APP */}
        <div className="tactical-deck">
          <div className="tactical-tabs" role="tablist" aria-label="Categorii de analiză tactică ATC">
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={currentCat.id === cat.id}
                className={`tactical-tab ${currentCat.id === cat.id ? 'is-active' : ''}`}
                onClick={() => setActiveCategory(cat.id)}
              >
                {cat.title}
              </button>
            ))}
          </div>
          <div className="tactical-panel" role="tabpanel">
            <p className="muted small">{currentCat.roleNote}</p>
            <div className="tactical-prompts">
              {currentCat.prompts.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="tactical-prompt-btn"
                  disabled={busy}
                  onClick={() => void sendPrompt(p)}
                >
                  ▸ {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Firul conversației */}
        <div className="chat-thread" aria-live="polite">
          {messages.length === 0 && !busy && (
            <div className="chat-empty">
              <h2 className="chat-empty__title">Consolă gata pentru consultare operațională</h2>
              <p className="muted">
                Selectează o analiză tactică din categoriile de mai sus, folosește cardurile de rezoluție VFR din dreapta sau adresează o problemă operațională concretă (secvențiere, vânt lateral, PNR/combustibil, conflict 4D, aerodromuri de rezervă).
              </p>
            </div>
          )}

          {messages.map((m) => (
            <ChatBubble key={m.id} msg={m} />
          ))}

          {busy && (
            <div className="chat-msg chat-msg--assistant is-thinking">
              <div className="chat-msg__meta">
                <span className="chat-msg__author">Asistent AERIS (Qwen3-4B)</span>
                <span className="muted small">analizează telemetria &amp; verifică cifrele…</span>
              </div>
              <div className="chat-msg__body muted">
                Se evaluează calculele cinematice și limitele operaționale pentru formularea răspunsului verificat…
              </div>
            </div>
          )}
          <div ref={threadEndRef} />
        </div>

        {/* Bara profesională de interogare tactică ATC (fără „întreabă orice”) */}
        <form className="chat-composer" onSubmit={onSubmit}>
          <label className="sr-only" htmlFor="atc-tactical-input">
            Solicită analiză operațională ATC
          </label>
          <input
            id="atc-tactical-input"
            className="chat-composer__input"
            value={draft}
            maxLength={1200}
            placeholder="Solicită analiză tactică ATC (ex: secvențiere RWY, marjă PNR YR-5123, conflict 4D, decizie holding vs. Podari)…"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="btn btn--primary chat-composer__btn" type="submit" disabled={busy || !draft.trim()}>
            {busy ? 'Analizează…' : 'Solicită analiză'}
          </button>
        </form>
      </section>

      {/* Coloana dreaptă: Probleme Active & Flux Decizional VFR (Așteptare Rând pe LRCV vs. Redirecționare Alternativă) */}
      <aside className="assistant-ops" aria-label="Probleme active și decizii tactice VFR">
        {contextSource === 'demo' ? <DemoTacticalProblemsPanel /> : <LiveOperationalSummaryPanel />}
      </aside>
    </div>
  );
}

function ChatBubble({ msg }: { msg: AssistantMessage }) {
  const [showProof, setShowProof] = useState(false);

  if (msg.role === 'controller') {
    return (
      <article className="chat-msg chat-msg--controller">
        <div className="chat-msg__meta">
          <span className="chat-msg__author">Controlor TWR/APP</span>
          <span className="muted small">
            {msg.contextSource === 'demo' ? 'Simulare' : 'Trafic real'} · {msg.createdAtLabel}
          </span>
        </div>
        <div className="chat-msg__body">{msg.text}</div>
      </article>
    );
  }

  if (msg.isError || !msg.explanation) {
    return (
      <article className="chat-msg chat-msg--assistant is-err">
        <div className="chat-msg__meta">
          <span className="chat-msg__author">Asistent AERIS</span>
          <span className="muted small">{msg.createdAtLabel}</span>
        </div>
        <p className="notice notice--err">{msg.text}</p>
      </article>
    );
  }

  const ans = msg.explanation;
  const ver = ans.verification ?? null;

  return (
    <article className="chat-msg chat-msg--assistant">
      <div className="chat-msg__meta">
        <span className="chat-msg__author">Asistent AERIS</span>
        <div className="chat-msg__badges">
          {ver && (
            <span className={`ai__mode-pill ${ans.mode === 'grounded_selection' ? 'is-llm' : 'is-det'}`}>
              {ans.mode === 'grounded_selection' ? '● Qwen3-4B Activ' : '○ Q&A Determinist'}
            </span>
          )}
          <span className="muted small">{msg.createdAtLabel}</span>
        </div>
      </div>

      <div className="ai__direct">{msg.text}</div>

      {ver && (
        <div className="ai__verify-bar">
          <span className={`ai__verify-badge ${ver.hallucinationBlocked ? 'is-blocked' : 'is-ok'}`}>
            {ver.hallucinationBlocked
              ? '🛡 Cifre neconfirmate interceptate — răspuns reconstruit matematic'
              : `✓ Verificat fără halucinații (${ver.verifiedNumbers.length}/${ver.totalNumbersInAnswer} cifre confirmate)`}
          </span>
          <span className="muted small num">{ver.latencyMs} ms</span>
        </div>
      )}

      {ans.fallbackReason && (
        <p className="muted small">Notă: {FALLBACK_LABELS[ans.fallbackReason] ?? ans.fallbackReason}.</p>
      )}

      <button
        type="button"
        className="ai__proof-toggle"
        onClick={() => setShowProof((v) => !v)}
        aria-expanded={showProof}
      >
        {showProof ? '▾ Ascunde dovada matematică' : `▸ Verifică răspunsul (${ans.sourceIds.length} surse AERIS)`}
      </button>

      {showProof && (
        <div className="ai__proof">
          {ver && (
            <>
              <p className="small">
                <strong>Motor:</strong> <span className="num">{ver.engineUsed}</span>
                {ver.runtimeEndpoint ? <span className="muted"> ({ver.runtimeEndpoint})</span> : null}
              </p>
              <p className="small muted">{ver.verificationSummary}</p>
              {ver.verifiedNumbers.length > 0 && (
                <div>
                  <span className="ai__proof-lbl">Valori numerice confirmate din motorul AERIS:</span>
                  <div className="ai__num-list">
                    {ver.verifiedNumbers.map((n) => (
                      <span key={n} className="ai__num-chip num">
                        ✓ {n}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          <div>
            <span className="ai__proof-lbl">Fapte sursă citate din backend (ground-truth):</span>
            <ul className="ai__citation-list">
              {(ver?.citations ?? ans.sentences.map((t, i) => ({ id: ans.statementIds[i] ?? `s${i}`, sourceId: ans.sourceIds[0] ?? 'AERIS', text: t }))).map(
                (c) => (
                  <li key={c.id} className="ai__citation">
                    <span className="ai__citation-tag num">[{c.id}]</span> {c.text}
                  </li>
                ),
              )}
            </ul>
          </div>
        </div>
      )}
    </article>
  );
}

export function VfrApproachRecommendationBox() {
  const evaluation = useApp((s) => s.evaluation);
  const simTimeSeconds = useApp((s) => s.simTimeSeconds);
  const flights = evaluation?.traffic.flights;
  const runway = evaluation?.traffic.runway ?? '08';
  const awaitingVfr = flights ? getAwaitingVfrFlights(flights, simTimeSeconds) : [];
  const vfrRec = useAssistant((s) => s.vfrRecommendation);
  const {
    acceptVfrApproachRecommendation,
    rejectVfrApproachRecommendation,
    resetVfrApproachRecommendation,
    sendPrompt,
  } = useAssistant.getState();
  const busy = useAssistant((s) => s.busy);

  if (awaitingVfr.length < 2) return null;

  const names = awaitingVfr.map((f) => f.callsign).join(', ');

  return (
    <section
      className={`vfr-rec-box ${
        vfrRec.status === 'rejected'
          ? 'vfr-rec-box--rejected'
          : vfrRec.status === 'accepted'
            ? 'vfr-rec-box--accepted'
            : 'vfr-rec-box--pending'
      }`}
      aria-label="Recomandare procedură de apropiere VFR"
    >
      <div className="vfr-rec-box__head">
        <div className="vfr-rec-box__title-wrap">
          <span className="vfr-rec-box__badge">
            {vfrRec.status === 'rejected'
              ? 'DIRECTIVĂ CONTROLOR TWR'
              : vfrRec.status === 'accepted'
                ? 'RECOMANDARE ACCEPTATĂ'
                : 'ALERTĂ VFR'}
          </span>
          <h3 className="vfr-rec-box__title">
            {awaitingVfr.length} aeronave VFR așteaptă aterizarea
          </h3>
        </div>
        <span className="muted small">RWY {runway} · {awaitingVfr.length} zboruri VFR</span>
      </div>

      {vfrRec.status === 'rejected' && (
        <div className="vfr-rec-box__notice vfr-rec-box__notice--rejected">
          <span className="vfr-rec-box__notice-icon">🛑</span>
          <div>
            <strong>S-a refuzat recomandarea si se vor urma indicatiile controlorului de trafic aerian</strong>
            <p className="small muted">
              Asistentul a suspendat aplicarea automată a secvenței. Controlorul de trafic aerian va coordona manual
              apropierea, eșalonarea și eventualele devieri ale aeronavelor VFR.
            </p>
          </div>
        </div>
      )}

      {vfrRec.status === 'accepted' && (
        <div className="vfr-rec-box__notice vfr-rec-box__notice--accepted">
          <span className="vfr-rec-box__notice-icon">✓</span>
          <div>
            <strong>Recomandarea Asistentului a fost acceptată</strong>
            <p className="small muted">
              Aeronavele VFR respectă eșalonarea la aterizare pe RWY {runway} sau ruta de deviere calculată.
            </p>
          </div>
        </div>
      )}

      <div className="vfr-rec-planes">
        {awaitingVfr.map((f) => {
          const d = f.tacticalDecision;
          const altLabel = d?.alternate ? `${d.alternate.name} (${d.alternate.bestRunway})` : 'Podari';
          return (
            <div key={f.id} className="vfr-rec-plane-chip">
              <span className="vfr-rec-plane-chip__cs num">{f.callsign}</span>
              <span className="muted small">{f.aircraft.modelName}</span>
              <span className="vfr-rec-plane-chip__detail">
                {d
                  ? `Lateral: ${d.crosswindKnots}/${d.maxCrosswindKnots} kt · PNR ${d.pnrMinutes} min`
                  : 'Așteptare slot / apropiere'}
              </span>
              <span className="vfr-rec-plane-chip__alt muted small">Alternativă: {altLabel}</span>
            </div>
          );
        })}
      </div>

      <div className="vfr-rec-proposal">
        <h4 className="vfr-rec-proposal__title">Recomandare procedură de apropiere (Asistent):</h4>
        <ol className="vfr-rec-proposal__steps">
          <li>
            <strong>Eșalonare la prag RWY {runway}:</strong> {awaitingVfr[0]?.callsign ?? 'Primul VFR'} execută
            apropierea vizuală după degajarea pistei de către traficul IFR precedent (interval de minim 120s).
          </li>
          <li>
            <strong>Circuit de așteptare:</strong> {awaitingVfr.slice(1).map((f) => f.callsign).join(', ')} mențin
            circuitul de hipodrom la Cârcea (1.500 ft QNH, sud de ax) pentru eșalonare sigură și protecție de siaj.
          </li>
          <li>
            <strong>Redirecționare la nevoie:</strong> Dacă vântul lateral depășește plafonul aprobat sau PNR scade sub 12
            min, redirecționare imediată către Balta Verde (LRCW) sau Podari.
          </li>
        </ol>
      </div>

      <div className="vfr-rec-box__actions">
        {vfrRec.status === 'pending' ? (
          <>
            <button
              type="button"
              className="btn btn--primary btn--xs"
              onClick={acceptVfrApproachRecommendation}
            >
              ✓ Acceptă recomandarea de apropiere
            </button>
            <button
              type="button"
              className="btn btn--danger btn--xs"
              onClick={rejectVfrApproachRecommendation}
            >
              ✕ Refuză recomandarea
            </button>
          </>
        ) : vfrRec.status === 'rejected' ? (
          <button
            type="button"
            className="btn btn--outline btn--xs"
            onClick={resetVfrApproachRecommendation}
          >
            ↺ Revino la recomandarea Asistentului
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--danger btn--xs"
            onClick={rejectVfrApproachRecommendation}
          >
            ✕ Refuză recomandarea
          </button>
        )}

        <button
          type="button"
          className="btn-link btn-link--quiet"
          disabled={busy}
          onClick={() =>
            void sendPrompt(
              `Explică recomandarea tactică de apropiere pentru cele ${awaitingVfr.length} aeronave VFR în așteptare (${names}) pe RWY ${runway}. Justifică marjele PNR și eșalonarea ATC.`,
              'demo',
            )
          }
        >
          ▸ Consultă Qwen3-4B despre abordare
        </button>
      </div>
    </section>
  );
}

function DemoTacticalProblemsPanel() {
  const evaluation = useApp((s) => s.evaluation);
  const scenario = useApp((s) => s.scenario);
  const vfrOverrides = useApp((s) => s.vfrOverrides);
  const { setVfrResolution, clearVfrOverrides, setWeatherPreset, select } = useApp.getState();
  const { sendPrompt, resetVfrApproachRecommendation } = useAssistant.getState();
  const busy = useAssistant((s) => s.busy);

  if (!evaluation || !scenario) {
    return <p className="muted">Se încarcă datele scenariului…</p>;
  }

  const { flights, runway } = evaluation.traffic;
  const vfrDecisions = flights.filter((f): f is FlightView & { tacticalDecision: NonNullable<FlightView['tacticalDecision']> } => f.tacticalDecision !== null);
  const hasOverrides = Object.keys(vfrOverrides).length > 0;

  return (
    <div className="ops-stack">
      <div className="ops-hdr">
        <div>
          <h2 className="panel__title">Flux Decizional VFR &amp; Probleme Active</h2>
          <p className="muted small">
            Asistentul analizează fiecare aeronavă VFR și alege între așteptarea rândului pe LRCV sau redirecționarea la un alt punct de aterizare.
          </p>
        </div>
      </div>

      {/* Alerta VFR (2+ aeronave în așteptare) stă prima: punctul roșu din butonul Asistent trimite aici. */}
      <VfrApproachRecommendationBox />

      {/* Selector rapid de condiții meteo pentru testarea fluxului în condiții nefavorabile */}
      <div className="ops-weather-bar">
        <span className="ops-weather-bar__lbl">Condiții scenariu:</span>
        <div className="ops-weather-pills">
          {WEATHER_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`ai__chip ${scenario.weatherPresetId === p.id ? 'is-selected-chip' : ''}`}
              onClick={() => {
                setWeatherPreset(p.id);
                resetVfrApproachRecommendation();
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {vfrDecisions.length === 0 ? (
        <div className="notice">
          <strong>Condiții nominale pe RWY {runway}:</strong> toate aeronavele au vânt lateral în limite și sloturi fără conflict. Comută pe <em>Vânt lateral</em> sau <em>Vânt lateral puternic</em> mai sus pentru a analiza deciziile VFR în condiții nefavorabile.
        </div>
      ) : (
        <>
          <div className="ops-summary-bar">
            <span className="small">
              <strong>{vfrDecisions.length} aeronave VFR</strong> analizate tactic
            </span>
            <div className="ops-summary-actions">
              {hasOverrides && (
                <button type="button" className="btn btn--quiet btn--xs" onClick={clearVfrOverrides}>
                  Revino la recomandarea Asistentului
                </button>
              )}
              <button
                type="button"
                className="btn btn--xs"
                onClick={() => setMode('demo')}
                title="Vezi traiectoriile de așteptare și redirecționare pe harta 4D"
              >
                Vezi pe hartă (Demo) →
              </button>
            </div>
          </div>

          <div className="vfr-decision-list">
            {vfrDecisions.map((f) => {
              const d = f.tacticalDecision;
              const altName = d.alternate ? `${d.alternate.name} (${d.alternate.bestRunway})` : 'Fără alternativă';
              const isWaitRec = d.recommendedAction === 'wait_and_land_lrcv';
              const isDivertRec = d.recommendedAction === 'divert_alternate';

              const applyChoice = (action: VfrResolutionAction) => {
                setVfrResolution(f.id, action === d.recommendedAction ? null : action);
              };

              return (
                <article
                  key={f.id}
                  className={`vfr-card ${d.effectiveAction === 'divert_alternate' ? 'vfr-card--divert' : 'vfr-card--wait'}`}
                >
                  <div className="vfr-card__head">
                    <div>
                      <span className="vfr-card__cs num">{f.callsign}</span>{' '}
                      <span className="muted small">{f.aircraft.modelName}</span>
                    </div>
                    <span className={`vfr-rec-pill ${d.effectiveAction === 'divert_alternate' ? 'is-divert' : 'is-wait'}`}>
                      {d.isOverridden ? 'Suprascris manual' : 'Recomandare Asistent'}
                    </span>
                  </div>

                  <div className="math-metrics">
                    <div className="math-metric">
                      <span className="math-metric__lbl">Lateral LRCV</span>
                      <span className={`math-metric__val ${d.crosswindKnots > d.maxCrosswindKnots ? 'txt-warn' : ''}`}>
                        {d.crosswindKnots} / {d.maxCrosswindKnots} kt
                      </span>
                    </div>
                    <div className="math-metric">
                      <span className="math-metric__lbl">Marjă PNR</span>
                      <span className="math-metric__val">{d.pnrMinutes} min</span>
                    </div>
                    <div className="math-metric">
                      <span className="math-metric__lbl">Aterizare est.</span>
                      <span className="math-metric__val">{clock(d.estimatedLandingSeconds)}</span>
                    </div>
                  </div>

                  <p className="small muted">{d.summaryReason}</p>

                  {/* Cele două opțiuni de rezoluție comparate de Asistent */}
                  <div className="vfr-options" role="group" aria-label={`Rezoluție tactică ${f.callsign}`}>
                    <button
                      type="button"
                      className={`vfr-opt-btn ${d.effectiveAction === 'wait_and_land_lrcv' ? 'is-chosen' : ''}`}
                      onClick={() => applyChoice('wait_and_land_lrcv')}
                    >
                      <span className="vfr-opt-btn__hdr">
                        <span>Așteaptă rândul → LRCV RWY {d.assignedVfrRunway}</span>
                        {isWaitRec && <span className="vfr-opt-tag">Optim</span>}
                      </span>
                      <span className="vfr-opt-btn__sub muted">
                        Hipodrom Cârcea, aterizare după degajarea IFR
                      </span>
                    </button>

                    {d.alternate && (
                      <button
                        type="button"
                        className={`vfr-opt-btn ${d.effectiveAction === 'divert_alternate' ? 'is-chosen is-divert' : ''}`}
                        onClick={() => applyChoice('divert_alternate')}
                      >
                        <span className="vfr-opt-btn__hdr">
                          <span>Redirecționare → {d.alternate.code === 'LRBV' ? 'Balta Verde (LRCW)' : d.alternate.name}</span>
                          {isDivertRec && <span className="vfr-opt-tag is-divert">Optim</span>}
                        </span>
                        <span className="vfr-opt-btn__sub muted">
                          RWY {d.alternate.bestRunway} · lateral {d.alternate.calculatedCrosswindKnots} kt · combustibil {d.fuelAtAlternateMinutes ?? '—'} min
                        </span>
                      </button>
                    )}
                  </div>

                  <div className="vfr-card__foot">
                    <button
                      type="button"
                      className="btn-link"
                      disabled={busy}
                      onClick={() =>
                        void sendPrompt(
                          `Analizează aeronava ${f.callsign}: ar trebui să aștepte rândul și să aterizeze pe LRCV sau să meargă la ${altName}? Verifică vântul lateral, PNR și combustibilul.`,
                          'demo',
                        )
                      }
                    >
                      ▸ Justifică decizia în conversație (Qwen3-4B)
                    </button>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => {
                        select(f.id);
                        setMode('demo');
                      }}
                    >
                       Urmărește pe hartă →
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function LiveOperationalSummaryPanel() {
  const metar = useLive((s) => s.metar);
  const positions = useLive((s) => s.positions);
  const vfrTracking = useLive((s) => s.vfrTracking);
  const airborne = positions?.flights.filter((f) => !f.onGround) ?? [];

  return (
    <div className="ops-stack">
      <h2 className="panel__title">Situație Trafic Real LRCV</h2>
      {metar ? (
        <div className="math-card">
          <div className="math-card__head">
            <strong>METAR LRCV ({metar.flightCategory})</strong>
            <span className="math-badge">QNH {metar.qnhHpa} hPa</span>
          </div>
          <p className="small muted">
            {metar.skyConditionDescription} · Vizibilitate {(metar.visibilityMeters / 1000).toFixed(1)} km · Temp {metar.temperatureCelsius}°C
          </p>
        </div>
      ) : (
        <p className="muted">Se încarcă METAR-ul real LRCV…</p>
      )}

      <div className="math-card">
        <div className="math-card__head">
          <strong>Trafic Radar Detectat</strong>
          <span className="num">{airborne.length} în zbor</span>
        </div>
        {airborne.length === 0 ? (
          <p className="small muted">Nicio aeronavă în zbor în aria monitorizată Craiova în acest moment.</p>
        ) : (
          <ul className="ai__citation-list">
            {airborne.slice(0, 8).map((f) => (
              <li key={f.icao24} className="ai__citation">
                <strong className="num">{f.callsign}</strong> ({f.flightRules}) · {f.distanceFromLrcvKm?.toFixed(1) ?? '—'} km de LRCV
              </li>
            ))}
          </ul>
        )}
        {vfrTracking && (
          <p className="small muted">
            Status VMC: {vfrTracking.vmc.status} — vizibilitate {(vfrTracking.vmc.visibilityMeters / 1000).toFixed(1)} km, vânt {vfrTracking.vmc.windSpeedKnots} kt
          </p>
        )}
      </div>

      <button type="button" className="btn btn--xs" onClick={() => setMode('live')}>
        Deschide harta Trafic real →
      </button>
    </div>
  );
}
