// Catalog de aerodromuri de origine și regionale (coordonate WGS-84 reale)
// pentru generarea traiectoriilor complete Decolare → Croazieră → TOD → Apropiere → Aterizare.
import type { AircraftAdvisory, CraiovaAircraft } from '../contracts/backend';
import { ARP, LRCW, type IafId } from './geo';
import { bearingDeg, distanceNm, type LatLon } from '../sim/geomath';

export interface AirportInfo extends LatLon {
  icao: string;
  name: string;
  city: string;
  elevationFt: number;
  fir: string;
  preferredIaf?: IafId;
}

export const AIRPORTS: Record<string, AirportInfo> = {
  LRCV: { icao: 'LRCV', name: 'Craiova Intl', city: 'Craiova', lat: ARP.lat, lon: ARP.lon, elevationFt: 626, fir: 'LRBB' },
  EGGW: { icao: 'EGGW', name: 'London Luton', city: 'Londra', lat: 51.874444, lon: -0.368333, elevationFt: 526, fir: 'EGTT', preferredIaf: 'TITEK' },
  EGLL: { icao: 'EGLL', name: 'London Heathrow', city: 'Londra', lat: 51.4775, lon: -0.461389, elevationFt: 83, fir: 'EGTT', preferredIaf: 'TITEK' },
  LIME: { icao: 'LIME', name: 'Milan Bergamo', city: 'Milano', lat: 45.667408, lon: 9.699503, elevationFt: 782, fir: 'LIMM', preferredIaf: 'TITEK' },
  LIMC: { icao: 'LIMC', name: 'Milan Malpensa', city: 'Milano', lat: 45.6306, lon: 8.72811, elevationFt: 768, fir: 'LIMM', preferredIaf: 'TITEK' },
  LIRF: { icao: 'LIRF', name: 'Roma Fiumicino', city: 'Roma', lat: 41.811786, lon: 12.252253, elevationFt: 15, fir: 'LIRR', preferredIaf: 'PANZU' },
  LFPG: { icao: 'LFPG', name: 'Paris CDG', city: 'Paris', lat: 49.009747, lon: 2.547819, elevationFt: 392, fir: 'LFFF', preferredIaf: 'TITEK' },
  EHAM: { icao: 'EHAM', name: 'Amsterdam Schiphol', city: 'Amsterdam', lat: 52.308333, lon: 4.765, elevationFt: -11, fir: 'EHAA', preferredIaf: 'TITEK' },
  EDDF: { icao: 'EDDF', name: 'Frankfurt Main', city: 'Frankfurt', lat: 50.033333, lon: 8.570556, elevationFt: 364, fir: 'EDGG', preferredIaf: 'TITEK' },
  LOWW: { icao: 'LOWW', name: 'Vienna Intl', city: 'Viena', lat: 48.110278, lon: 16.569722, elevationFt: 600, fir: 'LOVV', preferredIaf: 'TITEK' },
  LHBP: { icao: 'LHBP', name: 'Budapest Liszt', city: 'Budapesta', lat: 47.439328, lon: 19.261808, elevationFt: 495, fir: 'LHCC', preferredIaf: 'TITEK' },
  LYBE: { icao: 'LYBE', name: 'Belgrade Tesla', city: 'Belgrad', lat: 44.819383, lon: 20.307067, elevationFt: 335, fir: 'LYBA', preferredIaf: 'TITEK' },
  LBSF: { icao: 'LBSF', name: 'Sofia Airport', city: 'Sofia', lat: 42.695, lon: 23.408333, elevationFt: 1742, fir: 'LBSR', preferredIaf: 'PANZU' },
  LTFM: { icao: 'LTFM', name: 'Istanbul Airport', city: 'Istanbul', lat: 41.275277, lon: 28.75194, elevationFt: 325, fir: 'LTAA', preferredIaf: 'PANZU' },
  OMDB: { icao: 'OMDB', name: 'Dubai Intl', city: 'Dubai', lat: 25.252778, lon: 55.364444, elevationFt: 62, fir: 'OMAE', preferredIaf: 'PANZU' },
  ZBAA: { icao: 'ZBAA', name: 'Beijing Capital', city: 'Beijing', lat: 40.074069, lon: 116.5908, elevationFt: 116, fir: 'ZBAA', preferredIaf: 'PEMOK' },
  ZSPD: { icao: 'ZSPD', name: 'Shanghai Pudong', city: 'Shanghai', lat: 31.142333, lon: 121.790844, elevationFt: 13, fir: 'ZSHA', preferredIaf: 'PEMOK' },
  LROP: { icao: 'LROP', name: 'București Otopeni', city: 'București', lat: 44.570992, lon: 26.085119, elevationFt: 314, fir: 'LRBB', preferredIaf: 'PEMOK' },
  LRBS: { icao: 'LRBS', name: 'București Băneasa', city: 'București', lat: 44.503483, lon: 26.103594, elevationFt: 297, fir: 'LRBB', preferredIaf: 'PEMOK' },
  LRCL: { icao: 'LRCL', name: 'Cluj-Napoca', city: 'Cluj-Napoca', lat: 46.785092, lon: 23.686119, elevationFt: 1039, fir: 'LRBB', preferredIaf: 'TITEK' },
  LRTR: { icao: 'LRTR', name: 'Timișoara Traian Vuia', city: 'Timișoara', lat: 45.809833, lon: 21.337872, elevationFt: 348, fir: 'LRBB', preferredIaf: 'TITEK' },
  LRSB: { icao: 'LRSB', name: 'Sibiu Intl', city: 'Sibiu', lat: 45.7858, lon: 24.091183, elevationFt: 1496, fir: 'LRBB', preferredIaf: 'TITEK' },
  LRCS: { icao: 'LRCS', name: 'Caransebeș', city: 'Caransebeș', lat: 45.420278, lon: 22.252222, elevationFt: 669, fir: 'LRBB', preferredIaf: 'TITEK' },
  LRCW: { icao: 'LRCW', name: 'Craiova-Sud (LRCW)', city: 'Craiova-Sud', lat: LRCW.lat, lon: LRCW.lon, elevationFt: 450, fir: 'LRBB' },
  PODARI: { icao: 'PODARI', name: 'Aerodrom Podari', city: 'Podari', lat: 44.2258, lon: 23.7654, elevationFt: 260, fir: 'LRBB' },
};

