import { useEffect, useMemo, useState, type ReactNode } from 'react';
import L from 'leaflet';
import { Circle, CircleMarker, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import type { AirportInfo } from '../data/airports';
import { ATS_AIRWAYS, ATZ_RADIUS_NM, TMA_CRAIOVA_POLYGON, type FirEntry } from '../data/airspace';
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
import { TrafficRendererContext, destination, trackBearingDegSafe, useHeldWhileZooming, useTrafficRenderer } from './mapHelpers';
import { distanceNm } from '../sim/geomath';
import { positionAt, trailUntil } from '../sim/interpolate';
import type { FlightView } from '../sim/traffic';
import { M_PER_NM, altitudeBand, altitudeLabel, clockLabel, feetLabel, feetToMeters } from '../sim/units';
import { BASE_TIME_OFFSET_SECONDS, useApp, type MapViewPreset } from '../state/store';
import { STATUS_CLASS, STATUS_SHORT, isUnsequenced } from './flightStyle';
import { useLive } from '../state/live';

/** Funcție stabilă: un ref inline s-ar re-rula la fiecare randare. */
const hideLeafletPrefix = (map: L.Map | null) => void map?.attributionControl.setPrefix(false);

/** Licența CC BY-SA cere credit cât timp limitele FIR sunt pe hartă, cu sau fără harta OSM. */
const FIR_ATTRIBUTION = 'FIR: <a href="https://github.com/vatsimnetwork/vatspy-data-project">VATSpy</a> CC BY-SA 4.0';

/** Harta comună ambelor pagini; traficul (simulat sau real) vine ca copii. */
export function MapView({ runway, onBackgroundClick, children }: { runway: RunwayId | null; onBackgroundClick: () => void; children: ReactNode }) {
  const renderer = useMemo(() => L.svg({ padding: 0.75 }), []);
  const trafficRenderer = useMemo(() => L.svg({ padding: 0.75 }), []);

  return (
    <MapContainer
      bounds={MAP_BOUNDS_WIDE}
      renderer={renderer}
      className="map"
      zoomSnap={0}
      zoomDelta={0.5}
      scrollWheelZoom={false}
      minZoom={3}
      maxZoom={16}
      worldCopyJump
      attributionControl
      ref={hideLeafletPrefix}
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        className="basemap-osm"
        maxZoom={18}
      />
      <TrafficRendererContext.Provider value={trafficRenderer}>
        <ViewController />
        <BackgroundClick onClick={onBackgroundClick} />
        <AirspaceAndGridLayers />
        <StaticLayers runway={runway} />
        {children}
      </TrafficRendererContext.Provider>
    </MapContainer>
  );
}

/** Traficul simulat (pagina Demo): aeroporturi de origine + rute complete + aeronave 4D. */
export function SimTraffic() {
  const flights = useApp((s) => s.evaluation?.traffic.flights ?? null);
  const vp = useMapViewport();
  const origins = useMemo(() => {
    if (!flights) return [];
    const byIcao = new Map<string, AirportInfo>();
    for (const f of flights) {
      if (f.origin.icao !== 'LRCV') byIcao.set(f.origin.icao, f.origin);
    }
    return [...byIcao.values()];
  }, [flights]);

  if (!flights) return null;

  return (
    <>
      {origins
        .filter((apt) => vp.zoom >= NEAR_ORIGIN_MIN_ZOOM || distanceNm(apt, ARP) > NEAR_ORIGIN_NM)
        .map((apt) => (
          <CircleMarker
            key={`orig-${apt.icao}`}
            center={[apt.lat, apt.lon]}
            radius={4.5}
            pathOptions={{ className: 'origin-apt' }}
            interactive={false}
          >
            <Tooltip permanent interactive direction="top" className="lbl lbl--apt" offset={[0, -5]}>
              <span title={`${apt.name}, ${apt.city}`}>{apt.icao}</span>
            </Tooltip>
          </CircleMarker>
        ))}
      {flights.map((f) => (
        <AircraftMarker key={f.id} flight={f} />
      ))}
    </>
  );
}

function computeContinentalBounds(flights: FlightView[] | null): [[number, number], [number, number]] {
  if (!flights || flights.length === 0) {
    return [
      [38.5, -2.5],
      [53.5, 31.5],
    ];
  }
  let minLat = ARP.lat;
  let maxLat = ARP.lat;
  let minLon = ARP.lon;
  let maxLon = ARP.lon;
  for (const f of flights) {
    for (const [lat, lon] of f.fullRoute) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
  }
  const latPad = Math.max(1.5, (maxLat - minLat) * 0.14);
  const lonPad = Math.max(2.5, (maxLon - minLon) * 0.12);
  return [
    [Math.max(-75, minLat - latPad), Math.max(-175, minLon - lonPad)],
    [Math.min(82, maxLat + latPad), Math.min(175, maxLon + lonPad)],
  ];
}

function applyView(map: L.Map, view: MapViewPreset, flights: FlightView[] | null, animate: boolean) {
  if (view === 'continental') {
    map.fitBounds(computeContinentalBounds(flights), { animate, padding: [28, 28] });
  } else if (view === 'wide') {
    map.fitBounds(MAP_BOUNDS_WIDE, { animate });
  } else {
    map.setView([ARP.lat, ARP.lon], 12, { animate });
  }
}

function ViewController() {
  const map = useMap();
  const trafficRenderer = useTrafficRenderer();
  const view = useApp((s) => s.view);
  const viewNonce = useApp((s) => s.viewNonce);
  useEffect(() => {
    const flights = useApp.getState().evaluation?.traffic.flights ?? null;
    applyView(map, view, flights, true);
  }, [map, view, viewNonce]);

  // La redimensionarea ferestrei/panoului doar invalidăm dimensiunea containerului fără a reseta camera utilizatorului!
  useEffect(() => {
    let initialized = false;
    const ro = new ResizeObserver((entries) => {
      map.invalidateSize();
      const rect = entries[0]?.contentRect;
      if (!initialized && rect && rect.width > 0 && rect.height > 0) {
        initialized = true;
        const st = useApp.getState();
        applyView(map, st.view, st.evaluation?.traffic.flights ?? null, false);
      }
    });
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);

  // Zoom progresiv pe touchpad / rotiță în intervalul [minZoom=3, maxZoom=16].
  useEffect(() => {
    const m = map as L.Map & {
      _move(center: L.LatLng, zoom: number, data?: { pinch?: boolean; round?: boolean }): void;
      _moveStart(zoomChanged: boolean, noMoveStart: boolean): void;
      _moveEnd(zoomChanged: boolean): void;
      _stop(): void;
    };
    const el = map.getContainer();
    let target: number | null = null;
    let anchorPoint: L.Point | null = null;
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
      // În timpul zoom-ului Leaflet doar scalează imaginea SVG desenată la zoom-ul de start: la zoom out
      // liniile rămân strânse în zona veche, iar avioanele (markere) sunt deja la locul nou. Redesenăm des.
      type Redrawable = L.Renderer & { _map?: L.Map; _zoom: number; _reset(): void };
      const renderer = map.options.renderer as Redrawable | undefined;
      if (!done && renderer?._map && Math.abs(zoom - renderer._zoom) > REDRAW_EVERY_ZOOM) renderer._reset();
      // Liniile avioanelor la fiecare cadru: scalate ca imagine, grosimea și liniuțele lor ar sări la redesenare.
      const traffic = trafficRenderer as Redrawable | undefined;
      if (!done && traffic?._map) traffic._reset();
      if (done) {
        target = null;
        frame = 0;
        m._moveEnd(true);
      } else frame = requestAnimationFrame(step);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const speed = e.ctrlKey ? PINCH_ZOOM_PER_PX : WHEEL_ZOOM_PER_PX;
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
  }, [map, trafficRenderer]);
  return null;
}

const WHEEL_ZOOM_PER_PX = 0.0032;
const PINCH_ZOOM_PER_PX = 0.0065;
const ZOOM_EASING = 0.18;
/** Cât se depărtează zoom-ul de ultima redesenare a liniilor: sub ~1,3 (padding 0.75) zona desenată acoperă harta. */
const REDRAW_EVERY_ZOOM = 0.5;

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

interface ViewportState {
  zoom: number;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

function useMapViewport(): ViewportState {
  const map = useMap();
  const [vp, setVp] = useState<ViewportState>(() => {
    const b = map.getBounds();
    return {
      zoom: map.getZoom(),
      minLat: b.getSouth(),
      maxLat: b.getNorth(),
      minLon: b.getWest(),
      maxLon: b.getEast(),
    };
  });

  useEffect(() => {
    const update = () => {
      const b = map.getBounds();
      setVp({
        zoom: map.getZoom(),
        minLat: b.getSouth(),
        maxLat: b.getNorth(),
        minLon: b.getWest(),
        maxLon: b.getEast(),
      });
    };
    map.on('moveend', update);
    map.on('zoomend', update);
    return () => {
      map.off('moveend', update);
      map.off('zoomend', update);
    };
  }, [map]);

  return vp;
}

/** Grilă de orientare lat/lon + Sectoare FIR / ACC / TMA Craiova / Căi Aeriene ATS (Rank 2). */
function AirspaceAndGridLayers() {
  const vp = useMapViewport();
  const showSectors = useApp((s) => s.showSectors);
  const firs = useApp((s) => s.firs);
  const selectedId = useApp((s) => s.selectedId);
  const flights = useApp((s) => s.evaluation?.traffic.flights ?? null);

  const traversedSet = useMemo(() => {
    if (!selectedId || !flights) return new Set<string>();
    const sel = flights.find((f) => f.id === selectedId);
    return new Set(sel?.traversedFirs ?? []);
  }, [selectedId, flights]);

  const visibleFirs = useMemo(() => {
    if (!showSectors) return [];
    const padLat = 6;
    const padLon = 10;
    return firs.filter((f: FirEntry) => {
      if (f.kind === 'sector' && vp.zoom < 5.5) return false;
      const [bMinLat, bMinLon, bMaxLat, bMaxLon] = f.bbox;
      return !(
        bMaxLat < vp.minLat - padLat ||
        bMinLat > vp.maxLat + padLat ||
        bMaxLon < vp.minLon - padLon ||
        bMinLon > vp.maxLon + padLon
      );
    });
  }, [showSectors, firs, vp.minLat, vp.maxLat, vp.minLon, vp.maxLon, vp.zoom]);

  const graticule = useMemo(() => {
    if (vp.zoom > 9) return null;
    const step = vp.zoom < 4.5 ? 10 : vp.zoom < 6.8 ? 5 : 2;
    const latStart = Math.max(-70, Math.floor((vp.minLat - step) / step) * step);
    const latEnd = Math.min(80, Math.ceil((vp.maxLat + step) / step) * step);
    const lonStart = Math.max(-170, Math.floor((vp.minLon - step) / step) * step);
    const lonEnd = Math.min(170, Math.ceil((vp.maxLon + step) / step) * step);

    const parallels: { lat: number; line: [number, number][] }[] = [];
    for (let lat = latStart; lat <= latEnd; lat += step) {
      parallels.push({
        lat,
        line: [
          [lat, lonStart],
          [lat, lonEnd],
        ],
      });
    }
    const meridians: { lon: number; line: [number, number][] }[] = [];
    for (let lon = lonStart; lon <= lonEnd; lon += step) {
      meridians.push({
        lon,
        line: [
          [latStart, lon],
          [latEnd, lon],
        ],
      });
    }
    return { parallels, meridians };
  }, [vp.zoom, vp.minLat, vp.maxLat, vp.minLon, vp.maxLon]);

  return (
    <>
      {/* 1. Linii de orientare geografică (meridiane & paralele) când camera e depărtată */}
      {graticule &&
        graticule.parallels.map((p) => (
          <Polyline key={`lat-${p.lat}`} positions={p.line} pathOptions={{ className: 'nav-grid' }} interactive={false} />
        ))}
      {graticule &&
        graticule.meridians.map((m) => (
          <Polyline key={`lon-${m.lon}`} positions={m.line} pathOptions={{ className: 'nav-grid' }} interactive={false} />
        ))}

      {/* 2. Sectoare FIR / ACC (184 sectoare Europa–Asia + evidențiere LRBB și coridor zbor selectat) */}
      {showSectors &&
        visibleFirs.map((fir) => {
          const isRomania = fir.id === 'LRBB';
          const isTraversed = traversedSet.has(fir.id);
          const isSector = fir.kind === 'sector';
          const cls = [
            'fir-poly',
            isSector ? 'fir-poly--sector' : '',
            isRomania ? 'fir-poly--lrbb' : '',
            isTraversed ? 'fir-poly--active' : '',
          ]
            .filter(Boolean)
            .join(' ');
          const showLabel =
            (isRomania && vp.zoom <= 9.5) ||
            (isTraversed && vp.zoom <= 9.5) ||
            (!isSector && vp.zoom >= 4.2 && vp.zoom <= 8.8) ||
            (isSector && vp.zoom >= 6.2 && vp.zoom <= 9.2);

          return (
            <Polygon key={`fir-${fir.id}`} positions={fir.polygons} pathOptions={{ className: cls }} interactive={false} attribution={FIR_ATTRIBUTION}>
              {showLabel && (
                <Tooltip permanent interactive direction="center" className={`lbl lbl--fir ${isRomania || isTraversed ? 'lbl--fir-hi' : ''}`}>
                  <span title={fir.name}>{fir.id}</span>
                </Tooltip>
              )}
            </Polygon>
          );
        })}

      {/* 3. TMA Craiova (760 m – FL145 ≈ 4 420 m) + Căi aeriene ATS (L605, N133, M747, W85) */}
      {showSectors && vp.zoom >= 6.2 && (
        <Polygon positions={TMA_CRAIOVA_POLYGON} pathOptions={{ className: 'tma-poly' }} interactive={false} />
      )}
      {showSectors && vp.zoom >= 7.2 && vp.zoom <= 10.5 && (
        <CircleMarker center={TMA_LABEL_AT} radius={0} pathOptions={{ stroke: false }} interactive={false}>
          <Tooltip permanent interactive direction="bottom" className="lbl lbl--tma">
            <span title="Zona de control terminal Craiova: între 760 m și FL145 (≈ 4 420 m)">TMA CRAIOVA</span>
          </Tooltip>
        </CircleMarker>
      )}
      {showSectors &&
        vp.zoom >= 6.0 &&
        vp.zoom <= 11.5 &&
        ATS_AIRWAYS.map((aw) => (
          <Polyline key={aw.id} positions={aw.points} pathOptions={{ className: 'ats-airway' }} interactive={false}>
            {vp.zoom >= 7.0 && (
              <Tooltip permanent direction="center" className="lbl lbl--airway">
                {aw.id}
              </Tooltip>
            )}
          </Polyline>
        ))}
    </>
  );
}

const ring = (nm: number) => nm * M_PER_NM;
/** Aerodromurile de plecare mai aproape de atât de LRCV își arată eticheta doar de la zoom-ul acesta în sus. */
const NEAR_ORIGIN_NM = 25;
const NEAR_ORIGIN_MIN_ZOOM = 10;
/** Mijlocul marginii de nord a TMA Craiova, unde stă eticheta. */
const TMA_LABEL_AT: [number, number] = [44.75, 23.635];

function StaticLayers({ runway }: { runway: RunwayId | null }) {
  const vp = useMapViewport();
  const showSectors = useApp((s) => s.showSectors);
  const isLive = useLive((s) => s.vfrTracking !== null);
  const livePoints = useLive((s) => s.vfrTracking?.points ?? null);
  const routes = useMemo(() => (runway ? allArrivalRoutes(runway) : []), [runway]);
  const join = runway ? vfrFinalJoin(runway) : null;
  const showTerminalLabels = vp.zoom >= 8.8;

  return (
    <>
      <Circle center={[ARP.lat, ARP.lon]} radius={ring(CTR_RADIUS_NM)} pathOptions={{ className: 'ctr', fill: false }} interactive={false} />
      {showSectors && (
        <Circle center={[ARP.lat, ARP.lon]} radius={ring(ATZ_RADIUS_NM)} pathOptions={{ className: 'atz', fill: false }} interactive={false} />
      )}
      {vp.zoom >= 8.0 &&
        [5, 10, 15].map((nm) => (
          <Circle key={nm} center={[ARP.lat, ARP.lon]} radius={ring(nm)} pathOptions={{ className: 'range-ring', fill: false }} interactive={false} />
        ))}
      {showTerminalLabels &&
        [5, 10, 15, CTR_RADIUS_NM].map((nm) => {
          const p = destination(ARP, 135, nm);
          return (
            <CircleMarker key={`lbl-${nm}`} center={[p.lat, p.lon]} radius={0} pathOptions={{ stroke: false }} interactive={false}>
              <Tooltip permanent direction="center" className="lbl lbl--ring">
                {nm === CTR_RADIUS_NM ? `CTR ${nm} NM` : `${nm} NM`}
              </Tooltip>
            </CircleMarker>
          );
        })}

      {/* Pin LRCV vizibil clar la zoom continental/regional */}
      {!showTerminalLabels && (
        <CircleMarker center={[ARP.lat, ARP.lon]} radius={5} pathOptions={{ className: 'hub-apt' }} interactive={false}>
          <Tooltip permanent interactive direction="right" className="lbl lbl--hub" offset={[6, 0]}>
            <span title="Aeroportul Internațional Craiova">LRCV</span>
          </Tooltip>
        </CircleMarker>
      )}

      {routes.map((r) => (
        <Polyline key={r.iaf} positions={r.points} pathOptions={{ className: 'route' }} interactive={false} />
      ))}
      <Polyline positions={RUNWAY_LINE} pathOptions={{ className: 'runway' }} interactive={false} />
      {showTerminalLabels &&
        (['08', '26'] as RunwayId[]).map((r) => {
          const t = threshold(r);
          return (
            <CircleMarker key={r} center={[t.lat, t.lon]} radius={2} pathOptions={{ className: r === runway ? 'thr thr--active' : 'thr' }} interactive={false}>
              <Tooltip permanent direction={r === '08' ? 'left' : 'right'} className="lbl lbl--rwy" offset={[r === '08' ? -4 : 4, 0]}>
                {r}
              </Tooltip>
            </CircleMarker>
          );
        })}
      {showTerminalLabels &&
        Object.values(WAYPOINTS)
          .filter((w) => w.role === 'IAF' || w.role.startsWith('IF') || w.role.startsWith('FAF'))
          .map((w) => (
            <CircleMarker key={w.id} center={[w.lat, w.lon]} radius={3} pathOptions={{ className: `wpt ${w.role === 'IAF' ? 'wpt--iaf' : ''}` }} interactive={false}>
              <Tooltip permanent direction="top" className="lbl" offset={[0, -3]}>
                {w.id}
              </Tooltip>
            </CircleMarker>
          ))}
      {showTerminalLabels &&
        NAVAIDS.map((n) => (
          <CircleMarker key={n.id} center={[n.lat, n.lon]} radius={4} pathOptions={{ className: 'navaid' }} interactive={false}>
            <Tooltip permanent direction="bottom" className="lbl" offset={[0, 4]}>
              {n.id}
            </Tooltip>
          </CircleMarker>
        ))}
      {showTerminalLabels &&
        (isLive && livePoints
          ? livePoints.map((p) => ({ id: p.code, lat: p.lat, lon: p.long, role: 'Punct raportare VFR (sintetic)', synthetic: true }))
          : [...VFR_ENTRY_POINTS, ...(join ? [join] : [])]
        ).map((p) => (
          <CircleMarker key={p.id} center={[p.lat, p.lon]} radius={3} pathOptions={{ className: 'wpt wpt--synthetic' }} interactive={false}>
            <Tooltip permanent direction="top" className="lbl lbl--synthetic" offset={[0, -3]}>
              {p.id}*
            </Tooltip>
          </CircleMarker>
        ))}
      {showTerminalLabels && (
        <CircleMarker center={[LRCW.lat, LRCW.lon]} radius={3} pathOptions={{ className: 'wpt wpt--alt' }} interactive={false}>
          <Tooltip permanent direction="left" className="lbl" offset={[-4, 0]}>
            LRCW
          </Tooltip>
        </CircleMarker>
      )}
    </>
  );
}

export const GLYPH_IFR = '<path d="M12 2 L19 20 L12 16 L5 20 Z"/>';
const GLYPH_VFR = '<path d="M12 4 L17 18 L12 15 L7 18 Z"/><circle cx="12" cy="12" r="10" fill="none" stroke-width="1.5"/>';

function resolveFlightVisualState(flight: FlightView, t: number) {
  const track = flight.track;
  const first = track[0];
  const last = track[track.length - 1];
  const preTakeoff = !!first && t < first.timeSeconds;
  const done = !!last && t > last.timeSeconds;

  const pos = preTakeoff
    ? {
        lat: first.latitudeDeg,
        lon: first.longitudeDeg,
        altitudeMeters: feetToMeters(flight.origin.elevationFt),
        headingDeg: track.length > 1 ? trackBearingDegSafe(first, track[1]) : 0,
      }
    : done
      ? { lat: last.latitudeDeg, lon: last.longitudeDeg, altitudeMeters: last.altitudeMeters, headingDeg: null }
      : positionAt(track, t);

  const heading = Math.round(pos?.headingDeg ?? (track.length > 1 ? trackBearingDegSafe(track[track.length - 2], last) : 0));
  const band = altitudeBand(pos?.altitudeMeters ?? null);
  return { pos, preTakeoff, done, heading, band, lastTime: last?.timeSeconds ?? t };
}

function AircraftMarker({ flight }: { flight: FlightView }) {
  const t = useHeldWhileZooming(useApp((s) => s.simTimeSeconds));
  const selected = useApp((s) => s.selectedId === flight.id);
  const showAllRoutes = useApp((s) => s.showAllRoutes);
  const select = useApp((s) => s.select);

  const { pos, preTakeoff, done, heading, band, lastTime } = resolveFlightVisualState(flight, t);
  if (!pos) return null;

  return (
    <AircraftMarkerView
      flight={flight}
      t={t}
      pos={pos}
      preTakeoff={preTakeoff}
      done={done}
      heading={heading}
      band={band}
      lastTime={lastTime}
      selected={selected}
      showAllRoutes={showAllRoutes}
      onSelect={select}
    />
  );
}

function AircraftMarkerView({
  flight,
  t,
  pos,
  preTakeoff,
  done,
  heading,
  band,
  lastTime,
  selected,
  showAllRoutes,
  onSelect,
}: {
  flight: FlightView;
  t: number;
  pos: { lat: number; lon: number; altitudeMeters: number };
  preTakeoff: boolean;
  done: boolean;
  heading: number;
  band: string;
  lastTime: number;
  selected: boolean;
  showAllRoutes: boolean;
  onSelect: (id: string) => void;
}) {
  const rules = flight.aircraft.flightRules.toLowerCase();
  const statusClass = STATUS_CLASS[flight.status];
  const trafficRenderer = useTrafficRenderer();
  const dimmed = done || preTakeoff;

  const icon = useMemo(
    () =>
      L.divIcon({
        className: '',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        html: `<div class="ac ac--${rules} ${statusClass} ${selected ? 'ac--selected' : ''} ${dimmed ? 'ac--done' : ''}"><svg viewBox="0 0 24 24" class="ac__glyph" style="transform:rotate(${heading}deg)">${rules === 'ifr' ? GLYPH_IFR : GLYPH_VFR}</svg></div>`,
      }),
    [rules, statusClass, selected, dimmed, heading],
  );

  const trail = useMemo(() => (preTakeoff ? [] : trailUntil(flight.track, Math.min(t, lastTime))), [flight.track, t, preTakeoff, lastTime]);

  const tag = preTakeoff
    ? `DECOLARE ${flight.origin.icao} ${clockLabel(BASE_TIME_OFFSET_SECONDS + flight.takeoffSeconds, false)}`
    : done
      ? flight.alternate
        ? `LA ${flight.alternate.code === 'LRBV' ? 'LRCW' : flight.alternate.code}`
        : `ATERIZAT ${clockLabel(BASE_TIME_OFFSET_SECONDS + (flight.landingSeconds ?? lastTime), false)}`
      : flight.status === 'ClearedForApproach'
        ? flight.slot
          ? `SLOT ${clockLabel(BASE_TIME_OFFSET_SECONDS + flight.slot.calculatedTimeSeconds, false)}`
          : 'FĂRĂ SLOT'
        : STATUS_SHORT[flight.status];

  return (
    <>
      {/* Traiectoria completă Decolare → Aterizare pentru fiecare avion */}
      {(showAllRoutes || selected) && (
        <Polyline
          renderer={trafficRenderer}
          positions={flight.fullRoute}
          pathOptions={{ className: selected ? 'planned planned--selected' : `full-route full-route--${rules}` }}
          interactive={false}
        />
      )}
      {trail.length > 1 && <Polyline renderer={trafficRenderer} positions={trail} pathOptions={{ className: `trail trail--${rules}` }} interactive={false} />}
      {selected && flight.todPoint && (
        <CircleMarker
          renderer={trafficRenderer}
          center={[flight.todPoint.lat, flight.todPoint.lon]}
          radius={4}
          pathOptions={{ className: 'tod-marker' }}
          interactive={false}
        >
          <Tooltip permanent direction="top" className="lbl lbl--tod" offset={[0, -5]}>
            TOD · {feetLabel(flight.todPoint.altitudeFt)} ({flight.todPoint.distanceToLandingNm} NM)
          </Tooltip>
        </CircleMarker>
      )}
      <Marker
        position={[pos.lat, pos.lon]}
        icon={icon}
        keyboard
        title={`${flight.callsign} (${flight.origin.icao} → LRCV)`}
        eventHandlers={{
          click: (e) => {
            L.DomEvent.stopPropagation(e);
            onSelect(flight.id);
          },
        }}
      >
        <Tooltip
          key={`${dimmed && !selected ? 'hover' : 'permanent'}-${selected}`}
          permanent={!dimmed || selected}
          direction="right"
          offset={[12, 0]}
          className={`datablock ${selected ? 'datablock--selected' : ''}`}
        >
          <span className="db-callsign">{flight.callsign}</span> <span className="db-orig">{flight.origin.icao}→LRCV</span>
          <br />
          <span className={`db-alt ${band}`}>{altitudeLabel(pos.altitudeMeters)}</span> {flight.aircraft.flightRules}
          <br />
          <span className={isUnsequenced(flight) ? 'db-noslot' : ''}>{tag}</span>
        </Tooltip>
      </Marker>
    </>
  );
}
