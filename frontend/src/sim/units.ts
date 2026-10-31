// Toate conversiile de unități stau aici (regula din cartea proiectului).

export const FT_PER_M = 1 / 0.3048;
export const M_PER_NM = 1852;
export const KT_PER_MPS = 1.943844;

export const metersToFeet = (m: number) => m * FT_PER_M;
export const feetToMeters = (ft: number) => ft / FT_PER_M;

/** Eticheta de altitudine pentru blocul de date: FL peste altitudinea de tranziție, altfel picioare. */
export function altitudeLabel(altitudeMeters: number, transitionAltitudeFt = 4000): string {
  const ft = metersToFeet(altitudeMeters);
  if (ft > transitionAltitudeFt) return `FL${String(Math.round(ft / 100)).padStart(3, '0')}`;
  return `${Math.round(ft / 100) * 100} ft`;
}

/** Secunde de la începutul zilei → "HH:MM:SS". Backendul are doar o bază „14:00”, fără dată sau fus orar. */
export function clockLabel(secondsOfDay: number, withSeconds = true): string {
  const s = ((Math.floor(secondsOfDay) % 86400) + 86400) % 86400;
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return withSeconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
}

export function minutesLabel(seconds: number): string {
  const sign = seconds < 0 ? '−' : '';
  const abs = Math.abs(Math.round(seconds));
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return s === 0 ? `${sign}${m} min` : `${sign}${m}:${String(s).padStart(2, '0')} min`;
}

/**
 * Benzile de altitudine pentru culoarea avioanelor pe hartă (altitudine barometrică, față de nivelul mării;
 * aerodromul e la 628 ft). Culorile sunt în index.css, clasele alt-0 … alt-4.
 */
export const ALTITUDE_BANDS = [
  { id: 'alt-0', maxFt: 1500, label: 'sub 1 500 ft (aterizare, decolare)' },
  { id: 'alt-1', maxFt: 5000, label: '1 500–5 000 ft (apropiere)' },
  { id: 'alt-2', maxFt: 10000, label: '5 000–10 000 ft' },
  { id: 'alt-3', maxFt: 25000, label: '10 000–25 000 ft' },
  { id: 'alt-4', maxFt: Infinity, label: 'peste 25 000 ft (croazieră)' },
] as const;

export function altitudeBand(altitudeMeters: number | null): string {
  if (altitudeMeters == null) return 'alt-unknown';
  const ft = metersToFeet(altitudeMeters);
  return ALTITUDE_BANDS.find((b) => ft < b.maxFt)!.id;
}

/** Unitatea în care se afișează vitezele (vânt, viteză sol); datele vin în noduri și rămân în noduri în calcule. */
export type SpeedUnit = 'kmh' | 'kt';
export const SPEED_UNIT_LABEL: Record<SpeedUnit, string> = { kmh: 'km/h', kt: 'kt' };
export const speedValue = (knots: number, unit: SpeedUnit) => Math.round(unit === 'kmh' ? knots * 1.852 : knots);
export const speedLabel = (knots: number, unit: SpeedUnit) => `${speedValue(knots, unit)} ${SPEED_UNIT_LABEL[unit]}`;
