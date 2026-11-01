import type { TrafficPresetId } from '../contracts/backend';
import { WEATHER_PRESETS } from '../data/weatherPresets';
import { clockLabel } from '../sim/units';
import { useSpeed } from '../state/units';
import { BASE_TIME_OFFSET_SECONDS, SPEEDS, useApp, useIsStale } from '../state/store';
import { WindArrow } from './WindArrow';
import { HINT } from '../data/glossary';

/** Bara de sus pe pagina Demo: ceasul simulării, redarea, pista și vântul. Scenariul se alege în panoul din dreapta. */
export function DemoControls() {
  const playing = useApp((s) => s.playing);
  const speed = useApp((s) => s.speed);
  const status = useApp((s) => s.status);
  const hasData = useApp((s) => !!s.evaluation);
  const evaluationResult = useApp((s) => s.evaluation?.result);
  const { togglePlay, setSpeed, reset } = useApp.getState();
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
        <button className="btn btn--quiet" onClick={reset} disabled={!hasData} aria-label="Reset" title="Reia scenariul de la început">
          ↺
        </button>
      </div>

      <Conditions />

      <div className="spacer" />

      <div className="pills" aria-live="polite">
        {status === 'loading' && <span className="pill pill--busy">Se calculează</span>}
        {stale && status !== 'loading' && <span className="pill pill--warn">Rezultat depășit</span>}
        {status === 'error' && <span className="pill pill--err">Serviciu indisponibil</span>}
        {evaluationResult?.safetyAssessment?.isSafe && (
          <span className="pill pill--ok" title={`${HINT.SAFE}\n\n${evaluationResult.safetyAssessment.summary}`}>
            ● Traiectorii Sigure (EASA)
          </span>
        )}
        {evaluationResult?.safetyAssessment && !evaluationResult.safetyAssessment.isSafe && (
          <span className="pill pill--warn" title={`${HINT.CONFLICTS}\n\n${evaluationResult.safetyAssessment.summary}`}>
            ▲ {evaluationResult.safetyAssessment.conflicts.length} Conflicte
          </span>
        )}
      </div>
    </>
  );
}

/** Singura parte din bară care se actualizează la fiecare cadru. */
function Clock() {
  const t = useApp((s) => s.simTimeSeconds);
  return (
    <div className="clock" title={HINT.SCENARIO_CLOCK}>
      <span className="clock__time">{clockLabel(BASE_TIME_OFFSET_SECONDS + t)}</span>
    </div>
  );
}

/** Pista în folosință și vântul, ca în ATIS: primul lucru pe care îl verifică un controlor. */
function Conditions() {
  const result = useApp((s) => s.evaluation?.result ?? null);
  const runway = useApp((s) => s.evaluation?.traffic.runway ?? null);
  const speed = useSpeed();
  if (!result || !runway) return null;
  const w = result.weather;
  return (
    <div className="atis">
      <span className="atis__rwy" title={HINT.RWY}>
        RWY {runway}
      </span>
      <WindArrow direction={w.windDirectionDegrees} />
      <span className="atis__wind" title={HINT.WIND}>
        {String(w.windDirectionDegrees).padStart(3, '0')}° {speed.value(w.windSpeedKnots)}
        {w.windGustKnots > w.windSpeedKnots ? `G${speed.value(w.windGustKnots)}` : ''} {speed.unit}
      </span>
      <span className={`atis__xw ${result.isCrosswindCriticalForLightAircraft ? 'is-critical' : ''}`} title={HINT.CROSSWIND}>
        lateral {speed.label(result.activeRunwayCrosswindKnots)}
      </span>
    </div>
  );
}

/** Alegerea scenariului Demo (trafic și vreme), în panoul de sosiri: schimbă lista de dedesubt. */
export function ScenarioPicker() {
  const presetId = useApp((s) => s.scenario?.weatherPresetId ?? '');
  const trafficPreset = useApp((s) => s.scenario?.trafficPreset ?? 'default');
  const status = useApp((s) => s.status);
  const hasData = useApp((s) => !!s.evaluation);
  const { setWeatherPreset, setTrafficPreset } = useApp.getState();
  return (
    <div className="scenario">
      <label className="scenario__field">
        <span className="scenario__label">Trafic</span>
        <select value={trafficPreset} onChange={(e) => void setTrafficPreset(e.target.value as TrafficPresetId)} disabled={status === 'loading'}>
          <option value="default">Standard LRCV</option>
          <option value="eurasia">Eurasia (din China)</option>
        </select>
      </label>
      <label className="scenario__field">
        <span className="scenario__label">Vreme</span>
        <select value={presetId} onChange={(e) => setWeatherPreset(e.target.value)} disabled={!hasData}>
          {WEATHER_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
