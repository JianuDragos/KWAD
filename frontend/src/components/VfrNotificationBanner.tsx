import { useApp } from '../state/store';
import { useDistance } from '../state/units';

export function VfrNotificationBanner() {
  const plan = useApp((s) => s.vfrPlan);
  const distance = useApp((s) => s.minDistanceToLrcvNm);
  const evaluation = useApp((s) => s.evaluation);
  const status = useApp((s) => s.status);
  const revision = useApp((s) => s.scenario?.revision);
  const { acceptVfrPlan, rejectVfrPlan } = useApp.getState();
  const d = useDistance().label;
  if (plan.status === 'idle' || !evaluation) return null;

  const { flights, runway } = evaluation.traffic;
  const ifr = flights.filter((f) => f.aircraft.flightRules === 'IFR').map((f) => f.callsign).join(', ');
  const vfr = flights.filter((f) => f.aircraft.flightRules === 'VFR').map((f) => f.callsign).join(', ');
  const canAccept = plan.status === 'proposed' && status === 'ok' && evaluation.revision === revision &&
    distance !== null && distance > 20 && distance <= 30;

  return (
    <aside className={`vfr-alert-banner vfr-alert-banner--${plan.status}`} aria-label="Plan de aterizare IFR + VFR">
      <div className="vfr-alert-banner__body" role="status">
        <strong>
          {plan.status === 'accepted' ? '✓ Plan de aterizare acceptat' :
            plan.status === 'rejected' ? plan.rejectionReason === 'gate' ? `Plan refuzat automat: primul IFR a ajuns la ${d(20)}` : 'Plan refuzat' :
              `Plan de aterizare propus · RWY ${runway}`}
        </strong>
        {plan.status === 'proposed' && (
          <>
            <p>{ifr ? `Întâi IFR (${ifr}), la cel puțin ${d(5)} unul de altul.` : 'Nu sunt avioane IFR în grup.'}</p>
            <p>Apoi VFR ({vfr}) din holding Cârcea, la cel puțin {d(4)} pe finală. Accepți planul?</p>
          </>
        )}
        {plan.status === 'rejected' && <p>VFR-urile rămân în holding; aterizarea lor o coordonezi tu prin radio.</p>}
        {plan.status === 'accepted' && <p>Ordinea de aterizare: {flights.filter((f) => f.slot).sort((a, b) => a.slot!.calculatedTimeSeconds - b.slot!.calculatedTimeSeconds).map((f) => f.callsign).join(' → ')}.</p>}
        {plan.status === 'proposed' && (
          <p className="small muted">
            Primul IFR e la {distance === null ? '—' : d(distance)} de aeroport. Poți accepta până la {d(20)}; după aceea planul se refuză singur.
          </p>
        )}
      </div>
      {plan.status === 'proposed' && (
        <div className="vfr-alert-banner__actions">
          <button type="button" className="btn btn--primary" disabled={!canAccept} onClick={acceptVfrPlan}>Acceptă planul</button>
          <button type="button" className="btn btn--danger" onClick={rejectVfrPlan}>Refuză</button>
        </div>
      )}
    </aside>
  );
}
