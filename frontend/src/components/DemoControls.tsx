import { WEATHER_PRESETS } from '../data/weatherPresets';
import { clockLabel } from '../sim/units';
import { BASE_TIME_OFFSET_SECONDS, SPEEDS, useApp, useIsStale } from '../state/store';
import { WindArrow } from './WindArrow';

/** Bara de sus pe pagina Demo: ceasul simulării, redare, preset meteo. */
export function DemoControls() {
  const playing = useApp((s) => s.playing);
  const speed = useApp((s) => s.speed);
  const presetId = useApp((s) => s.scenario?.weatherPresetId ?? '');
  const revision = useApp((s) => s.scenario?.revision ?? 0);
  const status = useApp((s) => s.status);
  const hasData = useApp((s) => !!s.evaluation);
  const { togglePlay, setSpeed, setWeatherPreset, reset } = useApp.getState();
  const stale = useIsStale();

  return (
    <>
      <Clock />

      <div className="group" role="group" aria-label="Redare">
        <button className="btn btn--primary" onClick={togglePlay} disabled={!hasData} aria-pressed={playing} aria-keyshortcuts="Space">
          {playing ? 'Pauză' : 'Redă'}
        </button>
        <div className="seg" role="group" aria-label="Viteza redării">
          {SPEEDS.map((s) => (
            <button key={s} className={`seg__btn ${s === speed ? 'is-on' : ''}`} onClick={() => setSpeed(s)} aria-pressed={s === speed}>
              ×{s}
            </button>
          ))}
        </div>
        <button className="btn btn--quiet" onClick={reset} disabled={!hasData}>
          Reset
        </button>
      </div>

      <Conditions />

      <label className="group">
        <span className="group__label">Meteo</span>
        <select value={presetId} onChange={(e) => setWeatherPreset(e.target.value)} disabled={!hasData}>
          {WEATHER_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <div className="spacer" />

      <div className="pills" aria-live="polite">
        {status === 'loading' && <span className="pill pill--busy">Se calculează</span>}
        {stale && status !== 'loading' && <span className="pill pill--warn">Rezultat depășit</span>}
        {status === 'error' && <span className="pill pill--err">Serviciu indisponibil</span>}
        <span className="pill" title="Revizia scenariului; crește la fiecare modificare">rev {revision}</span>
      </div>
    </>
  );
}

/** Singura parte din bară care se actualizează la fiecare cadru. */
function Clock() {
  const t = useApp((s) => s.simTimeSeconds);
  return (
    <div className="clock" title="Ora scenariului">
      <span className="clock__time">{clockLabel(BASE_TIME_OFFSET_SECONDS + t)}</span>
    </div>
  );
}

/** Pista în folosință și vântul, ca în ATIS: primul lucru pe care îl verifică un controlor. */
function Conditions() {
  const result = useApp((s) => s.evaluation?.result ?? null);
  const runway = useApp((s) => s.evaluation?.traffic.runway ?? null);
  if (!result || !runway) return null;
  const w = result.weather;
  return (
    <div className="atis">
      <span className="atis__rwy" title="Pista în folosință">
        RWY {runway}
      </span>
      <WindArrow direction={w.windDirectionDegrees} />
      <span className="atis__wind">
        {String(w.windDirectionDegrees).padStart(3, '0')}° {w.windSpeedKnots}
        {w.windGustKnots > w.windSpeedKnots ? `G${w.windGustKnots}` : ''} kt
      </span>
      <span className={`atis__xw ${result.isCrosswindCriticalForLightAircraft ? 'is-critical' : ''}`} title="Vânt lateral pe pista în folosință">
        lateral {result.activeRunwayCrosswindKnots} kt
      </span>
    </div>
  );
}
