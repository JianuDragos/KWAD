// Raftul de benzi de zbor: lista sosirilor în ordinea aterizării. Banda selectată se deschide pe loc,
// deci controlorul vede detaliile fără să piardă restul secvenței.
import { useEffect, useRef } from 'react';
import { positionAt } from '../sim/interpolate';
import type { FlightView } from '../sim/traffic';
import { altitudeLabel, clockLabel, minutesLabel } from '../sim/units';
import { BASE_TIME_OFFSET_SECONDS, useApp } from '../state/store';
import { CATEGORY_LABEL, STATUS_CLASS, isUnsequenced } from './flightStyle';

const clock = (s: number) => clockLabel(BASE_TIME_OFFSET_SECONDS + s, false);
const sequenceTime = (f: FlightView) => f.slot?.calculatedTimeSeconds ?? f.aircraft.etaSeconds;

export function DetailsPanel() {
  const evaluation = useApp((s) => s.evaluation);
  const selectedId = useApp((s) => s.selectedId);
  const error = useApp((s) => s.error);
  const status = useApp((s) => s.status);

  if (!evaluation) {
    return (
      <aside className="panel" aria-label="Sosiri">
        {status === 'error' ? <p className="notice notice--err">{error}</p> : <p className="muted">Se încarcă scenariul…</p>}
      </aside>
    );
  }
  const { flights } = evaluation.traffic;
  const stats = evaluation.result.stats;
  const ordered = [...flights].sort((a, b) => sequenceTime(a) - sequenceTime(b));
  return (
    <aside className="panel" aria-label="Sosiri">
      {error && <p className="notice notice--err">{error}</p>}
      <div className="panel__head">
        <h2 className="panel__title">Sosiri</h2>
        <span className="panel__count">
          {stats.clearedToLandCount} aprobate
          {stats.holdingInOrbitCount > 0 && <>, {stats.holdingInOrbitCount} în așteptare</>}
          {stats.divertAdvisedCount > 0 && <>, {stats.divertAdvisedCount} deviate</>}
        </span>
      </div>
      {ordered.length === 0 && <p className="notice">Niciun trafic în scenariu.</p>}
      <ol className="strips">
        {ordered.map((f) => (
          <li key={f.id}>
            <Strip flight={f} expanded={f.id === selectedId} />
          </li>
        ))}
      </ol>
      <section className="ai" aria-label="Analiză AI">
        <h3 className="panel__sub">Analiză AI</h3>
        <p className="muted small">Indisponibilă momentan. Timpii și recomandările de mai sus vin din motorul de planificare.</p>
      </section>
    </aside>
  );
}

function stripTag(f: FlightView): string | null {
  if (f.status === 'HoldInOrbitRecommended') return 'Așteptare';
  if (f.status === 'DivertRecommended') return 'Deviere';
  if (isUnsequenced(f)) return 'Fără slot';
  return null;
}

