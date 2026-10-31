// Sectoare FIR / ACC / TMA Craiova și căi aeriene ATS pentru orientarea pe hartă (Rank 2).
// Limitele FIR complete (184 sectoare Europa–Asia) se încarcă din /airspace/firs.json
// (VATSpy Data Project, CC BY-SA 4.0 — doar pentru simulare/vizualizare, nu date AIP oficiale).
import { WAYPOINTS } from './geo';

export interface FirEntry {
  id: string;
  name: string;
  kind: 'fir' | 'sector';
  label: [number, number];
  /** [minLat, minLon, maxLat, maxLon] */
  bbox: [number, number, number, number];
  polygons: [number, number][][];
}

export interface FirsDataset {
  meta: {
    source: string;
    license: string;
    attribution: string;
    note: string;
  };
  firs: FirEntry[];
}

export interface AtsAirway {
  id: string;
  label: string;
  labelPos: [number, number];
  points: [number, number][];
}

/** ATZ LRCV (Aerodrome Traffic Zone) — 2.5 NM în jurul ARP (GND – 2500 ft AMSL, orientativ simulare). */
export const ATZ_RADIUS_NM = 2.5;

/** TMA Craiova (2500 ft – FL145, Clasa C/D, contur orientativ de simulare în jurul IAF-urilor TITEK, PEMOK, PANZU). */
export const TMA_CRAIOVA_POLYGON: [number, number][] = [
  [44.72, 23.22],
  [44.78, 24.05],
  [44.62, 24.64],
  [44.14, 24.62],
  [43.86, 24.08],
  [43.92, 23.36],
  [44.32, 23.14],
  [44.72, 23.22],
];

/** Căi aeriene ATS regionale care alimentează punctele IAF ale LRCV (orientare pe harta radar). */
export const ATS_AIRWAYS: AtsAirway[] = [
  {
    id: 'L605',
    label: 'L605 (Vest / Europa Centrală)',
    labelPos: [45.05, 22.72],
    points: [
      [45.82, 21.34], // zona Timișoara / ARAD
      [45.12, 22.62],
      [WAYPOINTS.TITEK.lat, WAYPOINTS.TITEK.lon],
    ],
  },
  {
    id: 'N133',
    label: 'N133 (Belgrad)',
    labelPos: [44.66, 22.18],
    points: [
      [44.82, 20.31], // LYBE
      [44.68, 22.35],
      [WAYPOINTS.TITEK.lat, WAYPOINTS.TITEK.lon],
    ],
  },
  {
    id: 'M747',
    label: 'M747 (Est / București / Asia)',
    labelPos: [44.49, 25.05],
    points: [
      [44.57, 26.08], // LROP / București
      [44.51, 25.02],
      [WAYPOINTS.PEMOK.lat, WAYPOINTS.PEMOK.lon],
    ],
  },
  {
    id: 'W85',
    label: 'W85 (Sud / Sofia)',
    labelPos: [43.42, 23.62],
    points: [
      [42.70, 23.41], // LBSF / Sofia
      [43.52, 23.68],
      [WAYPOINTS.PANZU.lat, WAYPOINTS.PANZU.lon],
    ],
  },
];

