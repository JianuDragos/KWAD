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
