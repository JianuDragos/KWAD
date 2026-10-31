// Unitatea vitezelor aleasă de utilizator (km/h sau noduri), ținută minte în browserul lui.
import { create } from 'zustand';
import { SPEED_UNIT_LABEL, speedLabel, speedValue, type SpeedUnit } from '../sim/units';

const KEY = 'aeris.speedUnit';

function saved(): SpeedUnit {
  try {
    return localStorage.getItem(KEY) === 'kt' ? 'kt' : 'kmh';
  } catch {
    return 'kmh'; // stocare blocată (mod privat): implicit km/h
  }
}

export const useUnits = create<{ speed: SpeedUnit; setSpeed: (u: SpeedUnit) => void }>()((set) => ({
  speed: saved(),
  setSpeed: (speed) => {
    try {
      localStorage.setItem(KEY, speed);
    } catch {
      /* alegerea rămâne doar până la refresh */
    }
    set({ speed });
  },
}));

/** Formatorul de viteze pentru componentă; se re-randează când utilizatorul schimbă unitatea. */
export function useSpeed() {
  const unit = useUnits((s) => s.speed);
  return {
    unit: SPEED_UNIT_LABEL[unit],
    value: (knots: number) => speedValue(knots, unit),
    label: (knots: number) => speedLabel(knots, unit),
  };
}