/** Set minimal încorporat pentru teste/offline înainte de încărcarea /airspace/firs.json. */
export const FALLBACK_FIRS: FirEntry[] = [
  {
    id: 'LRBB',
    name: 'București FIR',
    kind: 'fir',
    label: [45.75, 25.1],
    bbox: [43.62, 20.26, 48.26, 31.4],
    polygons: [[
      [47.95, 22.88], [48.25, 26.68], [47.25, 27.82], [45.45, 28.22],
      [45.18, 29.72], [43.74, 28.58], [43.68, 25.55], [43.85, 22.88],
      [44.21, 22.67], [44.72, 21.48], [46.15, 20.28], [47.95, 22.88],
    ]],
  },
  {
    id: 'LHCC',
    name: 'Budapest FIR',
    kind: 'fir',
    label: [47.15, 19.3],
    bbox: [45.74, 16.11, 48.58, 22.9],
    polygons: [[
      [48.0, 17.1], [48.55, 20.6], [47.95, 22.88], [46.15, 20.28],
      [45.78, 18.45], [46.45, 16.35], [48.0, 17.1],
    ]],
  },
  {
    id: 'LYBA',
    name: 'Beograd FIR',
    kind: 'fir',
    label: [44.1, 20.6],
    bbox: [41.85, 18.4, 46.18, 23.0],
    polygons: [[
      [46.15, 20.28], [44.72, 21.48], [44.21, 22.67], [42.3, 22.36],
      [42.1, 19.3], [44.85, 19.0], [45.78, 18.45], [46.15, 20.28],
    ]],
  },
  {
    id: 'LBSR',
    name: 'Sofia FIR',
    kind: 'fir',
    label: [42.8, 25.5],
    bbox: [41.24, 22.36, 44.21, 30.75],
    polygons: [[
      [44.21, 22.67], [43.85, 22.88], [43.68, 25.55], [43.74, 28.58],
      [42.0, 28.0], [41.35, 23.0], [42.3, 22.36], [44.21, 22.67],
    ]],
  },
  {
    id: 'LOVV',
    name: 'Wien FIR',
    kind: 'fir',
    label: [47.6, 14.5],
    bbox: [46.38, 9.53, 49.02, 17.16],
    polygons: [[
      [49.0, 15.0], [48.0, 17.1], [46.45, 16.35], [46.5, 13.0], [47.5, 9.6], [48.5, 13.5], [49.0, 15.0],
    ]],
  },
  {
    id: 'LIMM',
    name: 'Milano FIR',
    kind: 'fir',
    label: [45.3, 9.8],
    bbox: [43.5, 6.6, 47.1, 13.9],
    polygons: [[
      [46.5, 13.0], [45.3, 13.5], [43.8, 11.0], [44.0, 7.5], [46.2, 8.2], [46.5, 13.0],
    ]],
  },
  {
    id: 'EDGG',
    name: 'Langen FIR',
    kind: 'fir',
    label: [50.28, 8.25],
    bbox: [48.08, 5.86, 52.32, 10.96],
    polygons: [[
      [52.2, 7.0], [51.3, 10.5], [49.4, 10.9], [48.1, 7.6], [49.5, 6.3], [52.2, 7.0],
    ]],
  },
  {
    id: 'EGTT',
    name: 'London FIR',
    kind: 'fir',
    label: [51.9, -1.5],
    bbox: [49.0, -8.0, 55.2, 3.36],
    polygons: [[
      [55.0, -2.0], [53.2, 3.3], [51.0, 1.5], [49.5, -5.0], [52.3, -5.5], [55.0, -2.0],
    ]],
  },
  {
    id: 'ZBAA',
    name: 'Beijing FIR',
    kind: 'fir',
    label: [40.1, 115.8],
    bbox: [36.0, 110.0, 44.5, 120.5],
    polygons: [[
      [44.0, 111.0], [44.0, 119.8], [36.5, 119.5], [36.5, 111.0], [44.0, 111.0],
    ]],
  },
];

let cachedDataset: FirsDataset | null = null;
let inflightDataset: Promise<FirsDataset> | null = null;

export function loadFirsDataset(): Promise<FirsDataset> {
  if (cachedDataset) return Promise.resolve(cachedDataset);
  if (inflightDataset) return inflightDataset;

  const fallback: FirsDataset = {
    meta: {
      source: 'VATSpy Data Project (fallback local)',
      license: 'CC BY-SA 4.0',
      attribution: 'Limite FIR: VATSpy Data Project, CC BY-SA 4.0',
      note: 'Limite aproximative pentru simulare/vizualizare.',
    },
    firs: FALLBACK_FIRS,
  };

  if (typeof fetch !== 'function') {
    cachedDataset = fallback;
    return Promise.resolve(fallback);
  }

  inflightDataset = fetch('/airspace/firs.json')
    .then(async (res) => {
      if (!res.ok) return fallback;
      const json = (await res.json()) as FirsDataset;
      if (!Array.isArray(json?.firs) || json.firs.length === 0) return fallback;
      cachedDataset = json;
      return json;
    })
    .catch(() => fallback)
    .finally(() => {
      inflightDataset = null;
    });

  return inflightDataset;
}

/** Ray-casting clasic în coordonate [lat, lon]. */
export function pointInPolygon(lat: number, lon: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0];
    const xi = ring[i][1];
    const yj = ring[j][0];
    const xj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function findFirForPoint(lat: number, lon: number, firs: FirEntry[]): FirEntry | null {
  for (const fir of firs) {
    if (fir.kind !== 'fir') continue;
    const [minLat, minLon, maxLat, maxLon] = fir.bbox;
    if (lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) continue;
    for (const poly of fir.polygons) {
      if (pointInPolygon(lat, lon, poly)) return fir;
    }
  }
  return null;
}

/** Returnează lista ordonată (fără duplicate consecutive) de FIR-uri traversate de o rută [lat, lon][]. */
export function findTraversedFirs(route: [number, number][], firs: FirEntry[]): string[] {
  if (route.length === 0 || firs.length === 0) return [];
  const seen: string[] = [];
  const push = (id: string) => {
    if (seen[seen.length - 1] !== id && !seen.includes(id)) seen.push(id);
  };

  for (let i = 0; i < route.length; i++) {
    const [lat, lon] = route[i];
    const match = findFirForPoint(lat, lon, firs);
    if (match) push(match.id);
    if (i + 1 < route.length) {
      const [nLat, nLon] = route[i + 1];
      const mid = findFirForPoint((lat + nLat) * 0.5, (lon + nLon) * 0.5, firs);
      if (mid) push(mid.id);
    }
  }
  if (!seen.includes('LRBB')) seen.push('LRBB');
  return seen;
}
