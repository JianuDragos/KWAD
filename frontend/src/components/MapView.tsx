import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import { Circle, CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import {
  ARP,
  CTR_RADIUS_NM,
  LRCW,
  MAP_BOUNDS_WIDE,
  NAVAIDS,
  RUNWAY_LINE,
  VFR_ENTRY_POINTS,
  WAYPOINTS,
  allArrivalRoutes,
  threshold,
  vfrFinalJoin,
  type RunwayId,
} from '../data/geo';
import { positionAt, trailUntil } from '../sim/interpolate';
import type { FlightView } from '../sim/traffic';
import { M_PER_NM, altitudeLabel, clockLabel } from '../sim/units';
import { BASE_TIME_OFFSET_SECONDS, useApp } from '../state/store';
import { STATUS_CLASS, STATUS_SHORT, isUnsequenced } from './flightStyle';

export function MapView() {
  const basemap = useApp((s) => s.basemap);
  const runway = useApp((s) => s.evaluation?.traffic.runway ?? null);
  const flights = useApp((s) => s.evaluation?.traffic.flights ?? null);
  const select = useApp((s) => s.select);

  return (
    <MapContainer bounds={MAP_BOUNDS_WIDE} className="map" zoomSnap={0} zoomDelta={0.25} wheelPxPerZoomLevel={120} attributionControl>
      {basemap === 'osm' && (
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          className="basemap-osm"
          maxZoom={18}
        />
      )}
      <ViewController />
      <BackgroundClick onClick={() => select(null)} />
      <StaticLayers runway={runway} />
      {flights?.map((f) => <AircraftMarker key={f.id} flight={f} />)}
    </MapContainer>
  );
}

function applyView(map: L.Map, view: 'wide' | 'close', animate: boolean) {
  if (view === 'wide') map.fitBounds(MAP_BOUNDS_WIDE, { animate });
  else map.setView([ARP.lat, ARP.lon], 12, { animate });
}

function ViewController() {
  const map = useMap();
  const view = useApp((s) => s.view);
  useEffect(() => {
    applyView(map, view, true);
  }, [map, view]);
  // Leaflet nu observă singur redimensionarea containerului (grid, panouri). La pornire containerul
  // poate avea încă dimensiunea 0, deci reîncadrăm vederea după fiecare redimensionare.
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      applyView(map, useApp.getState().view, false);
    });
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

