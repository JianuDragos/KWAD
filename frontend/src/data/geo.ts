// Acces tipizat la geometria LRCV din AIP (lrcv-geo.json) plus punctele sintetice ale demo-ului.
import raw from './lrcv-geo.json';
import { destination, type LatLon } from '../sim/geomath';

export type RunwayId = '08' | '26';

export type NamedPoint = LatLon & { id: string; role: string; synthetic?: boolean };

export const ARP: LatLon = { lat: raw.aerodrome.arp.latitudeDeg, lon: raw.aerodrome.arp.longitudeDeg };
export const AERODROME_ELEVATION_FT = raw.aerodrome.elevationFt;
export const CTR_RADIUS_NM = raw.airspace.ctr.radiusNm;
export const AIRAC_NOTE = raw._meta.source;

const runwayById = Object.fromEntries(raw.runways.map((r) => [r.designator, r])) as Record<RunwayId, (typeof raw.runways)[number]>;

export function threshold(rwy: RunwayId): NamedPoint & { elevationFt: number } {
  const t = runwayById[rwy].threshold;
  return { id: `THR${rwy}`, role: 'THR', lat: t.latitudeDeg, lon: t.longitudeDeg, elevationFt: t.elevationFt };
}

export function runwayTrueBearing(rwy: RunwayId): number {
  return runwayById[rwy].trueBearingDeg;
}

export const RUNWAY_LINE: [number, number][] = [
  [threshold('08').lat, threshold('08').lon],
  [threshold('26').lat, threshold('26').lon],
];

export const WAYPOINTS: Record<string, NamedPoint> = Object.fromEntries(
  raw.waypoints.map((w) => [w.id, { id: w.id, role: w.role, lat: w.latitudeDeg, lon: w.longitudeDeg }]),
);

export const NAVAIDS: NamedPoint[] = raw.navaids.map((n) => ({ id: n.ident, role: n.type, lat: n.latitudeDeg, lon: n.longitudeDeg }));

export const IAF_IDS = ['TITEK', 'PEMOK', 'PANZU'] as const;
export type IafId = (typeof IAF_IDS)[number];

export function pointById(id: string): NamedPoint {
  if (id === 'THR08') return threshold('08');
  if (id === 'THR26') return threshold('26');
  const p = WAYPOINTS[id];
  if (!p) throw new Error(`Punct necunoscut în lrcv-geo.json: ${id}`);
  return p;
}

type Approach = (typeof raw.approaches)[number];

function approach(rwy: RunwayId): Approach {
  const a = raw.approaches.find((x) => x.runway === rwy);
  if (!a) throw new Error(`Lipsește abordarea pentru pista ${rwy}`);
  return a;
}

/** Altitudinea publicată la un punct („+FL060”, „+4000ft”, „@2500ft”), în picioare. */
export function publishedAltitudeFt(constraint: string | undefined): number | null {
  if (!constraint) return null;
  const m = /[+@-]?(FL)?(\d+)/.exec(constraint);
  if (!m) return null;
  return m[1] ? Number(m[2]) * 100 : Number(m[2]);
}

export type RouteFix = NamedPoint & { altitudeFt: number | null };

/** Tranziția AIP de la un IAF până la prag: IAF → … → IF → FAF → THR. */
export function arrivalRoute(rwy: RunwayId, iaf: IafId): RouteFix[] {
  const a = approach(rwy);
  const tr = a.transitions.find((t) => t.from === iaf);
  if (!tr) throw new Error(`Lipsește tranziția ${iaf} pentru pista ${rwy}`);
  const constraints: Record<string, string | undefined> = { ...tr.constraints, ...a.final.constraints };
  const ids = [...tr.legs, ...a.final.legs.slice(1)];
  return ids.map((id) => ({ ...pointById(id), altitudeFt: publishedAltitudeFt(constraints[id]) }));
}

/** Toate tranzițiile pistei, pentru desenarea traseelor pe hartă. */
export function allArrivalRoutes(rwy: RunwayId): { iaf: IafId; points: [number, number][] }[] {
  return IAF_IDS.map((iaf) => ({ iaf, points: arrivalRoute(rwy, iaf).map((p) => [p.lat, p.lon] as [number, number]) }));
}

/** Backendul folosește încă denumirea veche 09/27; în AIP-ul curent pista este 08/26. */
export function aipRunwayFromBackend(backendRunway: string): RunwayId {
  return backendRunway === '27' || backendRunway === '26' ? '26' : '08';
}

// ---------- Puncte sintetice (nu există în AIP) ----------

/** Puncte de intrare VFR inventate pentru demo; LRCV nu are puncte VFR publicate. */
export const VFR_ENTRY_POINTS: NamedPoint[] = [
  { id: 'VFR-S', role: 'Intrare VFR (sintetic)', synthetic: true, ...destination(ARP, 180, 12) },
  { id: 'VFR-N', role: 'Intrare VFR (sintetic)', synthetic: true, ...destination(ARP, 0, 12) },
  { id: 'VFR-W', role: 'Intrare VFR (sintetic)', synthetic: true, ...destination(ARP, 250, 12) },
];

/** Punct de aliniere VFR pe prelungirea axului, la 3 NM de prag (sintetic). */
export function vfrFinalJoin(rwy: RunwayId): NamedPoint {
  const thr = threshold(rwy);
  const reciprocal = (runwayTrueBearing(rwy) + 180) % 360;
  return { id: `F${rwy}-3NM`, role: 'Aliniere finală VFR (sintetic)', synthetic: true, ...destination(thr, reciprocal, 3) };
}

/** Craiova-Sud din AIP (AD 2.32 LRCW). Backendul îl numește greșit „Balta Verde LRBV”. */
export const LRCW: NamedPoint = { id: 'LRCW', role: 'Craiova-Sud (AIP)', lat: 44.286389, lon: 23.791111 };

export const MAP_BOUNDS_WIDE: [[number, number], [number, number]] = [
  [43.98, 23.48],
  [44.56, 24.42],
];