/** Rezolvă aerodromul de plecare al unei aeronave din analiza backendului, din câmpul explicit sau după ID. */
export function resolveOriginAirport(aircraft: CraiovaAircraft, advisory: AircraftAdvisory | null): AirportInfo {
  const ttl = advisory?.takeoffToLanding;
  const code = (aircraft.departureIcao ?? ttl?.departureAerodromeIcao ?? defaultIcaoForAircraft(aircraft)).toUpperCase();
  const known = AIRPORTS[code];
  if (known) return known;

  if (ttl?.departureLatitude != null && ttl?.departureLongitude != null) {
    return {
      icao: code,
      name: ttl.departureAerodromeName || code,
      city: ttl.departureAerodromeName || code,
      lat: ttl.departureLatitude,
      lon: ttl.departureLongitude,
      elevationFt: 400,
      fir: 'LRBB',
    };
  }
  return AIRPORTS.LROP;
}

function defaultIcaoForAircraft(ac: CraiovaAircraft): string {
  switch (ac.id) {
    case 'W4-3751':
      return 'EGGW';
    case 'W4-3762':
      return 'LIME';
    case 'CA-841':
      return 'ZBAA';
    case 'RO-204':
      return 'LROP';
    case 'YR-SAV':
      return 'PODARI';
    case 'YR-WILG':
      return 'LRCW';
    case 'YR-C172':
      return 'LRBS';
    default:
      if (ac.flightRules === 'IFR') return 'LROP';
      return ac.category === 'GeneralAviation' ? 'LRBS' : 'LRCW';
  }
}

/** Alege IAF-ul AIP corespunzător direcției din care sosește aeronava spre LRCV. */
export function selectIafForOrigin(origin: LatLon, fallbackIndex: number): IafId {
  const known = Object.values(AIRPORTS).find((a) => Math.abs(a.lat - origin.lat) < 0.001 && Math.abs(a.lon - origin.lon) < 0.001);
  if (known?.preferredIaf) return known.preferredIaf;
  if (distanceNm(origin, ARP) < 5) return (['TITEK', 'PEMOK', 'PANZU'] as const)[fallbackIndex % 3];

  const inboundFromDeg = bearingDeg(ARP, origin); // azimutul de la Craiova spre origine
  if (inboundFromDeg >= 30 && inboundFromDeg <= 125) return 'PEMOK';   // Est / Asia / București
  if (inboundFromDeg > 125 && inboundFromDeg <= 235) return 'PANZU';   // Sud / Sofia / Istanbul / Mediterana
  return 'TITEK';                                                      // Vest / Nord-Vest / Europa Centrală & Vest
}