function BackgroundClick({ onClick }: { onClick: () => void }) {
  const map = useMap();
  useEffect(() => {
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [map, onClick]);
  return null;
}

const ring = (nm: number) => nm * M_PER_NM;

function StaticLayers({ runway }: { runway: RunwayId | null }) {
  const routes = useMemo(() => (runway ? allArrivalRoutes(runway) : []), [runway]);
  const join = runway ? vfrFinalJoin(runway) : null;
  return (
    <>
      <Circle center={[ARP.lat, ARP.lon]} radius={ring(CTR_RADIUS_NM)} pathOptions={{ className: 'ctr', fill: false }} interactive={false} />
      {[5, 10, 15].map((nm) => (
        <Circle key={nm} center={[ARP.lat, ARP.lon]} radius={ring(nm)} pathOptions={{ className: 'range-ring', fill: false }} interactive={false} />
      ))}
      {routes.map((r) => (
        <Polyline key={r.iaf} positions={r.points} pathOptions={{ className: 'route' }} interactive={false} />
      ))}
      <Polyline positions={RUNWAY_LINE} pathOptions={{ className: 'runway' }} interactive={false} />
      {(['08', '26'] as RunwayId[]).map((r) => {
        const t = threshold(r);
        return (
          <CircleMarker key={r} center={[t.lat, t.lon]} radius={2} pathOptions={{ className: r === runway ? 'thr thr--active' : 'thr' }} interactive={false}>
            <Tooltip permanent direction={r === '08' ? 'left' : 'right'} className="lbl lbl--rwy" offset={[r === '08' ? -4 : 4, 0]}>
              {r}
            </Tooltip>
          </CircleMarker>
        );
      })}
      {Object.values(WAYPOINTS)
        .filter((w) => w.role === 'IAF' || w.role.startsWith('IF') || w.role.startsWith('FAF'))
        .map((w) => (
          <CircleMarker key={w.id} center={[w.lat, w.lon]} radius={3} pathOptions={{ className: `wpt ${w.role === 'IAF' ? 'wpt--iaf' : ''}` }} interactive={false}>
            <Tooltip permanent direction="top" className="lbl" offset={[0, -3]}>
              {w.id}
            </Tooltip>
          </CircleMarker>
        ))}
      {NAVAIDS.map((n) => (
        <CircleMarker key={n.id} center={[n.lat, n.lon]} radius={4} pathOptions={{ className: 'navaid' }} interactive={false}>
          <Tooltip permanent direction="bottom" className="lbl" offset={[0, 4]}>
            {n.id}
          </Tooltip>
        </CircleMarker>
      ))}
      {[...VFR_ENTRY_POINTS, ...(join ? [join] : [])].map((p) => (
        <CircleMarker key={p.id} center={[p.lat, p.lon]} radius={3} pathOptions={{ className: 'wpt wpt--synthetic' }} interactive={false}>
          <Tooltip permanent direction="top" className="lbl lbl--synthetic" offset={[0, -3]}>
            {p.id}*
          </Tooltip>
        </CircleMarker>
      ))}
      <CircleMarker center={[LRCW.lat, LRCW.lon]} radius={3} pathOptions={{ className: 'wpt wpt--alt' }} interactive={false}>
        <Tooltip permanent direction="left" className="lbl" offset={[-4, 0]}>
          LRCW
        </Tooltip>
      </CircleMarker>
    </>
  );
}

const GLYPH_IFR =
  '<svg viewBox="0 0 24 24" class="ac__glyph"><path d="M12 2 L19 20 L12 16 L5 20 Z"/></svg>';
const GLYPH_VFR =
  '<svg viewBox="0 0 24 24" class="ac__glyph"><path d="M12 4 L17 18 L12 15 L7 18 Z"/><circle cx="12" cy="12" r="10" fill="none" stroke-width="1.5"/></svg>';

function AircraftMarker({ flight }: { flight: FlightView }) {
  const t = useApp((s) => s.simTimeSeconds);
  const selected = useApp((s) => s.selectedId === flight.id);
  const select = useApp((s) => s.select);
  const markerRef = useRef<L.Marker>(null);
  const lastHeading = useRef(0);

  // După capătul traseului (aterizat sau ajuns la alternativă) avionul rămâne pe hartă, estompat.
  const last = flight.track[flight.track.length - 1];
  const done = !!last && t > last.timeSeconds;
  const pos = done
    ? { lat: last.latitudeDeg, lon: last.longitudeDeg, altitudeMeters: last.altitudeMeters, headingDeg: null }
    : positionAt(flight.track, t);
  const heading = pos?.headingDeg ?? null;
  const rules = flight.aircraft.flightRules.toLowerCase();

  const icon = useMemo(
    () =>
      L.divIcon({
        className: '',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        html: `<div class="ac ac--${rules} ${STATUS_CLASS[flight.status]} ${selected ? 'ac--selected' : ''} ${done ? 'ac--done' : ''}">${rules === 'ifr' ? GLYPH_IFR : GLYPH_VFR}</div>`,
      }),
    [rules, flight.status, selected, done],
  );

  // Rotim doar glifa, fără să recreăm iconița la fiecare cadru. Fără direcție (avion pe loc) păstrăm ultima.
  useEffect(() => {
    if (heading !== null) lastHeading.current = heading;
    const el = markerRef.current?.getElement()?.querySelector<SVGElement>('.ac__glyph');
    if (el) el.style.transform = `rotate(${lastHeading.current}deg)`;
  }, [heading, icon]);

  const trail = useMemo(() => trailUntil(flight.track, t), [flight.track, t]);
  if (!pos) return null;

  const tag = done
    ? flight.alternate
      ? `LA ${flight.alternate.code === 'LRBV' ? 'LRCW' : flight.alternate.code}`
      : `ATERIZAT ${clockLabel(BASE_TIME_OFFSET_SECONDS + (flight.landingSeconds ?? last.timeSeconds), false)}`
    : flight.status === 'ClearedForApproach'
      ? flight.slot
        ? `SLOT ${clockLabel(BASE_TIME_OFFSET_SECONDS + flight.slot.calculatedTimeSeconds, false)}`
        : 'FĂRĂ SLOT'
      : STATUS_SHORT[flight.status];

  return (
    <>
      {!done && <Polyline positions={trail} pathOptions={{ className: `trail trail--${rules}` }} interactive={false} />}
      {selected && <Polyline positions={flight.plannedRoute} pathOptions={{ className: 'planned' }} interactive={false} />}
      <Marker
        ref={markerRef}
        position={[pos.lat, pos.lon]}
        icon={icon}
        keyboard
        title={flight.callsign}
        eventHandlers={{
          click: (e) => {
            L.DomEvent.stopPropagation(e);
            select(flight.id);
          },
        }}
      >
        {/* Avioanele aterizate stau grămadă la capătul pistei: eticheta lor apare doar la hover sau selecție. */}
        <Tooltip
          key={done && !selected ? 'hover' : 'permanent'}
          permanent={!done || selected}
          direction="right"
          offset={[12, 0]}
          className={`datablock ${selected ? 'datablock--selected' : ''}`}
        >
          <span className="db-callsign">{flight.callsign}</span>
          <br />
          {altitudeLabel(pos.altitudeMeters)} · {flight.aircraft.flightRules}
          <br />
          <span className={isUnsequenced(flight) ? 'db-warn' : ''}>{tag}</span>
        </Tooltip>
      </Marker>
    </>
  );
}
