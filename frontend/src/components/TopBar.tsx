import { getAwaitingVfrFlights } from '../sim/traffic';
import { SPEED_UNIT_LABEL } from '../sim/units';
import { useAssistant } from '../state/assistant';
import { setMode, type Mode } from '../state/mode';
import { useApp } from '../state/store';
import { useUnits } from '../state/units';
import { DemoControls } from './DemoControls';
import { LiveControls } from './LiveControls';
import { HINT } from '../data/glossary';

export function TopBar({ mode }: { mode: Mode }) {
  const evaluation = useApp((s) => s.evaluation);
  const simTimeSeconds = useApp((s) => s.simTimeSeconds);
  const flights = evaluation?.traffic.flights;
  const awaitingVfr = flights ? getAwaitingVfrFlights(flights, simTimeSeconds) : [];
  const vfrRec = useAssistant((s) => s.vfrRecommendation);
  const vfrAlertCount = flights ? flights.filter((f) => f.tacticalDecision !== null).length : 0;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand__name">AERIS</span>
        <span className="brand__apt">Craiova LRCV</span>
      </div>
      {/* Comutator principal: Trafic real, Asistent Tactic 4B (chiar lângă Trafic real) și Simulare Demo. */}
      <div className="seg seg--mode" role="group" aria-label="Modul operațional">
        <button
          className={`seg__btn ${mode === 'live' ? 'is-on' : ''}`}
          onClick={() => setMode('live')}
          aria-pressed={mode === 'live'}
        >
          Trafic real
        </button>
        <button
          className={`seg__btn ${mode === 'assistant' ? 'is-on is-assistant' : ''}`}
          onClick={() => setMode('assistant')}
          aria-pressed={mode === 'assistant'}
        >
          Asistent
          {awaitingVfr.length >= 2 ? (
            <span
              className={`tab-badge ${vfrRec.status === 'rejected' ? 'is-rejected' : 'is-alert'}`}
              title={`${awaitingVfr.length} aeronave VFR sunt în așteptare pentru aterizare — Recomandare apropiere ${vfrRec.status === 'rejected' ? 'refuzată de controlor' : 'activă'}`}
            >
              {vfrRec.status === 'rejected' ? 'Refuzat' : `${awaitingVfr.length} VFR`}
            </span>
          ) : vfrAlertCount > 0 ? (
            <span className="tab-badge" title={`${vfrAlertCount} aeronave VFR necesită decizie tactică`}>
              {vfrAlertCount}
            </span>
          ) : null}
        </button>
        <button
          className={`seg__btn ${mode === 'demo' ? 'is-on is-demo' : ''}`}
          onClick={() => setMode('demo')}
          aria-pressed={mode === 'demo'}
        >
          Demo
        </button>
      </div>
      {mode === 'demo' ? <DemoControls /> : mode === 'assistant' ? <AssistantTopControls /> : <LiveControls />}
      <SpeedUnitSwitch />
    </header>
  );
}

function AssistantTopControls() {
  const contextSource = useAssistant((s) => s.contextSource);
  const setContextSource = useAssistant((s) => s.setContextSource);
  const clearHistory = useAssistant((s) => s.clearHistory);
  const msgCount = useAssistant((s) => s.messages.length);
  const simResult = useApp((s) => s.evaluation?.result ?? null);

  return (
    <>
      <div className="group" role="group" aria-label="Sursă date analizate de Asistent">
        <span className="group__label">Context analizat</span>
        <div className="seg">
          <button
            type="button"
            className={`seg__btn ${contextSource === 'demo' ? 'is-on' : ''}`}
            onClick={() => setContextSource('demo')}
            aria-pressed={contextSource === 'demo'}
          >
            Simulare Demo
          </button>
          <button
            type="button"
            className={`seg__btn ${contextSource === 'live' ? 'is-on' : ''}`}
            onClick={() => setContextSource('live')}
            aria-pressed={contextSource === 'live'}
          >
            Trafic real LRCV
          </button>
        </div>
      </div>

      {contextSource === 'demo' && simResult && (
        <div className="atis">
          <span className="atis__rwy">RWY {simResult.activeRunway}</span>
          <span className={`atis__xw ${simResult.isCrosswindCriticalForLightAircraft ? 'is-critical' : ''}`}>
            lateral {simResult.activeRunwayCrosswindKnots} kt · {simResult.stats.totalInbounds} aeronave
          </span>
        </div>
      )}

      <div className="spacer" />

      <div className="pills">
        <span className="pill pill--ok" title="Qwen3-4B-Instruct-2507 + Scut matematic C# anti-halucinație">
          ● Qwen3-4B + Verificare C#
        </span>
        {msgCount > 0 && (
          <button type="button" className="btn btn--quiet btn--xs" onClick={clearHistory}>
            Șterge conversația
          </button>
        )}
      </div>
    </>
  );
}

function SpeedUnitSwitch() {
  const unit = useUnits((s) => s.speed);
  const setSpeed = useUnits((s) => s.setSpeed);
  return (
    <div className="seg" role="group" aria-label="Unitatea vitezei" title={HINT.SPEED_UNIT}>
      {(['kmh', 'kt'] as const).map((u) => (
        <button key={u} className={`seg__btn ${unit === u ? 'is-on' : ''}`} onClick={() => setSpeed(u)} aria-pressed={unit === u}>
          {SPEED_UNIT_LABEL[u]}
        </button>
      ))}
    </div>
  );
}
