import { useEffect, useState } from 'react';
import { CRITICAL_CROSSWIND_KT, runwayForWind, windComponents } from '../sim/live';
import { useLive } from '../state/live';
import { useSpeed } from '../state/units';
import { WindArrow } from './WindArrow';
import { HINT } from '../data/glossary';

/** Bara de sus pe pagina Live: ora reală, pista și vântul din METAR, vechimea datelor. */
export function LiveControls() {
  const metar = useLive((s) => s.metar);
  const speed = useSpeed();
  const updatedAtMs = useLive((s) => s.updatedAtMs);
  const error = useLive((s) => s.positionsError);
  const vmcStatus = useLive((s) => s.vfrTracking?.vmc.status ?? null);
  const runway = metar ? runwayForWind(metar.windDirectionDegrees, metar.windSpeedKnots) : null;
  const xw = metar && runway && metar.windDirectionDegrees != null ? windComponents(metar.windDirectionDegrees, metar.windGustKnots ?? metar.windSpeedKnots, runway).crosswind : null;
  return (
    <>
      <UtcClock />
      {metar && runway && (
        <div className="atis">
          <span className="atis__rwy" title={HINT.RWY}>
            RWY {runway}
          </span>
          {metar.windDirectionDegrees != null && <WindArrow direction={metar.windDirectionDegrees} />}
          <span className="atis__wind" title={HINT.WIND}>
            {metar.isWindVariable || metar.windDirectionDegrees == null ? 'VRB' : `${String(metar.windDirectionDegrees).padStart(3, '0')}°`} {speed.value(metar.windSpeedKnots)}
            {metar.windGustKnots ? `G${speed.value(metar.windGustKnots)}` : ''} {speed.unit}
          </span>
          <span className="atis__xw" title={HINT.QNH}>QNH {metar.qnhHpa}</span>
          {xw != null && <span className={`atis__xw ${xw > CRITICAL_CROSSWIND_KT ? 'is-critical' : ''}`} title={HINT.CROSSWIND}>lateral {speed.label(xw)}</span>}
        </div>
      )}
      {vmcStatus && <span className={`pill vmc-pill vmc-pill--${vmcStatus.toLowerCase()}`} title={HINT.VMC}>{vmcStatus === 'IMC' ? 'VFR SUSPENDAT' : vmcStatus === 'MVFR' ? 'MARGINAL VFR' : 'VMC'}</span>}
      <div className="spacer" />
      <div className="pills" aria-live="polite">
        {error && <span className="pill pill--err">Fără date noi</span>}
        {updatedAtMs && <UpdatedAgo at={updatedAtMs} />}
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
    <div className="clock" title={HINT.UTC}>
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
