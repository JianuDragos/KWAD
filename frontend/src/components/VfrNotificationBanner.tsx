import { useApp } from '../state/store';

export const VFR_REJECTION_NOTICE = 'Soluția asistentului a fost refuzată (limită operațională 20 NM / FL55 atinsă). Comunicarea și eșalonarea se vor efectua exclusiv între Turnul de Control (TWR) și aeronave prin radio.';

export function VfrNotificationBanner() {
  const plan = useApp((s) => s.vfrPlan);
  const distance = useApp((s) => s.minDistanceToLrcvNm);
  const evaluation = useApp((s) => s.evaluation);
  const status = useApp((s) => s.status);
  const revision = useApp((s) => s.scenario?.revision);
  const { acceptVfrPlan, rejectVfrPlan } = useApp.getState();
  if (plan.status === 'idle' || !evaluation) return null;

  const { flights, runway } = evaluation.traffic;
  const ifr = flights.filter((f) => f.aircraft.flightRules === 'IFR').map((f) => f.callsign).join(', ');
  const vfr = flights.filter((f) => f.aircraft.flightRules === 'VFR').map((f) => f.callsign).join(', ');
  const canAccept = plan.status === 'proposed' && status === 'ok' && evaluation.revision === revision &&
    distance !== null && distance > 20 && distance <= 30;

  return (
    <aside className={`vfr-alert-banner vfr-alert-banner--${plan.status}`} aria-label="Plan tactic integrat IFR + VFR">
      <div className="vfr-alert-banner__body" role="status">
        <strong>
          {plan.status === 'accepted' ? '✓ Soluție de aterizare acceptată. Eșalonarea tactică integrată este activă.' :
            plan.status === 'rejected' ? plan.rejectionReason === 'gate' ? 'AUTO-REJECT · 20 NM / FL55' : 'Soluție refuzată manual' :
              'Recomandare Tactică Secvențiere Sosiri (IFR + VFR)'}
        </strong>
        {plan.status === 'proposed' && (
          <>
            <p>{ifr ? `IFR (${ifr}): apropiere pe RWY ${runway}, eșalonare minimă 5.0 NM.` : 'Fără sosiri IFR în grup.'}</p>
            <p>VFR ({vfr}): holding Cârcea, apoi aterizare pe RWY {runway} după IFR, cu minimum 4.0 NM pe finală. Doriți aplicarea planului integrat de aterizare?</p>
          </>
        )}
        {plan.status === 'rejected' && <p>{VFR_REJECTION_NOTICE}</p>}
        {plan.status === 'accepted' && <p>Ordine de aterizare: {flights.filter((f) => f.slot).sort((a, b) => a.slot!.calculatedTimeSeconds - b.slot!.calculatedTimeSeconds).map((f) => f.callsign).join(' → ')}.</p>}
        <p className="small muted">Distanță: {distance === null ? '—' : distance.toFixed(1)} NM (Auto-reject la 20 NM / FL55)</p>
      </div>
      {plan.status !== 'accepted' && (
        <div className="vfr-alert-banner__actions">
          <button type="button" className="btn btn--primary" disabled={!canAccept} onClick={acceptVfrPlan}>Acceptă soluția</button>
          {plan.status === 'proposed' && <button type="button" className="btn btn--danger" onClick={rejectVfrPlan}>Refuză</button>}
        </div>
      )}
    </aside>
  );
}
