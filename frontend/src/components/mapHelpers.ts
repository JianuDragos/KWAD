// Utilitare mici pentru MapView ca să păstrăm componenta curată.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type L from 'leaflet';
import { useMap } from 'react-leaflet';
import { destination, type LatLon } from '../sim/geomath';
import { trackBearingDeg, type TrackPoint } from '../sim/interpolate';

export { destination };

export function trackBearingDegSafe(a: TrackPoint, b: TrackPoint): number {
  return trackBearingDeg(a, b);
}

export function isInboundTowards(pos: LatLon, target: LatLon, trackDeg: number | null, toleranceDeg = 38): boolean {
  if (trackDeg == null) return false;
  const rad = Math.PI / 180;
  const dLon = (target.lon - pos.lon) * rad;
  const y = Math.sin(dLon) * Math.cos(target.lat * rad);
  const x =
    Math.cos(pos.lat * rad) * Math.sin(target.lat * rad) -
    Math.sin(pos.lat * rad) * Math.cos(target.lat * rad) * Math.cos(dLon);
  const brg = (Math.atan2(y, x) / rad + 360) % 360;
  let diff = Math.abs(brg - trackDeg) % 360;
  if (diff > 180) diff = 360 - diff;
  return diff <= toleranceDeg;
}

/**
 * Întoarce valoarea de dinaintea zoom-ului cât timp zoom-ul e în curs. O linie redesenată în timpul zoom-ului
 * e proiectată la zoom-ul nou, dar afișată în imaginea SVG încă scalată de la ultima redesenare, deci s-ar deplasa.
 */
export function useHeldWhileZooming<T>(value: T): T {
  const map = useMap();
  const latest = useRef(value);
  const [held, setHeld] = useState<{ value: T } | null>(null);
  useEffect(() => {
    latest.current = value;
  });
  useEffect(() => {
    const start = () => setHeld({ value: latest.current });
    const end = () => setHeld(null);
    map.on('zoomstart', start);
    map.on('zoomend', end);
    return () => {
      map.off('zoomstart', start);
      map.off('zoomend', end);
    };
  }, [map]);
  return held ? held.value : value;
}

/**
 * Stratul SVG separat pentru liniile avioanelor (urme, rute, vectori). Sunt puține, deci se redesenează
 * la fiecare cadru de zoom; restul hărții (FIR-uri, grilă) e greu și se redesenează mai rar.
 */
export const TrafficRendererContext = createContext<L.Renderer | undefined>(undefined);
export const useTrafficRenderer = () => useContext(TrafficRendererContext);
