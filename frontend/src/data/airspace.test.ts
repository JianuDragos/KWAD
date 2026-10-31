import { describe, expect, it } from 'vitest';
import rawFirsDataset from '../../public/airspace/firs.json';
import { AIRPORTS } from './airports';
import { ARP } from './geo';
import { FALLBACK_FIRS, findFirForPoint, findTraversedFirs, pointInPolygon, type FirsDataset } from './airspace';
import { greatCirclePoints } from '../sim/geomath';

describe('airspace & sectoare FIR (Rank 2)', () => {
  const dataset = rawFirsDataset as unknown as FirsDataset;

  it('firs.json conține sectoarele FIR Europa–Asia și metadatele de licență CC BY-SA 4.0', () => {
    expect(dataset.meta.license).toBe('CC BY-SA 4.0');
    expect(dataset.firs.length).toBeGreaterThanOrEqual(150);
    const ids = new Set(dataset.firs.map((f) => f.id));
    expect(ids.has('LRBB')).toBe(true);
    expect(ids.has('EGTT')).toBe(true);
    expect(ids.has('LIMM')).toBe(true);
    expect(ids.has('LHCC')).toBe(true);
    expect(ids.has('LBSR')).toBe(true);
    expect(ids.has('ZBAA')).toBe(true);
  });

  it('identifică corect FIR-ul pentru Craiova (LRBB), Londra (EGTT) și Beijing (ZBAA)', () => {
    expect(findFirForPoint(ARP.lat, ARP.lon, dataset.firs)?.id).toBe('LRBB');
    expect(findFirForPoint(AIRPORTS.EGGW.lat, AIRPORTS.EGGW.lon, dataset.firs)?.id).toBe('EGTT');
    expect(findFirForPoint(AIRPORTS.ZBAA.lat, AIRPORTS.ZBAA.lon, dataset.firs)?.id).toBe('ZBAA');
    // Funcționează și pe setul minimal offline FALLBACK_FIRS
    expect(findFirForPoint(ARP.lat, ARP.lon, FALLBACK_FIRS)?.id).toBe('LRBB');
  });

  it('detectează lanțul complet de FIR-uri traversate pe rutele EGGW → LRCV și ZBAA → LRCV', () => {
    const londonRoute = greatCirclePoints(AIRPORTS.EGGW, ARP, 45).map((p) => [p.lat, p.lon] as [number, number]);
    const londonFirs = findTraversedFirs(londonRoute, dataset.firs);
    expect(londonFirs[0]).toBe('EGTT');
    expect(londonFirs[londonFirs.length - 1]).toBe('LRBB');
    expect(londonFirs.length).toBeGreaterThanOrEqual(5);

    const beijingRoute = greatCirclePoints(AIRPORTS.ZBAA, ARP, 60).map((p) => [p.lat, p.lon] as [number, number]);
    const beijingFirs = findTraversedFirs(beijingRoute, dataset.firs);
    expect(beijingFirs[0]).toBe('ZBAA');
    expect(beijingFirs).toContain('LRBB');
    expect(beijingFirs.length).toBeGreaterThanOrEqual(6);
  });

  it('pointInPolygon verifică interiorul și exteriorul unui poligon simplu', () => {
    const box: [number, number][] = [
      [44, 23],
      [45, 23],
      [45, 25],
      [44, 25],
      [44, 23],
    ];
    expect(pointInPolygon(44.32, 23.89, box)).toBe(true);
    expect(pointInPolygon(46.0, 23.89, box)).toBe(false);
  });
});
