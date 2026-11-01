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

/** Viteza verticală în m/s, cu semn și o zecimală; sub 0,05 m/s e zbor la nivel („0.0”, nu „-0.0”). */
export function verticalRateLabel(metersPerSecond: number): string {
  const v = Math.abs(metersPerSecond) < 0.05 ? 0 : metersPerSecond;
  return `${v > 0 ? '+' : ''}${v.toFixed(1)} m/s`;
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

/** Unitatea distanțelor afișate (mile marine sau kilometri); calculele rămân în NM. */
export type DistanceUnit = 'nm' | 'km';
export const DISTANCE_UNIT_LABEL: Record<DistanceUnit, string> = { nm: 'NM', km: 'km' };
/** Sub 10 cu o zecimală (8.3 NM), peste 10 rotunjit (36 NM). */
export function distanceLabel(nm: number, unit: DistanceUnit): string {
  const v = unit === 'km' ? (nm * M_PER_NM) / 1000 : nm;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${DISTANCE_UNIT_LABEL[unit]}`;
}

// „12”, „+7.9”, „20,5”; un grup e una sau mai multe valori legate prin „/” sau „–” („0.1/15 kt”, „30–20 NM”).
const NUM = String.raw`[+-]?\d+(?:[.,]\d+)?`;
const KT_GROUP = new RegExp(String.raw`(${NUM}(?:\s*[/–-]\s*${NUM})*)\s*kt\b`, 'g');
const NM_GROUP = new RegExp(String.raw`(${NUM}(?:\s*[/–-]\s*${NUM})*)\s*NM\b`, 'g');
const convertNumbers = (group: string, factor: number) =>
  group.replace(new RegExp(NUM, 'g'), (n) => {
    const v = Number(n.replace(',', '.')) * factor;
    // Sub 100 păstrăm o zecimală (8 kt → 14.8 km/h), ca să nu pierdem precizia valorilor mici.
    const abs = Math.abs(v) < 100 ? Math.abs(v).toFixed(1) : String(Math.round(Math.abs(v)));
    return (n.startsWith('+') ? '+' : v < 0 ? '-' : '') + abs;
  });

// „2000 ft”, „2000ft”, „1.500 ft” (punct de mii), cu semn opțional.
const FT_VALUE = /([+-]?)(\d{1,3}(?:[.,]\d{3})+|\d+)\s*ft\b/g;

/**
 * Texte venite gata scrise din backend (răspunsurile Asistentului, faptele): altitudinile trec mereu în metri,
 * ca în restul aplicației; vitezele și distanțele, în unitățile alese.
 */
export function convertUnitsInText(text: string, speed: SpeedUnit, distance: DistanceUnit): string {
  let out = text.replace(FT_VALUE, (_, sign: string, n: string) => sign + feetLabel(Number(n.replace(/[.,]/g, ''))));
  if (speed === 'kmh') out = out.replace(KT_GROUP, (_, g: string) => `${convertNumbers(g, 1.852)} km/h`);
  if (distance === 'km') out = out.replace(NM_GROUP, (_, g: string) => `${convertNumbers(g, M_PER_NM / 1000)} km`);
  return out;
}
