import { useState } from 'react';
import { ALTITUDE_BANDS } from '../sim/units';

/** Legenda culorilor de altitudine de pe hartă; se poate restrânge ca să nu acopere traficul. */
export function AltitudeLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="alt-legend">
      <button className="alt-legend__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span aria-hidden="true">{open ? '▾' : '▴'}</span> Altitudine
      </button>
      {open && (
        <ul>
          {[...ALTITUDE_BANDS].reverse().map((b) => (
            <li key={b.id}>
              <i className={`alt-legend__swatch ${b.id}`} aria-hidden="true" />
              {b.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
