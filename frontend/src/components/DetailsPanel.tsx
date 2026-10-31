// Raftul de benzi de zbor + motorul de predicție matematică 4D:
// 1. Predicția Viitorului (T+0 .. T+45 min, forfecare vânt Hellmann-Ekman, altitudine densitate)
// 2. Doi Pași Înaintea Avionului (T0 → Pasul +1 → Pasul +2)
// 3. Analiză De-la-Decolare-la-Aterizare (6 faze, TOD, ROD 3.0°, WCA, LDR vs 2500m, Sectoare FIR)
// 4. Decizie VFR Orbită vs. Redirecționare (PNR + scor multi-criterial piste înierbate apropiate)
import { useEffect, useRef, useState } from 'react';
import type { FuturePredictionSummary } from '../contracts/backend';
import { positionAt } from '../sim/interpolate';
import type { FlightView } from '../sim/traffic';
import { altitudeLabel, clockLabel, minutesLabel } from '../sim/units';
import { useSpeed } from '../state/units';
import { BASE_TIME_OFFSET_SECONDS, useApp } from '../state/store';
import { AskAi } from './AskAi';
import { CATEGORY_LABEL, STATUS_CLASS, isUnsequenced } from './flightStyle';

const clock = (s: number) => clockLabel(BASE_TIME_OFFSET_SECONDS + s, false);
const sequenceTime = (f: FlightView) => f.slot?.calculatedTimeSeconds ?? f.aircraft.etaSeconds;

export function DetailsPanel() {
  const evaluation = useApp((s) => s.evaluation);
  const scenario = useApp((s) => s.scenario);
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
  const futurePrediction = evaluation.result.futurePrediction;
  const ordered = [...flights].sort((a, b) => sequenceTime(a) - sequenceTime(b));

  return (
    <aside className="panel" aria-label="Sosiri">
      {error && <p className="notice notice--err">{error}</p>}

      {futurePrediction && <FuturePredictionBox fp={futurePrediction} />}

      <div className="panel__head">
        <h2 className="panel__title">Sosiri &amp; Calcule Zbor</h2>
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
      <AskAi context={{ weather: scenario?.weather, aircrafts: scenario?.aircrafts, evaluationResult: evaluation.result }} />
    </aside>
  );
}

