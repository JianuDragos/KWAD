import { useEffect, useMemo } from 'react';
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
import { destination } from '../sim/geomath';
import { positionAt, trackBearingDeg, trailUntil } from '../sim/interpolate';
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
    <MapContainer bounds={MAP_BOUNDS_WIDE} className="map" zoomSnap={0} zoomDelta={0.5} scrollWheelZoom={false} minZoom={7} maxZoom={16} attributionControl>
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
  // Zoom propriu pe touchpad/rotiță: gesturile mută o țintă, iar harta alunecă lin spre ea la fiecare cadru,
  // deci zoom-ul e progresiv, fără trepte, și nu se redesenează de zeci de ori pe secundă.
  useEffect(() => {
    // setZoomAround resetează harta la fiecare cadru și Leaflet șterge toate tile-urile (OSM dispare).
    // Folosim mecanismul intern al pinch-zoom-ului din Leaflet: păstrează tile-urile și le scalează.
    // shortcut: API privat Leaflet 1.9 (_move/_moveStart/_moveEnd), de reverificat la upgrade.
    const m = map as L.Map & {
      _move(center: L.LatLng, zoom: number, data?: { pinch?: boolean; round?: boolean }): void;
      _moveStart(zoomChanged: boolean, noMoveStart: boolean): void;
      _moveEnd(zoomChanged: boolean): void;
      _stop(): void;
    };
    const el = map.getContainer();
    let target: number | null = null;
    let anchorPoint: L.Point | null = null; // punctul de sub cursor rămâne fix pe ecran
    let anchorLatLng: L.LatLng | null = null;
    let frame = 0;
    const centerFor = (zoom: number) =>
      map.unproject(map.project(anchorLatLng!, zoom).subtract(anchorPoint!.subtract(map.getSize().divideBy(2))), zoom);
    const step = () => {
      if (target === null) return void (frame = 0);
      const diff = target - map.getZoom();
      const done = Math.abs(diff) < 0.002;
      const zoom = done ? target : map.getZoom() + diff * ZOOM_EASING;
      m._move(centerFor(zoom), zoom, { pinch: true, round: false });
      if (done) {
        target = null;
        frame = 0;
        m._moveEnd(true); // abia acum se încarcă tile-urile pentru zoom-ul final
      } else frame = requestAnimationFrame(step);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; // Firefox raportează în linii
      const speed = e.ctrlKey ? PINCH_ZOOM_PER_PX : WHEEL_ZOOM_PER_PX; // ctrlKey = pinch pe touchpad
      if (target === null) {
        m._stop();
        m._moveStart(true, false);
      }
      const next = (target ?? map.getZoom()) - px * speed;
      target = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), next));
      anchorPoint = map.mouseEventToContainerPoint(e);
      anchorLatLng = map.containerPointToLatLng(anchorPoint);
      if (!frame) frame = requestAnimationFrame(step);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      cancelAnimationFrame(frame);
    };
  }, [map]);
  return null;
}

/** Viteza zoom-ului: niveluri de zoom per pixel de scroll / pinch. Mărește valorile pentru zoom mai rapid. */
const WHEEL_ZOOM_PER_PX = 0.003;
const PINCH_ZOOM_PER_PX = 0.006;
/** Cât din distanța rămasă până la țintă parcurge zoom-ul pe cadru (mai mic = mai lin, mai lent). */
const ZOOM_EASING = 0.18;

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
      {[5, 10, 15, CTR_RADIUS_NM].map((nm) => {
        const p = destination(ARP, 135, nm); // etichete pe radialul 135°, ca la scope-urile clasice
        return (
          <CircleMarker key={`lbl-${nm}`} center={[p.lat, p.lon]} radius={0} pathOptions={{ stroke: false }} interactive={false}>
            <Tooltip permanent direction="center" className="lbl lbl--ring">
              {nm === CTR_RADIUS_NM ? `CTR ${nm} NM` : `${nm} NM`}
            </Tooltip>
          </CircleMarker>
        );
      })}
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

const GLYPH_IFR = '<path d="M12 2 L19 20 L12 16 L5 20 Z"/>';
const GLYPH_VFR = '<path d="M12 4 L17 18 L12 15 L7 18 Z"/><circle cx="12" cy="12" r="10" fill="none" stroke-width="1.5"/>';

function AircraftMarker({ flight }: { flight: FlightView }) {
  const t = useApp((s) => s.simTimeSeconds);
  const selected = useApp((s) => s.selectedId === flight.id);
  const select = useApp((s) => s.select);

  // După capătul traseului (aterizat sau ajuns la alternativă) avionul rămâne pe hartă, estompat.
  const track = flight.track;
  const last = track[track.length - 1];
  const done = !!last && t > last.timeSeconds;
  const pos = done
    ? { lat: last.latitudeDeg, lon: last.longitudeDeg, altitudeMeters: last.altitudeMeters, headingDeg: null }
    : positionAt(track, t);
  // Pe loc (aterizat, capăt de traseu) păstrăm direcția ultimului segment.
  const heading = Math.round(pos?.headingDeg ?? (track.length > 1 ? trackBearingDeg(track[track.length - 2], last) : 0));
  const rules = flight.aircraft.flightRules.toLowerCase();
  const statusClass = STATUS_CLASS[flight.status];

  // Rotația e în HTML-ul iconiței: Leaflet recreează elementul la fiecare schimbare, deci nu se mai pierde.
  // Pe segmente drepte direcția e constantă, așa că iconița se recreează doar la viraje.
  const icon = useMemo(
    () =>
      L.divIcon({
        className: '',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        html: `<div class="ac ac--${rules} ${statusClass} ${selected ? 'ac--selected' : ''} ${done ? 'ac--done' : ''}"><svg viewBox="0 0 24 24" class="ac__glyph" style="transform:rotate(${heading}deg)">${rules === 'ifr' ? GLYPH_IFR : GLYPH_VFR}</svg></div>`,
      }),
    [rules, statusClass, selected, done, heading],
  );

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
          key={`${done && !selected ? 'hover' : 'permanent'}-${selected}`} // Leaflet nu actualizează className după creare
          permanent={!done || selected}
          direction="right"
          offset={[12, 0]}
          className={`datablock ${selected ? 'datablock--selected' : ''}`}
        >
          <span className="db-callsign">{flight.callsign}</span>
          <br />
          {altitudeLabel(pos.altitudeMeters)} {flight.aircraft.flightRules}
          <br />
          <span className={isUnsequenced(flight) ? 'db-warn' : ''}>{tag}</span>
        </Tooltip>
      </Marker>
    </>
  );
}
