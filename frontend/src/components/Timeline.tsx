// Timeline de sosiri și traiectorii (Apropiere LRCV vs. De la Decolare).
import { useState, type PointerEvent } from 'react';
import type { FlightView } from '../sim/traffic';
import { clockLabel } from '../sim/units';
import { BASE_TIME_OFFSET_SECONDS, useApp } from '../state/store';
import { STATUS_CLASS, isUnsequenced } from './flightStyle';
import { HINT } from '../data/glossary';

const sequenceTime = (f: FlightView) => f.slot?.calculatedTimeSeconds ?? f.resolvedLandingSeconds ?? f.aircraft.etaSeconds;

function chooseTickStep(spanSeconds: number): number {
  if (spanSeconds <= 2400) return 120;      // <= 40 min → la 2 minute
  if (spanSeconds <= 7200) return 600;      // <= 2 ore → la 10 minute
  if (spanSeconds <= 18000) return 1800;    // <= 5 ore → la 30 minute
  return 3600;                              // > 5 ore (ex. Beijing → Craiova) → la 1 oră
}

export function Timeline() {
  const ev = useApp((s) => s.evaluation);
  const selectedId = useApp((s) => s.selectedId);
  const timelineScope = useApp((s) => s.timelineScope);
  const { select, seek, setTimelineScope } = useApp.getState();
  const [collapsed, setCollapsed] = useState(false);
  const [dragRange, setDragRange] = useState<{ start: number; end: number } | null>(null);
  if (!ev) return <section className="timeline" />;

  const t0 = dragRange?.start ?? (timelineScope === 'mission' ? ev.traffic.missionStartSeconds : ev.traffic.startSeconds);
  const t1 = dragRange?.end ?? ev.traffic.endSeconds;
  const span = Math.max(60, t1 - t0);
  const step = chooseTickStep(span);
  const notificationTime = ev.traffic.notificationSeconds;
  const showNotification = notificationTime != null && notificationTime >= t0 && notificationTime <= t1;

  const flights = [...ev.traffic.flights].sort((a, b) => sequenceTime(a) - sequenceTime(b));
  const pct = (s: number) => ((s - t0) / span) * 100;
  const x = (s: number) => `${pct(s)}%`;
  const xClamped = (s: number) => `${Math.max(0, Math.min(100, pct(s)))}%`;

  const ticks: number[] = [];
  for (let s = Math.ceil(t0 / step) * step; s <= t1; s += step) ticks.push(s);

  const onAxis = (e: PointerEvent<HTMLDivElement>) => {
    if (e.type === 'pointerdown') {
      setDragRange({ start: t0, end: t1 });
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    else if (e.buttons !== 1) return;
    const r = e.currentTarget.getBoundingClientRect();
    seek(t0 + ((e.clientX - r.left) / r.width) * span);
  };

  return (
    <section className={`timeline ${collapsed ? 'timeline--collapsed' : ''}`} aria-label="Cronologia sosirilor">
      <div className="tl-main">
      <div className="tl-row tl-row--axis">
        <div className="tl-label tl-label--hdr">
          <button className="tl-toggle" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed} aria-label="Cronologie">
            <span className="tl-toggle__chev" aria-hidden="true">
              {collapsed ? '▸' : '▾'}
            </span>
            <span className="tl-toggle__text">Cronologie</span>
          </button>
          <div className="tl-scope" role="group" aria-label="Domeniu cronologie">
            <button
              type="button"
              className={`tl-scope__btn ${timelineScope === 'mission' ? 'is-on' : ''}`}
              onClick={() => setTimelineScope('mission')}
              title="Întregul zbor de la prima decolare până la aterizare"
            >
              Decolare
            </button>
            <button
              type="button"
              className={`tl-scope__btn ${timelineScope === 'approach' ? 'is-on' : ''}`}
              onClick={() => setTimelineScope('approach')}
              title="Fereastra terminală de apropiere LRCV"
            >
              Apropiere
            </button>
          </div>
        </div>
        <div className="tl-track tl-axis" onPointerDown={onAxis} onPointerMove={onAxis}
          onPointerUp={() => setDragRange(null)} onPointerCancel={() => setDragRange(null)}
          title="Click sau trage pentru a muta ceasul">
          {ticks.map((s) => (
            <span key={s} className="tl-tick" style={{ left: x(s) }}>
              {clockLabel(BASE_TIME_OFFSET_SECONDS + s, false)}
            </span>
          ))}
          {showNotification && (
            <span
              className="tl-notification"
              role="img"
              aria-label={`Notificare tactică la ${clockLabel(BASE_TIME_OFFSET_SECONDS + notificationTime)} (30 NM)`}
              title={`Notificarea apare la ${clockLabel(BASE_TIME_OFFSET_SECONDS + notificationTime)} · 30 NM`}
              style={{ left: x(notificationTime) }}
            >
              ◆
            </span>
          )}
        </div>
      </div>
      <div className="tl-body">
        <div className="tl-rows">
          {flights.map((f) => {
            const endFlightSec = f.landingSeconds ?? f.resolvedLandingSeconds ?? f.track[f.track.length - 1]?.timeSeconds ?? f.aircraft.etaSeconds;
            const airLeft = Math.max(0, pct(f.takeoffSeconds));
            const airRight = Math.min(100, pct(endFlightSec));
            const airWidth = Math.max(0, airRight - airLeft);
            const altCode = f.alternate ? (f.alternate.code === 'LRBV' ? 'LRCW' : f.alternate.code) : null;

            return (
              <div key={f.id} className={`tl-row ${f.id === selectedId ? 'is-selected' : ''}`} onClick={() => select(f.id)}>
                <button className="tl-label tl-label--btn" aria-pressed={f.id === selectedId} title={`${f.origin.icao} (${f.origin.city}) → ${altCode ?? 'LRCV'}`}>
                  <span className={`rules rules--${f.aircraft.flightRules.toLowerCase()}`} title={HINT[f.aircraft.flightRules]}>{f.aircraft.flightRules}</span> {f.callsign}{' '}
                  <span className="muted">{altCode ? `→${altCode}` : f.origin.icao}</span>
                </button>
                <div className="tl-track">
                  {timelineScope === 'mission' && airWidth > 0.3 && (
                    <span
                      className={`tl-airborne tl-airborne--${f.aircraft.flightRules.toLowerCase()}`}
                      style={{ left: `${airLeft}%`, width: `${airWidth}%` }}
                      title={`Zbor activ ${f.origin.icao} → ${altCode ?? 'LRCV'} (decolare ${clockLabel(BASE_TIME_OFFSET_SECONDS + f.takeoffSeconds, false)})`}
                    />
                  )}
                  {timelineScope === 'mission' && pct(f.takeoffSeconds) >= 0 && pct(f.takeoffSeconds) <= 100 && (
                    <span
                      className="tl-dep"
                      style={{ left: xClamped(f.takeoffSeconds) }}
                      title={`Decolare ${f.origin.icao}: ${clockLabel(BASE_TIME_OFFSET_SECONDS + f.takeoffSeconds, false)}`}
                    />
                  )}
                  <span
                    className="tl-window"
                    style={{ left: x(f.aircraft.earliestSeconds), width: `calc(${x(f.aircraft.latestSeconds)} - ${x(f.aircraft.earliestSeconds)})` }}
                    title={HINT.WINDOW}
                  />
                  <span className="tl-eta" style={{ left: x(f.aircraft.etaSeconds) }} title={HINT.ETA} />
                  {f.slot && <span className={`tl-slot ${STATUS_CLASS[f.status]}`} style={{ left: x(f.slot.calculatedTimeSeconds) }} title={HINT.SLOT} />}
                  {!f.slot && f.resolvedLandingSeconds !== null && f.status !== 'ClearedForApproach' && (
                    <span
                      className={`tl-flag ${altCode ? 'st-divert' : 'st-hold'}`}
                      style={{ left: xClamped(f.resolvedLandingSeconds) }}
                      title={altCode ? `Aterizare pe aerodromul alternativ ${altCode}` : 'Aterizare pe LRCV după așteptarea rândului'}
                    >
                      {altCode ? `→ ${altCode}` : `→ RWY ${f.tacticalDecision?.assignedVfrRunway ?? ev.traffic.runway}`}
                    </span>
                  )}
                  {!f.slot && (f.resolvedLandingSeconds === null || f.status === 'ClearedForApproach') && (
                    <span className={`tl-flag ${isUnsequenced(f) ? 'tl-flag--noslot' : STATUS_CLASS[f.status]}`} style={{ left: x(f.aircraft.etaSeconds) }}>
                      {isUnsequenced(f) ? 'fără slot' : f.status === 'DivertRecommended' ? 'deviere' : 'așteptare'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* O singură linie „acum” peste axă și toate rândurile; grila copiază coloanele rândurilor (etichetă + pistă). */}
      <div className="tl-nowlayer" aria-hidden="true">
        <span />
        <div className="tl-nowtrack">
          <NowLine t0={t0} span={span} />
        </div>
      </div>
      </div>
      <div className="tl-legend muted small">
        {showNotification && (
          <span><i className="lg lg--notification" aria-hidden="true" /> notificare 30 NM</span>
        )}
        {timelineScope === 'mission' && (
          <span>
            <i className="lg lg--dep" /> decolare &amp; rută
          </span>
        )}
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
function NowLine({ t0, span }: { t0: number; span: number }) {
  const t = useApp((s) => s.simTimeSeconds);
  const pct = Math.max(0, Math.min(100, ((t - t0) / span) * 100));
  return <span className="tl-now" style={{ left: `${pct}%` }} />;
}
