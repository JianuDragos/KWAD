import { describe, expect, it } from 'vitest';
import { convertUnitsInText } from './units';

describe('convertUnitsInText', () => {
  it('lasă textul neschimbat pe unitățile implicite', () => {
    const t = 'Vânt lateral 20.5 kt, YR-CRA la 9.4 NM.';
    expect(convertUnitsInText(t, 'kt', 'nm')).toBe(t);
  });

  it('convertește vitezele, inclusiv perechi și semne', () => {
    expect(convertUnitsInText('vânt lateral 0.1/15 kt, vânt frontal +8 kt, GS 140 kt', 'kmh', 'nm')).toBe(
      'vânt lateral 0.2/27.8 km/h, vânt frontal +14.8 km/h, GS 259 km/h',
    );
  });

  it('convertește distanțele și intervalele, fără să atingă FL sau RWY', () => {
    expect(convertUnitsInText('Pragurile 30–20 NM, minimum 4.0 NM, FL55, RWY 08', 'kt', 'km')).toBe(
      'Pragurile 55.6–37.0 km, minimum 7.4 km, FL55, RWY 08',
    );
  });

  it('trece altitudinile din picioare în metri, fără să atingă nivelurile de zbor', () => {
    const out = convertUnitsInText('vânt 2000ft 095°, holding la 1.500 ft, minim +4000 ft, FL055', 'kt', 'nm');
    expect(out).toBe('vânt 610 m 095°, holding la 460 m, minim +1 220 m, FL055'.replace(/ (?=m)/g, ' '));
  });
});
