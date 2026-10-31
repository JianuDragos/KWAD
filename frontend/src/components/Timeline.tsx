// Timeline simplu de sosiri, legat de aceeași stare ca harta. Modulul complet (cererea VFR,
// variante, Apply) este al lui Daha; aici e doar afișarea și selecția.
import { useState, type PointerEvent } from 'react';
import type { FlightView } from '../sim/traffic';
import { clockLabel } from '../sim/units';
import { BASE_TIME_OFFSET_SECONDS, useApp } from '../state/store';
import { STATUS_CLASS, isUnsequenced } from './flightStyle';

const sequenceTime = (f: FlightView) => f.slot?.calculatedTimeSeconds ?? f.aircraft.etaSeconds;

export function Timeline() {
  const ev = useApp((s) => s.evaluation);
  const selectedId = useApp((s) => s.selectedId);
  const { select, seek } = useApp.getState();
  const [collapsed, setCollapsed] = useState(false);
  if (!ev) return <section className="timeline" />;

  const { startSeconds: t0, endSeconds: t1 } = ev.traffic;
  const flights = [...ev.traffic.flights].sort((a, b) => sequenceTime(a) - sequenceTime(b));
  const x = (s: number) => `${((s - t0) / (t1 - t0)) * 100}%`;
  const ticks: number[] = [];
  for (let s = Math.ceil(t0 / 120) * 120; s <= t1; s += 120) ticks.push(s);

  const onAxis = (e: PointerEvent<HTMLDivElement>) => {
    if (e.type === 'pointerdown') e.currentTarget.setPointerCapture(e.pointerId);
    else if (e.buttons !== 1) return;
    const r = e.currentTarget.getBoundingClientRect();
    seek(t0 + ((e.clientX - r.left) / r.width) * (t1 - t0));
  };

  return (
    <section className={`timeline ${collapsed ? 'timeline--collapsed' : ''}`} aria-label="Cronologia sosirilor">
      <div className="tl-row tl-row--axis">
        <div className="tl-label">
          {/* Restrâns rămâne doar axa, ca ceasul să poată fi mutat în continuare. */}
          <button className="tl-toggle" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
            <span className="tl-toggle__chev" aria-hidden="true">
              {collapsed ? '▸' : '▾'}
            </span>
            Cronologie
          </button>
        </div>
        <div className="tl-track tl-axis" onPointerDown={onAxis} onPointerMove={onAxis} title="Click sau trage pentru a muta ceasul">
          {ticks.map((s) => (
            <span key={s} className="tl-tick" style={{ left: x(s) }}>
              {clockLabel(BASE_TIME_OFFSET_SECONDS + s, false)}
            </span>
          ))}
          <NowLine t0={t0} t1={t1} />
        </div>
      </div>
      <div className="tl-body">
        {flights.map((f) => (
          <div key={f.id} className={`tl-row ${f.id === selectedId ? 'is-selected' : ''}`} onClick={() => select(f.id)}>
            <button className="tl-label tl-label--btn" aria-pressed={f.id === selectedId}>
              <span className={`rules rules--${f.aircraft.flightRules.toLowerCase()}`}>{f.aircraft.flightRules}</span> {f.callsign}
            </button>
            <div className="tl-track">
              <span
                className="tl-window"
                style={{ left: x(f.aircraft.earliestSeconds), width: `calc(${x(f.aircraft.latestSeconds)} - ${x(f.aircraft.earliestSeconds)})` }}
                title="Fereastra de sosire"
              />
              <span className="tl-eta" style={{ left: x(f.aircraft.etaSeconds) }} title="ETA" />
              {f.slot && <span className={`tl-slot ${STATUS_CLASS[f.status]}`} style={{ left: x(f.slot.calculatedTimeSeconds) }} title="Slot planificat" />}
              {!f.slot && (
                <span className={`tl-flag ${isUnsequenced(f) ? 'tl-flag--warn' : STATUS_CLASS[f.status]}`} style={{ left: x(f.aircraft.etaSeconds) }}>
                  {isUnsequenced(f) ? 'fără slot' : f.status === 'DivertRecommended' ? 'deviere' : 'așteptare'}
                </span>
              )}
            </div>
          </div>
        ))}
        <div className="tl-nowlayer" aria-hidden="true">
          <NowLine t0={t0} t1={t1} />
        </div>
      </div>
      <div className="tl-legend muted small">
        <span>
          <i className="lg lg--window" /> fereastră de sosire
        </span>
        <span>
          <i className="lg lg--eta" /> ETA
        </span>
        <span>
          <i className="lg lg--slot" /> slot planificat
        </span>
      </div>
    </section>
  );
}

/** Linia „acum”: singurul element din cronologie care se actualizează la fiecare cadru. */
function NowLine({ t0, t1 }: { t0: number; t1: number }) {
  const t = useApp((s) => s.simTimeSeconds);
  return <span className="tl-now" style={{ left: `${((t - t0) / (t1 - t0)) * 100}%` }} />;
}
