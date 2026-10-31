import { API_MOCK } from '../api/client';
import { WEATHER_PRESETS } from '../data/weatherPresets';
import { clockLabel } from '../sim/units';
import { BASE_TIME_OFFSET_SECONDS, SPEEDS, useApp, useIsStale } from '../state/store';

export function TopBar() {
  const t = useApp((s) => s.simTimeSeconds);
  const playing = useApp((s) => s.playing);
  const speed = useApp((s) => s.speed);
  const presetId = useApp((s) => s.scenario?.weatherPresetId ?? '');
  const revision = useApp((s) => s.scenario?.revision ?? 0);
  const status = useApp((s) => s.status);
  const weather = useApp((s) => s.scenario?.weather ?? null);
  const hasData = useApp((s) => !!s.evaluation);
  const { togglePlay, setSpeed, setWeatherPreset, reset } = useApp.getState();
  const stale = useIsStale();

  return (
    <header className="topbar">
      <div className="brand">
        AERIS <span className="brand__apt">LRCV · Craiova</span>
      </div>

      <div className="clock" title="Ora scenariului. Backendul calculează față de o bază fixă 14:00, fără dată sau fus orar.">
        <span className="clock__time">{clockLabel(BASE_TIME_OFFSET_SECONDS + t)}</span>
        <span className="clock__label">ora scenariului</span>
      </div>

      <div className="group" role="group" aria-label="Redare">
        <button className="btn btn--primary" onClick={togglePlay} disabled={!hasData} aria-pressed={playing} title="Spațiu">
          {playing ? '❚❚ Pauză' : '▶ Redă'}
        </button>
        {SPEEDS.map((s) => (
          <button key={s} className={`btn btn--seg ${s === speed ? 'is-on' : ''}`} onClick={() => setSpeed(s)} aria-pressed={s === speed}>
            ×{s}
          </button>
        ))}
      </div>

      <label className="group weather">
        <span className="group__label">Meteo</span>
        <select value={presetId} onChange={(e) => setWeatherPreset(e.target.value)} disabled={!hasData}>
          {WEATHER_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {weather && <WindArrow direction={weather.windDirectionDegrees} />}
      </label>

      <button className="btn" onClick={reset} disabled={!hasData}>
        ↺ Reset
      </button>

      <div className="spacer" />

      <div className="pills">
        {status === 'loading' && <span className="pill pill--busy">se calculează…</span>}
        {stale && status !== 'loading' && <span className="pill pill--warn">rezultat depășit</span>}
        {status === 'error' && <span className="pill pill--err">eroare backend</span>}
        <span className="pill" title="Revizia scenariului; crește la fiecare modificare">rev {revision}</span>
        <span className={`pill ${API_MOCK ? 'pill--mock' : 'pill--live'}`} title={API_MOCK ? 'Port local al backendului (src/api/mockBackend.ts)' : 'Backend .NET prin proxy Vite → localhost:5271'}>
          {API_MOCK ? 'MOCK · date de exemplu' : 'backend :5271'}
        </span>
      </div>
    </header>
  );
}

/** Săgeata arată încotro bate vântul (vântul vine DIN direcția raportată). */
function WindArrow({ direction }: { direction: number }) {
  return (
    <svg className="wind" viewBox="0 0 24 24" aria-label={`Vânt din ${direction}°`} role="img">
      <g transform={`rotate(${direction + 180} 12 12)`}>
        <path d="M12 3 L12 19 M7 8 L12 3 L17 8" />
      </g>
    </svg>
  );
}
