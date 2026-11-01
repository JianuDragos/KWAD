import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFlag, readPref, writeFlag, writePref } from './prefs';

afterEach(() => vi.unstubAllGlobals());

describe('prefs', () => {
  it('ține minte alegerea și o citește după „refresh”', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    expect(readPref('aeris.speedUnit', ['kt', 'kmh'], 'kt')).toBe('kt');
    writePref('aeris.speedUnit', 'kmh');
    expect(readPref('aeris.speedUnit', ['kt', 'kmh'], 'kt')).toBe('kmh');
    expect(readFlag('aeris.showSectors', true)).toBe(true);
    writeFlag('aeris.showSectors', false);
    expect(readFlag('aeris.showSectors', true)).toBe(false);
  });

  it('ignoră valori necunoscute și stocarea blocată', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'ceva vechi', setItem: () => {} });
    expect(readPref('aeris.speedUnit', ['kt', 'kmh'], 'kt')).toBe('kt');
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocat'); }, setItem: () => { throw new Error('blocat'); } });
    expect(readFlag('aeris.showSectors', true)).toBe(true);
    expect(() => writeFlag('aeris.showSectors', false)).not.toThrow();
  });
});
