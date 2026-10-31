// Avioanele reale (OpenSky) pe hartă. Între două interogări le avansăm pe direcția și viteza raportate.
import { useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import { Marker, Tooltip } from 'react-leaflet';
import type { LiveFlight } from '../contracts/live';
import { extrapolate, trendArrow } from '../sim/live';
import { altitudeBand, altitudeLabel } from '../sim/units';
import { useLive } from '../state/live';
import { GLYPH_IFR } from './MapView';

/** Peste atâtea secunde fără contact, avionul apare estompat (date vechi). */
const STALE_SECONDS = 60;

export function LiveTraffic() {
  const flights = useLive((s) => s.positions?.flights ?? null);
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);
  return flights?.filter((f) => !f.onGround).map((f) => <LiveMarker key={f.icao24} flight={f} now={now} />);
}

function LiveMarker({ flight, now }: { flight: LiveFlight; now: number }) {
  const selected = useLive((s) => s.selectedIcao === flight.icao24);
  const select = useLive((s) => s.select);
  const pos = extrapolate(flight, now);
  const stale = now - flight.lastContact > STALE_SECONDS;
  const heading = Math.round(flight.trueTrackDegrees ?? 0);
  const band = altitudeBand(flight.baroAltitudeMeters); // culoarea după altitudine

  const icon = useMemo(
    () =>
      L.divIcon({
        className: '',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        html: `<div class="ac ac--live ${band} ${selected ? 'ac--selected' : ''} ${stale ? 'ac--done' : ''}"><svg viewBox="0 0 24 24" class="ac__glyph" style="transform:rotate(${heading}deg)">${GLYPH_IFR}</svg></div>`,
      }),
    [band, selected, stale, heading],
  );
  if (!pos) return null;

  return (
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
        {flight.velocityKnots != null ? `${Math.round(flight.velocityKnots)} kt` : ''}
      </Tooltip>
    </Marker>
  );
}
