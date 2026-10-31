// Toate conversiile de unități stau aici (regula din cartea proiectului).

export const FT_PER_M = 1 / 0.3048;
export const M_PER_NM = 1852;
export const KT_PER_MPS = 1.943844;

export const metersToFeet = (m: number) => m * FT_PER_M;
export const feetToMeters = (ft: number) => ft / FT_PER_M;

/** 10970 → „10 970”: separator de mii cu spațiu (punctul din ro-RO s-ar confunda cu zecimalele). */
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Altitudinea afișată, în metri rotunjiți la 10 m; datele (backend, OpenSky) rămân în unitățile lor. */
export function altitudeLabel(altitudeMeters: number): string {
  return `${thousands(Math.round(altitudeMeters / 10) * 10)} m`;
}

/** Altitudine din backend (în picioare), afișată în metri. */
export const feetLabel = (ft: number) => altitudeLabel(feetToMeters(ft));

/** Viteza verticală în m/s, cu semn și o zecimală. */
export const verticalRateLabel = (metersPerSecond: number) => `${metersPerSecond > 0 ? '+' : ''}${metersPerSecond.toFixed(1)} m/s`;

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
 * aerodromul e la 191 m). Culorile sunt în index.css, clasele alt-0 … alt-4.
 */
export const ALTITUDE_BANDS = [
  { id: 'alt-0', maxM: 500, label: 'sub 500 m (aterizare, decolare)' },
  { id: 'alt-1', maxM: 1500, label: '500–1 500 m (apropiere)' },
  { id: 'alt-2', maxM: 3000, label: '1 500–3 000 m' },
  { id: 'alt-3', maxM: 7500, label: '3 000–7 500 m' },
  { id: 'alt-4', maxM: Infinity, label: 'peste 7 500 m (croazieră)' },
] as const;

export function altitudeBand(altitudeMeters: number | null): string {
  if (altitudeMeters == null) return 'alt-unknown';
  return ALTITUDE_BANDS.find((b) => altitudeMeters < b.maxM)!.id;
}

/** Unitatea în care se afișează vitezele (vânt, viteză sol); datele vin în noduri și rămân în noduri în calcule. */
export type SpeedUnit = 'kmh' | 'kt';
export const SPEED_UNIT_LABEL: Record<SpeedUnit, string> = { kmh: 'km/h', kt: 'kt' };
export const speedValue = (knots: number, unit: SpeedUnit) => Math.round(unit === 'kmh' ? knots * 1.852 : knots);
export const speedLabel = (knots: number, unit: SpeedUnit) => `${speedValue(knots, unit)} ${SPEED_UNIT_LABEL[unit]}`;
