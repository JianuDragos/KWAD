import { ALTITUDE_BANDS } from '../sim/units';
import { useApp } from '../state/store';

/** Legenda culorilor de altitudine de pe hartă; se pornește din Setări, ca să nu acopere traficul. */
export function AltitudeLegend() {
  const show = useApp((s) => s.showAltitudeLegend);
  if (!show) return null;
  return (
    <div className="alt-legend" role="region" aria-label="Legendă altitudine">
      <span className="alt-legend__title">Altitudine</span>
      <ul>
        {[...ALTITUDE_BANDS].reverse().map((b) => (
          <li key={b.id}>
            <i className={`alt-legend__swatch ${b.id}`} aria-hidden="true" />
            {b.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
