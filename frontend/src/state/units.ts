// Unitățile alese de utilizator (viteză: km/h sau noduri; distanță: NM sau km), ținute minte în browserul lui.
import { create } from 'zustand';
import { DISTANCE_UNIT_LABEL, SPEED_UNIT_LABEL, convertUnitsInText, distanceLabel, speedLabel, speedValue, type DistanceUnit, type SpeedUnit } from '../sim/units';
import { readPref, writePref } from './prefs';

interface UnitsState {
  speed: SpeedUnit;
  distance: DistanceUnit;
  setSpeed: (u: SpeedUnit) => void;
  setDistance: (u: DistanceUnit) => void;
}

export const useUnits = create<UnitsState>()((set) => ({
  speed: readPref('aeris.speedUnit', ['kt', 'kmh'], 'kt'),
  distance: readPref('aeris.distanceUnit', ['nm', 'km'], 'nm'),
  setSpeed: (speed) => {
    writePref('aeris.speedUnit', speed);
    set({ speed });
  },
  setDistance: (distance) => {
    writePref('aeris.distanceUnit', distance);
    set({ distance });
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

/** Pentru texte gata scrise (răspunsurile Asistentului): rescrie „kt” și „NM” în unitățile alese. */
export function useUnitText() {
  const speed = useUnits((s) => s.speed);
  const distance = useUnits((s) => s.distance);
  return (text: string) => convertUnitsInText(text, speed, distance);
}

/** Formatorul de distanțe (primește NM). */
export function useDistance() {
  const unit = useUnits((s) => s.distance);
  return { unit: DISTANCE_UNIT_LABEL[unit], label: (nm: number) => distanceLabel(nm, unit) };
}