function Strip({ flight, expanded }: { flight: FlightView; expanded: boolean }) {
  const select = useApp((s) => s.select);
  const ref = useRef<HTMLButtonElement>(null);
  const ac = flight.aircraft;
  const rules = ac.flightRules.toLowerCase();
  const tag = stripTag(flight);
  const bodyId = `strip-${flight.id}`;

  // Selectat de pe hartă sau din timeline: aducem banda în vedere.
  useEffect(() => {
    if (expanded) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [expanded]);

  return (
    <article className={`strip strip--${rules} ${STATUS_CLASS[flight.status]} ${expanded ? 'is-open' : ''}`}>
      <button
        ref={ref}
        className="strip__head"
        onClick={() => select(expanded ? null : flight.id)}
        aria-expanded={expanded}
        aria-controls={bodyId}
      >
        <span className="strip__cs">{flight.callsign}</span>
        <span className="strip__time">{flight.slot ? clock(flight.slot.calculatedTimeSeconds) : clock(ac.etaSeconds)}</span>
        <span className="strip__type">
          <span className={`rules rules--${rules}`}>{ac.flightRules}</span> {ac.modelName}
        </span>
        <span className="strip__when">{tag ? <span className="strip__tag">{tag}</span> : flight.slot ? 'slot' : 'ETA'}</span>
      </button>
      {expanded && <StripDetails flight={flight} id={bodyId} />}
    </article>
  );
}

function StripDetails({ flight, id }: { flight: FlightView; id: string }) {
  const ac = flight.aircraft;
  const adv = flight.advisory;
  const overLimit = !!adv && adv.currentCrosswindKnots > adv.maxCrosswindLimitKnots;
  return (
    <div className="strip__body" id={id}>
      {isUnsequenced(flight) && <p className="notice notice--warn">Aprobat pentru apropiere, dar fără slot de aterizare. Pe hartă aterizează la ETA.</p>}
      <dl className="kv">
        <dt>Categorie</dt>
        <dd>{CATEGORY_LABEL[ac.category]}</dd>
        <dt>ETA</dt>
        <dd className="num">{clock(ac.etaSeconds)}</dd>
        <dt>Fereastră</dt>
        <dd className="num">
          {clock(ac.earliestSeconds)}–{clock(ac.latestSeconds)}
        </dd>
        {flight.slot && (
          <>
            <dt>Slot</dt>
            <dd className="num">
              {clock(flight.slot.calculatedTimeSeconds)} <span className="muted">întârziere {minutesLabel(flight.slot.delaySeconds)}</span>
            </dd>
          </>
        )}
        <dt>Vânt lateral</dt>
        <dd className={overLimit ? 'txt-warn' : ''}>{adv ? `${adv.currentCrosswindKnots} kt din maximum ${adv.maxCrosswindLimitKnots} kt` : '—'}</dd>
        <dt>Combustibil</dt>
        <dd>{ac.remainingFuelMinutes ?? '—'} min</dd>
        <dt>Traseu</dt>
        <dd>
          {flight.routeLabel} <span className="muted">(sintetic)</span>
        </dd>
        <dt>Acum</dt>
        <dd className="num">
          <FlightNow flight={flight} />
        </dd>
      </dl>
      {adv && <p className="reason">{adv.advisoryReason}</p>}
      {adv?.orbitAdvice && flight.kind === 'hold' && (
        <div className="card">
          <strong>{adv.orbitAdvice.patternName}</strong>
          <span className="muted small">
            {adv.orbitAdvice.recommendedAltitudeFeet} ft, circa {adv.orbitAdvice.holdingDurationMinutes} min, marjă de combustibil{' '}
            {adv.orbitAdvice.remainingFuelMarginMinutes} min
          </span>
          <span className="small">{adv.orbitAdvice.safetyInstructions}</span>
        </div>
      )}
      {adv?.recommendedAlternates && adv.advisoryStatus !== 'ClearedForApproach' && (
        <>
          <h4 className="panel__sub">Aerodromuri alternative</h4>
          <ul className="alts">
            {adv.recommendedAlternates.map((a) => (
              <li key={a.code} className={flight.alternate?.code === a.code ? 'is-chosen' : ''}>
                {/* Codul LRBV primit e greșit (e Brașov); terenul e Craiova-Sud, LRCW în AIP. */}
                <span>{a.code === 'LRBV' ? 'Craiova-Sud (LRCW)' : a.name}</span>
                <span className="muted small">
                  pista {a.bestRunway}, lateral {a.calculatedCrosswindKnots} kt, {a.estimatedFlightMinutes} min de zbor
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Altitudinea și direcția curente; singurul rând din panou care se actualizează la fiecare cadru. */
function FlightNow({ flight }: { flight: FlightView }) {
  const t = useApp((s) => s.simTimeSeconds);
  const pos = positionAt(flight.track, t);
  if (!pos) return <span className="muted">fără poziție acum</span>;
  return (
    <>
      {altitudeLabel(pos.altitudeMeters)}, {String(Math.round(pos.headingDeg ?? 0)).padStart(3, '0')}°
    </>
  );
}
