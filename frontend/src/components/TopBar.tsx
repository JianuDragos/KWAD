import { SPEED_UNIT_LABEL } from '../sim/units';
import { setMode, type Mode } from '../state/mode';
import { useUnits } from '../state/units';
import { DemoControls } from './DemoControls';
import { LiveControls } from './LiveControls';
import { HINT } from '../data/glossary';

export function TopBar({ mode }: { mode: Mode }) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand__name">AERIS</span>
        <span className="brand__apt">Craiova LRCV</span>
      </div>
      {/* Comutator vizibil: controlorul trebuie să știe mereu dacă vede date reale sau simulare. */}
      <div className="seg seg--mode" role="group" aria-label="Sursa datelor">
        <button className={`seg__btn ${mode === 'live' ? 'is-on' : ''}`} onClick={() => setMode('live')} aria-pressed={mode === 'live'}>
          Live
        </button>
        <button className={`seg__btn ${mode === 'demo' ? 'is-on is-demo' : ''}`} onClick={() => setMode('demo')} aria-pressed={mode === 'demo'}>
          Demo
        </button>
      </div>
      {mode === 'demo' ? <DemoControls /> : <LiveControls />}
      <SpeedUnitSwitch />
    </header>
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