function FuturePredictionBox({ fp }: { fp: FuturePredictionSummary }) {
  const [open, setOpen] = useState(true);
  const seek = useApp((s) => s.seek);
  const simTimeSeconds = useApp((s) => s.simTimeSeconds);

  return (
    <section className="math-box math-box--future" aria-label="Predicția Viitorului 4D">
      <button className="math-box__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="math-box__title">Predicția Viitorului 4D (T+0 → T+45m)</span>
        <span className="math-box__badge">DA {fp.densityAltitudeFeet} ft</span>
      </button>
      {open && (
        <div className="math-box__body">
          <div className="math-metrics">
            <div className="math-metric">
              <span className="math-metric__lbl">Vânt 2000 ft</span>
              <span className="math-metric__val">
                {fp.windAt2000FtDegrees}° / {fp.windAt2000FtKnots} kt
              </span>
            </div>
            <div className="math-metric">
              <span className="math-metric__lbl">Vânt 5000 ft</span>
              <span className="math-metric__val">
                {fp.windAt5000FtDegrees}° / {fp.windAt5000FtKnots} kt
              </span>
            </div>
            <div className="math-metric">
              <span className="math-metric__lbl">Fereastră VFR</span>
              <span className="math-metric__val">{fp.optimalVfrLandingWindow.split(' ')[0]}</span>
            </div>
          </div>
          <p className="muted small">{fp.trendSummary}</p>
          <div className="horizon-grid" role="group" aria-label="Orizonturi de predicție (click pentru salt în timp)">
            {fp.horizons.map((h) => {
              const targetSec = h.horizonSeconds;
              const isNear = Math.abs(simTimeSeconds - targetSec) < 150;
              return (
                <button
                  key={h.horizonMinutes}
                  type="button"
                  className={`horizon-pill ${h.isVfrLegalAndSafe ? 'is-vfr-ok' : 'is-vfr-warn'} ${isNear ? 'is-active' : ''}`}
                  onClick={() => seek(targetSec)}
                  title={`Salt ceas la ${h.formattedTime} (T+${h.horizonMinutes}m) — Trafic activ: ${h.activeAirborneCount}, Holding: ${h.holdingCount}`}
                >
                  <span className="horizon-pill__t">T+{h.horizonMinutes}m</span>
                  <span className="horizon-pill__xw">
                    RWY {h.recommendedRunway} · {h.predictedCrosswindKnots} kt
                  </span>
                  <span className="horizon-pill__load">
                    {h.activeAirborneCount} av. ({h.holdingCount} hold)
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
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
        <span className="strip__cs">
          {flight.callsign} <span className="strip__orig">{flight.origin.icao}→LRCV</span>
        </span>
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
  const speed = useSpeed();
  const seek = useApp((s) => s.seek);
  const setView = useApp((s) => s.setView);
  const [showPhases, setShowPhases] = useState(false);
  const overLimit = !!adv && adv.currentCrosswindKnots > adv.maxCrosswindLimitKnots;
  const ttl = adv?.takeoffToLanding;
  const twoSteps = adv?.twoStepsAhead;
  const vfrRedir = adv?.vfrRedirection;

  return (
    <div className="strip__body" id={id}>
      {isUnsequenced(flight) && <p className="notice notice--warn">Aprobat pentru apropiere, dar fără slot de aterizare. Pe hartă aterizează la ETA.</p>}
      <dl className="kv">
        <dt>Origine</dt>
        <dd>
          <strong>{flight.origin.icao}</strong> · {flight.origin.name} ({flight.routeDistanceNm} NM)
        </dd>
        <dt>Decolare</dt>
        <dd className="num">{clock(flight.takeoffSeconds)}</dd>
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
        <dd className={overLimit ? 'txt-warn' : ''}>{adv ? `${speed.label(adv.currentCrosswindKnots)} din maximum ${speed.label(adv.maxCrosswindLimitKnots)}` : '—'}</dd>
        <dt>Combustibil</dt>
        <dd>{ac.remainingFuelMinutes ?? '—'} min</dd>
        <dt>Traseu</dt>
        <dd>{flight.routeLabel}</dd>
        {flight.traversedFirs.length > 0 && (
          <>
            <dt>Sectoare FIR</dt>
            <dd className="fir-chips">
              {flight.traversedFirs.map((firId) => (
                <span key={firId} className={`fir-chip ${firId === 'LRBB' ? 'fir-chip--lrbb' : ''}`}>
                  {firId}
                </span>
              ))}
            </dd>
          </>
        )}
        <dt>Acum</dt>
        <dd className="num">
          <FlightNow flight={flight} />
        </dd>
      </dl>

      {/* Butoane rapide de navigare pe traiectoria completă Decolare → TOD → Apropiere */}
      <div className="jump-btns" role="group" aria-label="Salt rapid pe traiectorie">
        <button
          type="button"
          className="btn btn--xs"
          onClick={() => {
            setView('continental');
            seek(flight.takeoffSeconds + 60);
          }}
          title={`Vezi decolarea de pe ${flight.origin.icao} pe harta continentală`}
        >
          Decolare {flight.origin.icao}
        </button>
        {flight.todPoint && (
          <button
            type="button"
            className="btn btn--xs"
            onClick={() => seek(flight.todPoint!.timeSeconds)}
            title="Salt ceas la punctul Top of Descent (TOD)"
          >
            TOD ({flight.todPoint.distanceToLandingNm} NM)
          </button>
        )}
        <button
          type="button"
          className="btn btn--xs"
          onClick={() => {
            setView('wide');
            seek((flight.landingSeconds ?? ac.etaSeconds) - 480);
          }}
          title="Salt la intrarea în TMA Craiova"
        >
          Apropiere LRCV
        </button>
      </div>

      {adv && <p className="reason">{adv.advisoryReason}</p>}

      {/* 1. DOI PAȘI ÎNAINTEA AVIONULUI (Two Steps Ahead Prediction) */}
      {twoSteps && (
        <div className="math-card">
          <div className="math-card__head">
            <strong>2 Pași Înaintea Avionului</strong>
            <span className="math-badge">T0 → +1 → +2</span>
          </div>
          <div className="steps-ahead">
            {[twoSteps.currentState, twoSteps.stepOneAhead, twoSteps.stepTwoAhead].map((st) => (
              <button
                key={st.stepIndex}
                type="button"
                className={`step-node step-node--${st.stepIndex}`}
                onClick={() => seek(st.timeSeconds)}
                title={`Salt pe hartă la ${st.formattedTime}: ${st.controllerAction}`}
              >
                <span className="step-node__hdr">
                  <span className="step-node__tag">{st.stepIndex === 0 ? 'T0 Acum' : `Pas +${st.stepIndex}`}</span>
                  <span className="num">{st.formattedTime}</span>
                </span>
                <span className="step-node__fix">{st.fixOrLocation}</span>
                <span className="step-node__kin num">
                  {st.altitudeFeet} ft · GS {st.groundSpeedKnots} kt · HDG {st.headingDegrees}°
                </span>
                <span className="step-node__act">{st.controllerAction}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 2. ANALIZĂ DE-LA-DECOLARE-LA-ATERIZARE (Takeoff-to-Landing Analysis) */}
      {ttl && (
        <div className="math-card">
          <div className="math-card__head">
            <strong>Analiză Decolare → Aterizare</strong>
            <span className="muted small">
              {ttl.departureAerodromeIcao} → LRCV ({ttl.totalRouteDistanceNm} NM)
            </span>
          </div>
          <div className="math-metrics">
            <div className="math-metric">
              <span className="math-metric__lbl">Top of Descent</span>
              <span className="math-metric__val">{ttl.topOfDescentDistanceNm} NM</span>
            </div>
            <div className="math-metric">
              <span className="math-metric__lbl">Pantă {ttl.optimalGlidepathDegrees}° ROD</span>
              <span className="math-metric__val">-{ttl.requiredRateOfDescentFpm} fpm</span>
            </div>
            <div className="math-metric">
              <span className="math-metric__lbl">Unghi derivă WCA</span>
              <span className="math-metric__val">
                {ttl.windCorrectionAngleCrabDegrees >= 0 ? `+${ttl.windCorrectionAngleCrabDegrees}` : ttl.windCorrectionAngleCrabDegrees}°
              </span>
            </div>
          </div>
          <div className="ldr-bar">
            <div className="ldr-bar__labels">
              <span>
                Distanță aterizare (LDR): <strong>{ttl.landingDistanceRequiredMeters} m</strong> / {ttl.landingDistanceAvailableMeters} m
              </span>
              <span className="num">ROT {ttl.predictedRunwayOccupancySeconds}s</span>
            </div>
            <div className="ldr-bar__track">
              <div className="ldr-bar__fill" style={{ width: `${Math.min(100, Math.round(ttl.runwayUsedPercent))}%` }} />
            </div>
          </div>
          <button type="button" className="btn-link" onClick={() => setShowPhases(!showPhases)}>
            {showPhases ? '▾ Ascunde cele 6 faze cinematice' : '▸ Arată cele 6 faze cinematice (Takeoff → Rollout)'}
          </button>
          {showPhases && (
            <ul className="phase-list">
              {ttl.phases.map((p) => (
                <li key={p.phaseCode} className="phase-item">
                  <span className="phase-item__name">{p.phaseName}</span>
                  <span className="num muted">
                    {p.distanceNm} NM · {p.endAltitudeFeet} ft · GS {p.groundSpeedKnots} kt · VS {p.verticalRateFpm} fpm
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 3. DECIZIE VFR ORBITĂ VS. REDIRECȚIONARE LA PISTE APROPIATE */}
      {vfrRedir && (
        <div
          className={`math-card ${vfrRedir.recommendedDecision === 'DivertImmediately' ? 'math-card--divert' : vfrRedir.recommendedDecision === 'OrbitThenLandOrDivert' ? 'math-card--hold' : ''}`}
        >
          <div className="math-card__head">
            <strong>Calcul VFR: Orbită vs. Redirecționare</strong>
            <span className="math-badge">PNR {vfrRedir.pointOfNoReturnMinutes} min</span>
          </div>
          <p className="small">{vfrRedir.mathematicalJustification}</p>
          <div className="math-metrics">
            <div className="math-metric">
              <span className="math-metric__lbl">Pistă optimă</span>
              <span className="math-metric__val">
                {vfrRedir.bestAlternateCode === 'LRBV' ? 'LRCW' : vfrRedir.bestAlternateCode} ({vfrRedir.bestAlternateRunway.split(' ')[0]})
              </span>
            </div>
            <div className="math-metric">
              <span className="math-metric__lbl">Cap de zbor</span>
              <span className="math-metric__val">{vfrRedir.redirectionHeadingToFlyDegrees}°</span>
            </div>
            <div className="math-metric">
              <span className="math-metric__lbl">ETE / Rezervă</span>
              <span className="math-metric__val">
                {vfrRedir.redirectionEtaMinutes}m / {vfrRedir.fuelRemainingAtAlternateMinutes}m
              </span>
            </div>
          </div>
        </div>
      )}

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
          <h4 className="panel__sub">Clasament Piste Apropiate (Scor Matematic 0–100)</h4>
          <ul className="alts">
            {[...adv.recommendedAlternates]
              .sort((a, b) => (b.safetyScore ?? 0) - (a.safetyScore ?? 0))
              .map((a) => (
                <li key={a.code} className={flight.alternate?.code === a.code || a.isRecommendedBestSpot ? 'is-chosen' : ''}>
                  <div className="alts__row">
                    <span>
                      {a.code === 'LRBV' ? 'Craiova-Sud (LRCW)' : a.name}
                      {a.isRecommendedBestSpot && <span className="alts__best"> ★ OPTIM</span>}
                    </span>
                    {a.safetyScore != null && <span className="alts__score num">{a.safetyScore}/100</span>}
                  </div>
                  <span className="muted small">
                    pista {a.bestRunway}, lateral {speed.label(a.calculatedCrosswindKnots)}, {a.estimatedFlightMinutes} min zbor
                    {a.windCorrectedHeadingDegrees != null && `, cap ${a.windCorrectedHeadingDegrees}°`}
                    {a.landingDistanceRequiredMeters != null && `, LDR ${a.landingDistanceRequiredMeters}m`}
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
  if (t < flight.takeoffSeconds) {
    return (
      <span className="muted">
        la sol pe {flight.origin.icao} (dec. {clock(flight.takeoffSeconds)})
      </span>
    );
  }
  const pos = positionAt(flight.track, t);
  if (!pos) return <span className="muted">aterizat / finalizat</span>;
  return (
    <>
      {altitudeLabel(pos.altitudeMeters)}, {String(Math.round(pos.headingDeg ?? 0)).padStart(3, '0')}°
    </>
  );
}
