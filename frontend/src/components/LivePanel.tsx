// Panoul paginii Live: METAR-ul real și benzile avioanelor detectate, cele mai apropiate primele.
import { useEffect, useRef } from 'react';
import type { LiveFlight, Metar } from '../contracts/live';
import { airlineFor, trendArrow } from '../sim/live';
import { M_PER_NM, altitudeLabel, verticalRateLabel } from '../sim/units';
import { useSpeed } from '../state/units';
import { useLive } from '../state/live';
import { useAssistant } from '../state/assistant';
import { setMode } from '../state/mode';
import { AskAi } from './AskAi';
import { HINT } from '../data/glossary';

export function LivePanel() {
  const positions = useLive((s) => s.positions);
  const metar = useLive((s) => s.metar);
  const positionsError = useLive((s) => s.positionsError);
  const metarError = useLive((s) => s.metarError);
  const vfrTracking = useLive((s) => s.vfrTracking);
  const vfrTrackingError = useLive((s) => s.vfrTrackingError);
  const selectedIcao = useLive((s) => s.selectedIcao);
  const airborne = (positions?.flights ?? [])
    .filter((f) => !f.onGround && f.latitude != null)
    .sort((a, b) => (a.distanceFromLrcvKm ?? Infinity) - (b.distanceFromLrcvKm ?? Infinity));

  return (
    <aside className="panel" aria-label="Trafic real">
      <AskAi />
      <hr className="panel__rule" />
      {positionsError && <p className="notice notice--err">{positionsError}</p>}
      <div className="panel__head">
        <h2 className="panel__title">Trafic real</h2>
        {positions && <span className="panel__count">{airborne.length} în zbor</span>}
      </div>

      {metar ? <MetarBlock metar={metar} /> : metarError ? <p className="notice notice--err">METAR: {metarError}</p> : null}
      {vfrTracking && <VmcBadge status={vfrTracking.vmc.status} />}
      {vfrTrackingError && <p className="notice notice--warn">Tracking VFR: {vfrTrackingError}</p>}

      {!positions && !positionsError && <p className="muted">Se încarcă pozițiile…</p>}
      {positions && airborne.length === 0 && (
        <p className="notice">Niciun avion în zbor în zona Craiova acum.</p>
      )}
      <ol className="strips">
        {airborne.map((f) => (
          <li key={f.icao24}>
            <LiveStrip flight={f} expanded={f.icao24 === selectedIcao} />
          </li>
        ))}
        {(vfrTracking?.vfrFlights ?? []).map((flight) => (
          <p className="notice" key={`vfr-${flight.flightId}`}>
            {flight.callsign}: {flight.pointCode}, {flight.distanceToPointMeters.toFixed(0)} m, ETA prin punct{' '}
            {flight.etaViaPointMinutes.toFixed(1)} min — {flight.status}
          </p>
        ))}
      </ol>
      {positions && <p className="muted small">Sursa: {positions.source}. Actualizare la 15 s.</p>}

      <div className="assistant-cta">
        <div>
          <strong className="small">Asistent Tactic ATC (Trafic Real)</strong>
          <p className="muted small">Analizează METAR-ul curent, eligibilitatea VMC și traficul radar în tab-ul Asistent.</p>
        </div>
        <button
          type="button"
          className="btn btn--primary btn--xs"
          onClick={() => {
            useAssistant.getState().setContextSource('live');
            setMode('assistant');
          }}
        >
          Deschide Asistent →
        </button>
      </div>
    </aside>
  );
}

function VmcBadge({ status }: { status: string }) {
  const label = status === 'VMC' ? 'VMC' : status === 'MVFR' ? 'Marginal VFR' : 'IMC · VFR suspendat';
  return <div className={`vmc-badge vmc-badge--${status.toLowerCase()}`} role="status">{label}</div>;
}

