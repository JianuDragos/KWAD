// Avioanele reale (OpenSky / ADSB.lol) pe hartă: urmă istorică rulantă + vector de viteză proiectat 5 min.
import { useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import { Marker, Polyline, Tooltip } from 'react-leaflet';
import type { LiveFlight } from '../contracts/live';
import { destination } from '../sim/geomath';
import { extrapolate, fromLrcv, trendArrow } from '../sim/live';
import { altitudeBand, altitudeLabel } from '../sim/units';
import { useDistance, useSpeed } from '../state/units';
import { useLive } from '../state/live';
import { GLYPH_IFR } from './MapView';
import { useHeldWhileZooming, useTrafficRenderer } from './mapHelpers';

/** Peste atâtea secunde fără contact, avionul apare estompat (date vechi). */
const STALE_SECONDS = 60;
const MAX_HISTORY_POINTS = 40;

/** Istoric rulant al pozițiilor observate pe sesiune (pentru urma de pe radar în modul Live). */
const liveTrailHistory = new Map<string, [number, number][]>();

function recordLiveHistory(flights: LiveFlight[] | null) {
  if (!flights) return;
  const active = new Set<string>();
  for (const f of flights) {
    active.add(f.icao24);
    if (f.onGround || f.latitude == null || f.longitude == null) continue;
    const prev = liveTrailHistory.get(f.icao24) ?? [];
    const last = prev[prev.length - 1];
    if (!last || Math.abs(last[0] - f.latitude) > 0.0004 || Math.abs(last[1] - f.longitude) > 0.0004) {
      const next = [...prev, [f.latitude, f.longitude] as [number, number]];
      if (next.length > MAX_HISTORY_POINTS) next.shift();
      liveTrailHistory.set(f.icao24, next);
    }
  }
  for (const key of liveTrailHistory.keys()) {
    if (!active.has(key)) liveTrailHistory.delete(key);
  }
}

export function LiveTraffic() {
  const flights = useHeldWhileZooming(useLive((s) => s.positions?.flights ?? null));
  const tracking = useHeldWhileZooming(useLive((s) => s.vfrTracking));
  const trafficRenderer = useTrafficRenderer();
  const [tickNow, setNow] = useState(() => Date.now() / 1000);
  const now = useHeldWhileZooming(tickNow);

  useEffect(() => {
    recordLiveHistory(flights);
  }, [flights]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      {(flights ?? [])
        .filter((f) => !f.onGround)
        .map((f) => (
          <LiveMarker key={f.icao24} flight={f} now={now} />
        ))}
      {(tracking?.vfrFlights ?? []).map((f) => {
        const live = flights?.find((candidate) => candidate.icao24 === f.flightId);
        if (live?.latitude == null || live.longitude == null) return null;
        const point = tracking?.points.find((p) => p.code === f.pointCode);
        return point ? (
          <Polyline
            renderer={trafficRenderer}
            key={`vfr-route-${f.flightId}`}
            positions={[
              [live.latitude, live.longitude],
              [point.lat, point.long],
            ]}
            pathOptions={{ className: 'full-route full-route--vfr predicted' }}
            interactive={false}
          />
        ) : null;
      })}
    </>
  );
}

function LiveMarker({ flight, now }: { flight: LiveFlight; now: number }) {
  const selected = useLive((s) => s.selectedIcao === flight.icao24);
  const showAllRoutes = useLive((s) => s.showRoutes);
  const select = useLive((s) => s.select);
  const speed = useSpeed();
  const distance = useDistance();
  const pos = extrapolate(flight, now);
  const stale = now - flight.lastContact > STALE_SECONDS;
  const heading = Math.round(flight.trueTrackDegrees ?? 0);
  const band = altitudeBand(flight.baroAltitudeMeters);
  const rulesLower = flight.flightRules.toLowerCase();
  const trafficRenderer = useTrafficRenderer();

  const icon = useMemo(
    () =>
      L.divIcon({
        className: '',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        html: `<div class="ac ac--live ac--${rulesLower} ${selected ? 'ac--selected' : ''} ${stale ? 'ac--done' : ''}"><svg viewBox="0 0 24 24" class="ac__glyph" style="transform:rotate(${heading}deg)">${flight.flightRules === 'IFR' ? GLYPH_IFR : '<path d="M12 4 L17 18 L12 15 L7 18 Z"/><circle cx="12" cy="12" r="10" fill="none" stroke-width="1.5"/>'}</svg></div>`,
      }),
    [flight.flightRules, rulesLower, selected, stale, heading],
  );
  if (!pos) return null;

  const history = liveTrailHistory.get(flight.icao24) ?? [];
  const trailPoints: [number, number][] = history.length > 0 ? [...history, [pos.lat, pos.lon]] : [];

  // Vector de proiecție 5 minute pe direcția curentă (ca pe consolele radar Eurocat/TopSky)
  const projDistNm =
    flight.velocityKnots != null && flight.velocityKnots > 25 && flight.trueTrackDegrees != null
      ? (flight.velocityKnots * 5) / 60
      : 0;
  const projEnd = projDistNm > 0.3 && flight.trueTrackDegrees != null ? destination(pos, flight.trueTrackDegrees, projDistNm) : null;

  const lrcv = fromLrcv(flight);

  return (
    <>
      {trailPoints.length > 1 && (
        <Polyline renderer={trafficRenderer} positions={trailPoints} pathOptions={{ className: `trail trail--${rulesLower}` }} interactive={false} />
      )}
      {(showAllRoutes || selected) && projEnd && (
        <Polyline
          renderer={trafficRenderer}
          positions={[
            [pos.lat, pos.lon],
            [projEnd.lat, projEnd.lon],
          ]}
          pathOptions={{ className: `live-vector trail--${rulesLower} predicted` }}
          interactive={false}
        />
      )}
      <Marker
        position={[pos.lat, pos.lon]}
        icon={icon}
        keyboard
        title={flight.callsign}
        eventHandlers={{
          click: (e) => {
            L.DomEvent.stopPropagation(e);
            select(flight.icao24);
          },
        }}
      >
        <Tooltip key={String(selected)} permanent direction="right" offset={[12, 0]} className={`datablock ${selected ? 'datablock--selected' : ''}`}>
          <span className="db-callsign">{flight.callsign || flight.icao24.toUpperCase()}</span>
          <br />
          <span className={`db-alt ${band}`}>{flight.baroAltitudeMeters != null ? altitudeLabel(flight.baroAltitudeMeters) : '—'}</span> {trendArrow(flight.verticalRateMs)}
          <br />
          {flight.velocityKnots != null ? speed.label(flight.velocityKnots) : ''}{lrcv ? ` · ${distance.label(lrcv.nm)}` : ''}
          <br />
          {flight.flightRules}
          {flight.vfrEtaMinutes != null && (
            <>
              <br />
              ETA VFR {flight.vfrEtaMinutes.toFixed(1)} min
            </>
          )}
        </Tooltip>
      </Marker>
    </>
  );
}
