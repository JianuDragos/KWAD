import { useAssistant } from '../state/assistant';
import { setMode, type Mode } from '../state/mode';
import { useApp } from '../state/store';
import { DemoControls } from './DemoControls';
import { LiveControls } from './LiveControls';
import { SettingsMenu } from './SettingsMenu';

export function TopBar({ mode }: { mode: Mode }) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand__name">AERIS</span>
        <span className="brand__apt">Craiova LRCV</span>
      </div>
      {/* Comutator principal: date reale sau simulare. Asistentul se deschide din butonul din dreapta. */}
      <div className="seg seg--mode" role="group" aria-label="Modul operațional">
        <button
          className={`seg__btn ${mode === 'live' ? 'is-on' : ''}`}
          onClick={() => setMode('live')}
          aria-pressed={mode === 'live'}
        >
          Trafic real
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
      <AssistantButton active={mode === 'assistant'} />
      <SettingsMenu mode={mode} />
    </header>
  );
}

/** Deschide Asistentul; punctul roșu apare cât timp Asistentul are o recomandare la care nu s-a răspuns. */
function AssistantButton({ active }: { active: boolean }) {
  const hasRecommendation = useApp((s) => s.vfrPlan.status === 'proposed');
  return (
    <button
      type="button"
      className={`assistant-btn ${active ? 'is-on' : ''}`}
      onClick={() => setMode('assistant')}
      aria-pressed={active}
      title={hasRecommendation ? 'Asistentul are o recomandare nouă' : 'Deschide Asistentul'}
    >
      Asistent
      {hasRecommendation && <span className="assistant-btn__dot" aria-label="recomandare nouă" />}
    </button>
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
        <span className="pill pill--ok" title="Qwen3-4B-Instruct-2507 + Verificare numerică C#">
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
