// Tab-ul dedicat „Asistent”: spațiu de conversație tactică ATC (model AI local + verificarea cifrelor în backend)
// și panou interactiv de analiză & decizie pentru problemele operaționale (VFR Așteptare Rând vs. Redirecționare Alternativă).
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { WEATHER_PRESETS } from '../data/weatherPresets';
import { clockLabel } from '../sim/units';
import { useAssistant, type AssistantMessage } from '../state/assistant';
import { useLive } from '../state/live';
import { setMode } from '../state/mode';
import { BASE_TIME_OFFSET_SECONDS, useApp } from '../state/store';
import { useDistance, useSpeed, useUnitText } from '../state/units';

interface TacticalCategory {
  id: string;
  title: string;
  roleNote: string;
  prompts: string[];
}

const DEMO_TACTICAL_CATEGORIES: TacticalCategory[] = [
  {
    id: 'vfr-decision',
    title: 'Decizie VFR',
    roleNote: 'Evaluează PNR, combustibilul și plafonul de vânt lateral pe LRCV față de Aerodromul Balta Verde (LRCW — Aeroclubul României) și Slatina.',
    prompts: [
      'Analizează aeronavele VFR în așteptare: care pot ateriza pe LRCV după IFR și care trebuie redirecționate?',
      'Calculează marja PNR, combustibilul rămas și aerodromul alternativ optim pentru YR-5123.',
      'Compară condițiile de aterizare pe Aerodromul Balta Verde (LRCW) și Slatina pentru traficul VFR afectat de vânt.',
    ],
  },
  {
    id: 'sequencing',
    title: 'Secvențiere',
    roleNote: 'Ordinea cronologică la prag, întârzierile alocate și protecția la turbulența de siaj EASA.',
    prompts: [
      'Care este ordinea programată la aterizare pe pista activă și ce întârzieri apar?',
      'Există conflicte de separare 4D sau restricții de turbulență de siaj între zborurile active?',
      'Care este situația generală a sectorului LRCV și câte aeronave sunt în holding?',
    ],
  },
  {
    id: 'weather-window',
    title: 'Vânt & meteo',
    roleNote: 'Evoluția forfecării vântului (2000/5000 ft), altitudinea de densitate și fereastra optimă VFR.',
    prompts: [
      'Când apare o fereastră meteo sigură pentru aterizarea VFR pe LRCV în următoarele 45 de minute?',
      'Care sunt componentele de vânt lateral și frontal pe pista activă și la 2000 ft?',
    ],
  },
  {
    id: 'kinematics',
    title: 'Coborâre & pistă',
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
    title: 'METAR & pistă',
    roleNote: ' Evaluează vântul real, vizibilitatea, plafonul și eligibilitatea VMC/IMC pe Craiova.',
    prompts: [
      'Care este starea meteo actuală pe LRCV conform METAR și ce pistă este activă?',
      'Sunt îndeplinite condițiile VMC pentru operarea zborurilor VFR în acest moment?',
    ],
  },
  {
    id: 'live-radar',
    title: 'Trafic radar',
    roleNote: 'Aeronave detectate în timp real în sectorul Craiova și estimările de sosire.',
    prompts: [
      'Câte aeronave sunt în zbor acum în zona Craiova și ce reguli de zbor au?',
      'Care este ordinea estimată la aterizare pentru traficul real detectat?',
    ],
  },
];

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
               Analiză conversațională în limba română ancorată strict în calculele fizice AERIS (fiecare cifră din răspuns e verificată în calcule).
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
                <span className="chat-msg__author">Asistent AERIS</span>
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
  const unitText = useUnitText();

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
          <span className="muted small">{msg.createdAtLabel}</span>
        </div>
      </div>

      <div className="ai__direct">{unitText(msg.text)}</div>

      <button
        type="button"
        className="ai__proof-toggle"
        onClick={() => setShowProof((v) => !v)}
        aria-expanded={showProof}
      >
        {showProof ? '▾ Ascunde datele folosite' : '▸ Vezi datele folosite'}
      </button>

      {showProof && (
        <div className="ai__proof">
          <p className="small muted">
            {ans.fallbackReason || ver?.hallucinationBlocked
              ? 'Răspuns construit direct din datele de mai jos.'
              : ver && ver.totalNumbersInAnswer > 0
                ? `✓ Toate cifrele din răspuns (${ver.totalNumbersInAnswer}) se regăsesc în datele de mai jos.`
                : '✓ Răspunsul se bazează pe datele de mai jos.'}
          </p>
          <div>
            <span className="ai__proof-lbl">Date din calcule pe care se bazează răspunsul:</span>
            <ul className="ai__citation-list">
              {(ver?.citations ?? ans.sentences.map((t, i) => ({ id: ans.statementIds[i] ?? `s${i}`, sourceId: ans.sourceIds[0] ?? 'AERIS', text: t }))).map(
                (c) => (
                  <li key={c.id} className="ai__citation">
                    {unitText(c.text)}
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

function DemoTacticalProblemsPanel() {
  const evaluation = useApp((s) => s.evaluation);
  const scenario = useApp((s) => s.scenario);
  const plan = useApp((s) => s.vfrPlan);
  const status = useApp((s) => s.status);
  const error = useApp((s) => s.error);
  const d = useDistance().label;
  const { setWeatherPreset, select } = useApp.getState();
  if (!evaluation || !scenario) {
    return status === 'error' ? (
      <div className="notice notice--err">
        <p>Datele scenariului nu s-au putut încărca: {error}</p>
        <button type="button" className="btn btn--outline btn--xs" onClick={() => void useApp.getState().load()}>
          Reîncearcă
        </button>
      </div>
    ) : (
      <p className="muted">Se încarcă datele scenariului…</p>
    );
  }
  const locked = plan.status === 'accepted' || plan.status === 'rejected';
  const vfr = evaluation.traffic.flights.filter((f) => f.aircraft.flightRules === 'VFR');

  return (
    <div className="ops-stack">
      <h2 className="panel__title">Plan de aterizare · RWY {evaluation.traffic.runway}</h2>
      <p className="muted small">
        Asistentul propune ordinea de aterizare pentru tot traficul: întâi avioanele IFR, apoi cele VFR care așteaptă
        în holding la Cârcea.
      </p>
      <div className="ops-weather-bar">
        <span className="ops-weather-bar__lbl">Vreme în scenariu</span>
        <div className="seg ops-weather-seg" role="group" aria-label="Vreme în scenariu">
          {WEATHER_PRESETS.map((p) => (
            <button key={p.id} type="button" disabled={locked}
              className={`seg__btn ${scenario.weatherPresetId === p.id ? 'is-on' : ''}`}
              aria-pressed={scenario.weatherPresetId === p.id}
              title={locked ? 'Reset în Demo pentru un nou scenariu meteo' : undefined}
              onClick={() => setWeatherPreset(p.id)}>{p.label}</button>
          ))}
        </div>
      </div>
      <p className="notice">
        {plan.status === 'accepted'
          ? `Plan acceptat. Avioanele IFR aterizează la cel puțin ${d(5)} unul de altul, apoi VFR-urile, la cel puțin ${d(4)} pe finală.`
          : plan.status === 'rejected'
            ? 'Plan refuzat. VFR-urile rămân în holding și le coordonezi tu prin radio.'
            : `Propunerea apare când primul IFR e la ${d(30)} de aeroport. O poți accepta până ajunge la ${d(20)}; după aceea se refuză singură, iar VFR-urile rămân în holding.`}
      </p>
      {vfr.map((f) => (
        <article key={f.id} className="vfr-card vfr-card--wait">
          <div className="vfr-card__head"><strong>{f.callsign}</strong><span className="muted small">{f.aircraft.modelName}</span></div>
          <p>{f.slot ? `Aterizează pe RWY ${evaluation.traffic.runway} la ${clock(f.slot.calculatedTimeSeconds)}` : 'În holding la Cârcea · așteaptă planul de aterizare'}</p>
          <button type="button" className="btn-link" onClick={() => { select(f.id); setMode('demo'); }}>Urmărește pe hartă →</button>
        </article>
      ))}
    </div>
  );
}

function LiveOperationalSummaryPanel() {
  const metar = useLive((s) => s.metar);
  const positions = useLive((s) => s.positions);
  const vfrTracking = useLive((s) => s.vfrTracking);
  const airborne = positions?.flights.filter((f) => !f.onGround) ?? [];
  const distance = useDistance();
  const speed = useSpeed();

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
                <strong className="num">{f.callsign}</strong> ({f.flightRules}) · {f.distanceFromLrcvKm == null ? '—' : distance.label(f.distanceFromLrcvKm / 1.852)} de LRCV
              </li>
            ))}
          </ul>
        )}
        {vfrTracking && (
          <p className="small muted">
            Status VMC: {vfrTracking.vmc.status} — vizibilitate {(vfrTracking.vmc.visibilityMeters / 1000).toFixed(1)} km, vânt {speed.label(vfrTracking.vmc.windSpeedKnots)}
          </p>
        )}
      </div>

      <button type="button" className="btn btn--xs" onClick={() => setMode('live')}>
        Deschide harta Trafic real →
      </button>
    </div>
  );
}
