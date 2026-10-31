// Generează frontend/public/airspace/firs.json din VATSpy Data Project (CC BY-SA 4.0).
// Rulare: node tools/airspace/build-firs.mjs <Boundaries.geojson> <VATSpy.dat>
// Sursa: https://github.com/vatsimnetwork/vatspy-data-project (limite FIR/UIR/sectoare pentru simulare;
// aproximative, NU sunt date AIP oficiale). Păstrăm FIR-urile din Europa → Asia de Est (rute spre LRCV)
// și sectoarele ACC doar pentru LRBB, simplificate (Douglas–Peucker) ca fișierul să rămână mic.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [boundariesPath, datPath] = process.argv.slice(2);
if (!boundariesPath || !datPath) {
  console.error('Utilizare: node tools/airspace/build-firs.mjs <Boundaries.geojson> <VATSpy.dat>');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../frontend/public/airspace/firs.json');

/** Zona păstrată: vestul Europei → China (lon -12…125, lat 18…66). */
const KEEP = { minLon: -12, maxLon: 125, minLat: 18, maxLat: 66 };
/** Sectoarele (id cu „-”) le păstrăm doar pentru FIR-urile din această listă. */
const SECTOR_PREFIXES = ['LRBB-'];
/** Zone suprapuse peste FIR-uri reale (umbrele, TMA, FIS, militar, oceanic): ar dubla „FIR-ul curent”. */
const EXCLUDE = new Set(['ADR', 'EDXX', 'EGTL', 'EGTM', 'EGVV', 'LTXX', 'NAT', 'UKR', 'XVCL']);
/** Toleranța simplificării, în grade (~0,03° ≈ 3 km): suficient pentru o hartă de ansamblu. */
const TOLERANCE_DEG = 0.03;

const names = new Map();
let section = '';
for (const line of readFileSync(datPath, 'utf8').split(/\r?\n/)) {
  if (line.startsWith('[')) section = line.trim();
  else if (section === '[FIRs]' && line.includes('|')) {
    const [icao, name, , boundary] = line.split('|');
    names.set(boundary || icao, name);
    if (!names.has(icao)) names.set(icao, name);
  }
}

const geo = JSON.parse(readFileSync(boundariesPath, 'utf8'));

function perpDist(p, a, b) {
  const [x, y] = p, [x1, y1] = a, [x2, y2] = b;
  const dx = x2 - x1, dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function simplify(points, tol) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let max = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(points[i], points[s], points[e]);
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const r3 = (v) => Math.round(v * 1000) / 1000;

const firs = [];
for (const f of geo.features) {
  const id = f.properties.id;
  const isSector = id.includes('-');
  if (EXCLUDE.has(id)) continue;
  if (isSector && !SECTOR_PREFIXES.some((p) => id.startsWith(p))) continue;
  if (f.properties.oceanic === '1') continue;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  const polygons = [];
  for (const poly of polys) {
    const outer = poly[0];
    for (const [lon, lat] of outer) {
      minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    }
    const ring = simplify(outer, TOLERANCE_DEG).map(([lon, lat]) => [r3(lat), r3(lon)]);
    if (ring.length >= 4) polygons.push(ring);
  }
  if (!polygons.length) continue;
  if (maxLon < KEEP.minLon || minLon > KEEP.maxLon || maxLat < KEEP.minLat || minLat > KEEP.maxLat) continue;
  // FIR-urile care traversează antimeridianul nu sunt pe rutele noastre și ar strica proiecția.
  if (maxLon - minLon > 180) continue;
  firs.push({
    id,
    name: names.get(id) ?? id,
    kind: isSector ? 'sector' : 'fir',
    label: [r3(Number(f.properties.label_lat)), r3(Number(f.properties.label_lon))],
    bbox: [r3(minLat), r3(minLon), r3(maxLat), r3(maxLon)],
    polygons,
  });
}

firs.sort((a, b) => a.id.localeCompare(b.id));
const payload = {
  meta: {
    source: 'VATSpy Data Project (vatsimnetwork/vatspy-data-project)',
    license: 'CC BY-SA 4.0',
    attribution: 'Limite FIR: VATSpy Data Project, CC BY-SA 4.0',
    note: 'Limite aproximative pentru simulare/vizualizare; NU sunt date AIP oficiale.',
    generatedAt: new Date().toISOString(),
    toleranceDeg: TOLERANCE_DEG,
  },
  firs,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(payload));
console.log(`${firs.length} zone scrise în ${out} (${(JSON.stringify(payload).length / 1024).toFixed(0)} KB)`);