function MetarBlock({ metar }: { metar: Metar }) {
  const speed = useSpeed();
  const wind = metar.isWindVariable || metar.windDirectionDegrees == null ? 'variabil' : `${String(metar.windDirectionDegrees).padStart(3, '0')}°`;
  return (
    <section className="metar" aria-label="METAR Craiova">
      <dl className="kv">
        <dt title={HINT.WIND}>Vânt</dt>
        <dd className="num">
          {wind} {speed.label(metar.windSpeedKnots)}{metar.windGustKnots ? `, rafale ${speed.label(metar.windGustKnots)}` : ''}
        </dd>
        <dt title={HINT.VISIBILITY}>Vizibilitate</dt>
        <dd className="num">{metar.visibilityMeters >= 9999 ? '10 km sau mai mult' : `${metar.visibilityMeters} m`}</dd>
        <dt title={HINT.CLOUDS}>Nori</dt>
        <dd>{metar.skyConditionDescription}</dd>
        {metar.weatherPhenomena && (
          <>
            <dt>Fenomene</dt>
            <dd>{metar.weatherPhenomena}</dd>
          </>
        )}
        <dt title={HINT.TEMP_DEW}>Temp. / rouă</dt>
        <dd className="num">
          {metar.temperatureCelsius}° / {metar.dewPointCelsius}°
        </dd>
        <dt title={HINT.QNH}>QNH</dt>
        <dd className="num">{metar.qnhHpa} hPa</dd>
        <dt title={HINT.FLIGHT_CAT}>Categorie</dt>
        <dd>
          <span className={`fltcat fltcat--${metar.flightCategory.toLowerCase()}`}>{metar.flightCategory}</span>
        </dd>
      </dl>
    </section>
  );
}

function LiveStrip({ flight, expanded }: { flight: LiveFlight; expanded: boolean }) {
  const select = useLive((s) => s.select);
  const ref = useRef<HTMLButtonElement>(null);
  const speed = useSpeed();
  const bodyId = `live-${flight.icao24}`;
  useEffect(() => {
    if (expanded) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [expanded]);
  const nm = flight.distanceFromLrcvKm != null ? (flight.distanceFromLrcvKm * 1000) / M_PER_NM : null;

  return (
    <article className={`strip strip--live ${expanded ? 'is-open' : ''}`}>
      <button ref={ref} className="strip__head" onClick={() => select(expanded ? null : flight.icao24)} aria-expanded={expanded} aria-controls={bodyId}>
        <span className="strip__cs">{flight.callsign || flight.icao24.toUpperCase()}</span>
        <span className="strip__time">
          {flight.baroAltitudeMeters != null ? altitudeLabel(flight.baroAltitudeMeters) : '—'} {trendArrow(flight.verticalRateMs)}
        </span>
        <span className="strip__type">{airlineFor(flight.callsign) ?? flight.originCountry ?? 'țară necunoscută'}</span>
        <span className="strip__when">
          {nm != null ? `${nm.toFixed(0)} NM` : ''}
          {flight.bearingFromLrcvDegrees != null ? ` la ${String(Math.round(flight.bearingFromLrcvDegrees)).padStart(3, '0')}°` : ''}
        </span>
      </button>
      {expanded && (
        <div className="strip__body" id={bodyId}>
          <dl className="kv">
            <dt>Companie</dt>
            <dd>{airlineFor(flight.callsign) ?? 'necunoscută'}</dd>
            <dt title={HINT.REGISTRATION}>Înmatriculare</dt>
            <dd>{flight.originCountry ?? '—'}</dd>
            <dt title={HINT.GROUND_SPEED}>Viteză sol</dt>
            <dd className="num">{flight.velocityKnots != null ? speed.label(flight.velocityKnots) : '—'}</dd>
            <dt title={HINT.TRACK}>Direcție</dt>
            <dd className="num">{flight.trueTrackDegrees != null ? `${String(Math.round(flight.trueTrackDegrees)).padStart(3, '0')}°` : '—'}</dd>
            <dt title={HINT.VERTICAL_RATE}>Rată verticală</dt>
            <dd className="num">{flight.verticalRateMs != null ? verticalRateLabel(flight.verticalRateMs) : '—'}</dd>
            <dt title={HINT.SQUAWK}>Squawk</dt>
            <dd className="num">{flight.squawk ?? '—'}</dd>
            <dt title={HINT.RULES}>Reguli</dt>
            <dd>{flight.flightRules}</dd>
            <dt title={HINT.ICAO24}>Cod ICAO</dt>
            <dd className="num">{flight.icao24.toUpperCase()}</dd>
          </dl>
        </div>
      )}
    </article>
  );
}
