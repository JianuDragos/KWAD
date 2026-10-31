import { describe, expect, it } from 'vitest';
import { liveTraffic, realisticCraiovaTraffic } from './mockBackend';
import { romatsaArrivals, romatsaIfrSchema, romatsaVfrSchema, withRomatsa } from './romatsa';

// Fișierele reale din backend, ca testul să pice când cineva le schimbă și mock-ul rămâne în urmă.
const data = import.meta.glob<unknown>('../../../AERIS API/data/romatsa-*-mock-db.json', { eager: true, import: 'default' });
const file = (kind: string) => Object.entries(data).find(([path]) => path.endsWith(`romatsa-${kind}-mock-db.json`))?.[1];
const arrivals = romatsaArrivals(romatsaIfrSchema.parse(file('ifr')), romatsaVfrSchema.parse(file('vfr')));

describe('romatsaArrivals', () => {
  it('ia zborurile spre LRCV din ambele baze, nu și pe cel spre Brașov', () => {
    expect(arrivals.map((a) => `${a.callsign} ${a.flightRules}`)).toEqual([
      'WZZ3751 IFR', 'WZZ3762 IFR', 'ROT641 IFR', 'YR-TNA VFR', 'YR-MDV VFR', 'HA-TDO VFR',
    ]);
  });

  it('pune ETA-ul IFR aproape de cel din traficul simulat al backendului', () => {
    const eta = Object.fromEntries(arrivals.map((a) => [a.callsign, a.etaSeconds]));
    expect(Math.abs(eta.WZZ3751 - 0)).toBeLessThan(120);
    expect(Math.abs(eta.WZZ3762 - 360)).toBeLessThan(120);
  });

  it('mock-ul conține exact avioanele calculate din bazele ROMATSA', () => {
    expect(withRomatsa(realisticCraiovaTraffic(), arrivals)).toEqual(liveTraffic().traffic);
  });
});
