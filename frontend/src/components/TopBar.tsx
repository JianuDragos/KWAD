import { useEffect, useState } from 'react';
import { API_MOCK } from '../api/client';
import { WEATHER_PRESETS } from '../data/weatherPresets';
import { runwayForWind, windComponents } from '../sim/live';
import { clockLabel } from '../sim/units';
import { useLive } from '../state/live';
import { setMode, type Mode } from '../state/mode';
import { BASE_TIME_OFFSET_SECONDS, SPEEDS, useApp, useIsStale } from '../state/store';

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
    </header>
  );
}

function LiveControls() {
  const metar = useLive((s) => s.metar);
  const updatedAtMs = useLive((s) => s.updatedAtMs);
  const error = useLive((s) => s.positionsError);
  const runway = metar ? runwayForWind(metar.windDirectionDegrees, metar.windSpeedKnots) : null;
  const xw = metar && runway && metar.windDirectionDegrees != null ? windComponents(metar.windDirectionDegrees, metar.windGustKnots ?? metar.windSpeedKnots, runway).crosswind : null;
  return (
    <>
      <UtcClock />
      {metar && runway && (
        <div className="atis">
          <span className="atis__rwy" title="Pista cu vânt de față, după METAR">
            RWY {runway}
          </span>
          {metar.windDirectionDegrees != null && <WindArrow direction={metar.windDirectionDegrees} />}
          <span className="atis__wind">
            {metar.isWindVariable || metar.windDirectionDegrees == null ? 'VRB' : `${String(metar.windDirectionDegrees).padStart(3, '0')}°`} {metar.windSpeedKnots}
            {metar.windGustKnots ? `G${metar.windGustKnots}` : ''} kt
          </span>
          <span className="atis__xw">QNH {metar.qnhHpa}</span>
          {xw != null && <span className={`atis__xw ${xw > 12 ? 'is-critical' : ''}`}>lateral {xw} kt</span>}
        </div>
      )}
      <div className="spacer" />
      <div className="pills" aria-live="polite">
        {error && <span className="pill pill--err">Fără date noi</span>}
        {updatedAtMs && <UpdatedAgo at={updatedAtMs} />}
        {API_MOCK && <span className="pill pill--mock">Date de exemplu</span>}
      </div>
    </>
  );
}

function UtcClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="clock" title="Ora reală, UTC">
      <span className="clock__time">{now.toISOString().slice(11, 19)}</span>
      <span className="clock__zone">UTC</span>
    </div>
  );
}

function UpdatedAgo({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.round((now - at) / 1000));
  return <span className={`pill ${s > 45 ? 'pill--warn' : ''}`}>actualizat acum {s} s</span>;
}

function DemoControls() {
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
        {API_MOCK && <span className="pill pill--mock">Date de exemplu</span>}
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
