import { positionAt } from '../sim/interpolate';
import type { FlightView } from '../sim/traffic';
import { altitudeLabel, clockLabel, minutesLabel } from '../sim/units';
import { BASE_TIME_OFFSET_SECONDS, useApp } from '../state/store';
import { CATEGORY_LABEL, STATUS_CLASS, STATUS_LABEL, isUnsequenced } from './flightStyle';

const clock = (s: number) => clockLabel(BASE_TIME_OFFSET_SECONDS + s, false);

export function DetailsPanel() {
  const evaluation = useApp((s) => s.evaluation);
  const selectedId = useApp((s) => s.selectedId);
  const error = useApp((s) => s.error);
  const status = useApp((s) => s.status);

  if (!evaluation) {
    return (
      <aside className="panel">
        {status === 'error' ? <div className="notice notice--err">{error}</div> : <div className="muted">Se încarcă scenariul…</div>}
      </aside>
    );
  }
  const flight = evaluation.traffic.flights.find((f) => f.id === selectedId) ?? null;
  return (
    <aside className="panel">
      {error && <div className="notice notice--err">{error}</div>}
      {flight ? <FlightDetails flight={flight} /> : <ScenarioSummary />}
      <AiAnalysisBox />
    </aside>
  );
}

function ScenarioSummary() {
  const ev = useApp((s) => s.evaluation)!;
  const scenario = useApp((s) => s.scenario)!;
  const select = useApp((s) => s.select);
  const r = ev.result;
  return (
    <section>
      <h2 className="panel__title">Situația sosirilor</h2>
      <dl className="kv">
        <dt>Pista activă</dt>
        <dd>
          <strong>{ev.traffic.runway}</strong>{' '}
          <span className="muted" title="Backendul folosește denumirea veche a pistei">(backend: {r.activeRunway})</span>
        </dd>
        <dt>Vânt</dt>
        <dd>
          {String(r.weather.windDirectionDegrees).padStart(3, '0')}° {r.weather.windSpeedKnots} kt, rafale {r.weather.windGustKnots} kt
        </dd>
        <dt>Lateral / față</dt>
        <dd>
          {r.activeRunwayCrosswindKnots} kt / {r.activeRunwayHeadwindKnots} kt
          {r.isCrosswindCriticalForLightAircraft && <span className="tag st-divert">critic pt. avioane mici</span>}
        </dd>
        <dt>Sursa traficului</dt>
        <dd className="muted">{scenario.source}</dd>
      </dl>

      <h3 className="panel__sub">Aeronave ({r.stats.totalInbounds})</h3>
      {ev.traffic.flights.length === 0 && <div className="notice">Niciun trafic în scenariu.</div>}
      <ul className="flight-list">
        {ev.traffic.flights.map((f) => (
          <li key={f.id}>
            <button className="flight-row" onClick={() => select(f.id)}>
              <span className={`rules rules--${f.aircraft.flightRules.toLowerCase()}`}>{f.aircraft.flightRules}</span>
              <span className="flight-row__cs">{f.callsign}</span>
              <span className={`tag ${STATUS_CLASS[f.status]}`}>{STATUS_LABEL[f.status]}</span>
              <span className="flight-row__time">{f.slot ? clock(f.slot.calculatedTimeSeconds) : isUnsequenced(f) ? 'fără slot' : '—'}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="muted small">
        Aprobate {r.stats.clearedToLandCount} · în așteptare {r.stats.holdingInOrbitCount} · deviere {r.stats.divertAdvisedCount}
      </p>
    </section>
  );
}

function FlightDetails({ flight }: { flight: FlightView }) {
  const t = useApp((s) => s.simTimeSeconds);
  const select = useApp((s) => s.select);
  const ac = flight.aircraft;
  const adv = flight.advisory;
  const pos = positionAt(flight.track, t);
  const eta = ac.etaSeconds;

  return (
    <section>
      <div className="panel__head">
        <h2 className="panel__title">{flight.callsign}</h2>
        <button className="btn btn--ghost" onClick={() => select(null)} aria-label="Închide detaliile (Esc)">
          ✕
        </button>
      </div>
      <p className="muted">
        {ac.modelName} · {CATEGORY_LABEL[ac.category]}
      </p>
      <p>
        <span className={`rules rules--${ac.flightRules.toLowerCase()}`}>{ac.flightRules}</span>{' '}
        <span className={`tag ${STATUS_CLASS[flight.status]}`}>{STATUS_LABEL[flight.status]}</span>
      </p>

      {isUnsequenced(flight) && (
        <div className="notice notice--warn">
          Backendul a aprobat apropierea, dar nu a dat slot: motorul secvențiază doar primul VFR (SequenceGenerator.cs). Pe hartă aterizează la ETA.
        </div>
      )}

      <dl className="kv">
        <dt>ETA</dt>
        <dd>{clock(eta)}</dd>
        <dt>Fereastră</dt>
        <dd>
          {clock(ac.earliestSeconds)} – {clock(ac.latestSeconds)}
        </dd>
        <dt>Slot planificat</dt>
        <dd>
          {flight.slot ? (
            <>
              {clock(flight.slot.calculatedTimeSeconds)}{' '}
              <span className="muted">(întârziere {minutesLabel(flight.slot.delaySeconds)})</span>
            </>
          ) : (
            '—'
          )}
        </dd>
        <dt>Vânt lateral</dt>
        <dd className={adv && adv.currentCrosswindKnots > adv.maxCrosswindLimitKnots ? 'txt-warn' : ''}>
          {adv ? `${adv.currentCrosswindKnots} kt (limită ${adv.maxCrosswindLimitKnots} kt)` : '—'}
        </dd>
        <dt>Combustibil</dt>
        <dd>{ac.remainingFuelMinutes ?? '—'} min</dd>
        <dt>Traseu</dt>
        <dd>
          {flight.routeLabel} <span className="tag tag--synthetic">sintetic</span>
        </dd>
        <dt>Acum</dt>
        <dd>{pos ? `${altitudeLabel(pos.altitudeMeters)} · ${Math.round(pos.headingDeg ?? 0)}°` : 'fără poziție la acest moment'}</dd>
      </dl>

      {adv && (
        <>
          <h3 className="panel__sub">Recomandarea motorului</h3>
          <p className="reason">{adv.advisoryReason}</p>
        </>
      )}
      {adv?.orbitAdvice && flight.kind === 'hold' && (
        <div className="card">
          <strong>{adv.orbitAdvice.patternName}</strong>
          <div className="muted small">
            {adv.orbitAdvice.recommendedAltitudeFeet} ft · ~{adv.orbitAdvice.holdingDurationMinutes} min · marjă combustibil {adv.orbitAdvice.remainingFuelMarginMinutes} min
          </div>
          <div className="small">{adv.orbitAdvice.safetyInstructions}</div>
        </div>
      )}
      {adv?.recommendedAlternates && adv.advisoryStatus !== 'ClearedForApproach' && (
        <>
          <h3 className="panel__sub">Alternative</h3>
          <ul className="alts">
            {adv.recommendedAlternates.map((a) => (
              <li key={a.code} className={flight.alternate?.code === a.code ? 'is-chosen' : ''}>
                <span>
                  {a.name}
                  {a.code === 'LRBV' && (
                    <span className="tag tag--warn" title="LRBV este Brașov-Ghimbav. Terenul de la 8,5 km SV este Craiova-Sud (LRCW).">
                      cod greșit → LRCW
                    </span>
                  )}
                </span>
                <span className="muted small">
                  pista {a.bestRunway} · lateral {a.calculatedCrosswindKnots} kt · {a.estimatedFlightMinutes} min
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function AiAnalysisBox() {
  return (
    <section className="ai">
      <h3 className="panel__sub">Analiză AI</h3>
      <div className="notice">
        <strong>Indisponibilă.</strong> Backendul nu are încă endpoint de analiză (<code>/api/analysis</code>). Calculele de mai sus vin din motor.
      </div>
    </section>
  );
}
