// Banner / Notificare tactică ATC când 2 sau mai multe aeronave VFR sunt în așteptare pentru aterizare.
// Oferă acces direct la recomandarea Asistentului și butonul de respingere cu mesajul oficial solicitat.
import { getAwaitingVfrFlights } from '../sim/traffic';
import { useAssistant } from '../state/assistant';
import { setMode } from '../state/mode';
import { useApp } from '../state/store';

export function VfrNotificationBanner() {
  const evaluation = useApp((s) => s.evaluation);
  const simTimeSeconds = useApp((s) => s.simTimeSeconds);
  const flights = evaluation?.traffic.flights;
  const runway = evaluation?.traffic.runway ?? '08';
  const awaitingVfr = flights ? getAwaitingVfrFlights(flights, simTimeSeconds) : [];
  const vfrRec = useAssistant((s) => s.vfrRecommendation);
  const {
    rejectVfrApproachRecommendation,
    resetVfrApproachRecommendation,
    dismissVfrNotificationBanner,
  } = useAssistant.getState();

  // Se afișează doar când sunt 2 sau mai multe aeronave VFR în așteptare pentru aterizare
  if (awaitingVfr.length < 2 || vfrRec.dismissed) {
    return null;
  }

  const aircraftList = awaitingVfr.map((f) => f.callsign).join(', ');

  if (vfrRec.status === 'rejected') {
    return (
      <aside className="vfr-alert-banner vfr-alert-banner--rejected" role="alert" aria-live="assertive">
        <div className="vfr-alert-banner__content">
          <span className="vfr-alert-banner__badge">DISPOZIȚIE ATC</span>
          <p className="vfr-alert-banner__msg">
            S-a refuzat recomandarea si se vor urma indicatiile controlorului de trafic aerian
          </p>
        </div>
        <div className="vfr-alert-banner__actions">
          <button
            type="button"
            className="btn btn--xs btn--outline"
            onClick={() => setMode('assistant')}
            title="Deschide spațiul Asistent"
          >
            Vezi în Asistent →
          </button>
          <button
            type="button"
            className="btn btn--quiet btn--xs"
            onClick={resetVfrApproachRecommendation}
            title="Restabilește recomandarea Asistentului"
          >
            Revino la recomandare
          </button>
          <button
            type="button"
            className="btn btn--quiet btn--xs vfr-alert-banner__close"
            onClick={dismissVfrNotificationBanner}
            aria-label="Închide notificarea"
            title="Închide notificarea"
          >
            ✕
          </button>
        </div>
      </aside>
    );
  }

  if (vfrRec.status === 'accepted') {
    return (
      <aside className="vfr-alert-banner vfr-alert-banner--accepted" role="status">
        <div className="vfr-alert-banner__content">
          <span className="vfr-alert-banner__badge is-ok">PROCEDURĂ ACTIVĂ</span>
          <p className="vfr-alert-banner__msg">
            Recomandarea Asistentului a fost acceptată: {awaitingVfr.length} aeronave VFR ({aircraftList}) urmează
            eșalonarea pe RWY {runway} sau devierea optimă.
          </p>
        </div>
        <div className="vfr-alert-banner__actions">
          <button
            type="button"
            className="btn btn--xs btn--outline"
            onClick={() => setMode('assistant')}
            title="Deschide spațiul Asistent"
          >
            Detalii în Asistent →
          </button>
          <button
            type="button"
            className="btn btn--danger btn--xs"
            onClick={rejectVfrApproachRecommendation}
            title="Refuză recomandarea și preia controlul manual"
          >
            Refuză recomandarea
          </button>
          <button
            type="button"
            className="btn btn--quiet btn--xs vfr-alert-banner__close"
            onClick={dismissVfrNotificationBanner}
            aria-label="Închide notificarea"
            title="Închide notificarea"
          >
            ✕
          </button>
        </div>
      </aside>
    );
  }

  // Stare pending: Asistentul a identificat 2+ VFR în așteptare și propune apropierea
  return (
    <aside className="vfr-alert-banner vfr-alert-banner--pending" role="alert" aria-live="polite">
      <div className="vfr-alert-banner__content">
        <span className="vfr-alert-banner__badge is-alert">ALERTĂ VFR ({awaitingVfr.length})</span>
        <div className="vfr-alert-banner__body">
          <strong className="vfr-alert-banner__title">
            {awaitingVfr.length} aeronave VFR sunt în așteptare pentru aterizare ({aircraftList})
          </strong>
          <p className="vfr-alert-banner__desc">
            Asistentul a formulat o recomandare pentru procedura de apropiere pe RWY {runway} și devierea la nevoie spre
            aerodromurile de rezervă.
          </p>
        </div>
      </div>
      <div className="vfr-alert-banner__actions">
        <button
          type="button"
          className="btn btn--primary btn--xs"
          onClick={() => setMode('assistant')}
          title="Consultă analiza completă și recomandarea în tab-ul Asistent"
        >
          Vezi recomandarea în Asistent →
        </button>
        <button
          type="button"
          className="btn btn--danger btn--xs"
          onClick={rejectVfrApproachRecommendation}
          title="Refuză recomandarea Asistentului"
        >
          Refuză recomandarea
        </button>
        <button
          type="button"
          className="btn btn--quiet btn--xs vfr-alert-banner__close"
          onClick={dismissVfrNotificationBanner}
          aria-label="Închide notificarea"
          title="Închide notificarea"
        >
          ✕
        </button>
      </div>
    </aside>
  );
}
