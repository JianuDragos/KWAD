import type { FlightView } from '../sim/traffic';

export const STATUS_LABEL: Record<FlightView['status'], string> = {
  ClearedForApproach: 'Aprobat apropiere',
  HoldInOrbitRecommended: 'Așteptare (orbită)',
  DivertRecommended: 'Deviere recomandată',
  Necunoscut: 'Fără recomandare',
};

export const STATUS_SHORT: Record<FlightView['status'], string> = {
  ClearedForApproach: 'APP',
  HoldInOrbitRecommended: 'HOLD',
  DivertRecommended: 'DIV',
  Necunoscut: '—',
};

export const STATUS_CLASS: Record<FlightView['status'], string> = {
  ClearedForApproach: 'st-cleared',
  HoldInOrbitRecommended: 'st-hold',
  DivertRecommended: 'st-divert',
  Necunoscut: 'st-unknown',
};

export const CATEGORY_LABEL: Record<FlightView['aircraft']['category'], string> = {
  CommercialJet: 'Avion comercial',
  RegionalTurboprop: 'Turbopropulsor regional',
  GeneralAviation: 'Aviație generală',
  UltralightAndGlider: 'Ultraușor / STOL',
};

/** Aprobat de backend, dar fără slot: efectul bugului „doar primul VFR e secvențiat”. */
export function isUnsequenced(f: FlightView): boolean {
  return f.status === 'ClearedForApproach' && f.slot === null;
}
