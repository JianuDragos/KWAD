import { useEffect } from 'react';
import { AltitudeLegend } from './components/AltitudeLegend';
import { DetailsPanel } from './components/DetailsPanel';
import { LivePanel } from './components/LivePanel';
import { LiveTraffic } from './components/LiveTraffic';
import { MapView, SimTraffic } from './components/MapView';
import { Timeline } from './components/Timeline';
import { TopBar } from './components/TopBar';
import { runwayForWind } from './sim/live';
import { useLive } from './state/live';
import { currentMode, useMode } from './state/mode';
import { useApp } from './state/store';

export default function App() {
  const view = useApp((s) => s.view);
  const basemap = useApp((s) => s.basemap);
  const { setView, setBasemap } = useApp.getState();

  const mode = useMode();
  const simRunway = useApp((s) => s.evaluation?.traffic.runway ?? null);
  const metar = useLive((s) => s.metar);
  const liveRunway = metar ? runwayForWind(metar.windDirectionDegrees, metar.windSpeedKnots) : null;

  useEffect(() => {
    void useApp.getState().load();
  }, []);

  // Datele reale se cer doar cât e deschisă pagina Live (cota OpenSky e mică).
  useEffect(() => (mode === 'live' ? useLive.getState().start() : undefined), [mode]);

  // O singură buclă de ceas pentru toată aplicația.
  useEffect(() => {
    let last = performance.now();
    let id = requestAnimationFrame(function loop(now) {
      const dt = Math.min((now - last) / 1000, 0.25); // după un tab inactiv nu sărim minute
      last = now;
      useApp.getState().tick(dt);
      id = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('select, input, textarea')) return;
      const s = useApp.getState();
      if (e.code === 'Space') {
        // Pe un buton focusat, Space trebuie să apese butonul, nu să pornească redarea.
        if (target.closest('button, a[href], [role="button"]') || currentMode() !== 'demo') return;
        e.preventDefault();
        if (s.evaluation) s.togglePlay();
      } else if (e.key === 'Escape') {
        s.select(null);
        useLive.getState().select(null);
      }
      else if (e.key === '1') s.setView('wide');
      else if (e.key === '2') s.setView('close');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app app--${mode}`}>
      <TopBar mode={mode} />
      <main className="map-area">
        {mode === 'demo' ? (
          <MapView runway={simRunway} onBackgroundClick={() => useApp.getState().select(null)}>
            <SimTraffic />
          </MapView>
        ) : (
          <MapView runway={liveRunway} onBackgroundClick={() => useLive.getState().select(null)}>
            <LiveTraffic />
          </MapView>
        )}
        <AltitudeLegend />
        {mode === 'demo' && (
          <p className="map-banner">Simulare, nu pentru uz operațional. Poziții sintetice pe traseele AIP în vigoare de la 1 octombrie 2026.</p>
        )}
        <div className="map-controls">
          <div className="seg" role="group" aria-label="Vedere hartă">
            <button className={`seg__btn ${view === 'wide' ? 'is-on' : ''}`} onClick={() => setView('wide')} aria-pressed={view === 'wide'} aria-keyshortcuts="1">
              Larg
            </button>
            <button className={`seg__btn ${view === 'close' ? 'is-on' : ''}`} onClick={() => setView('close')} aria-pressed={view === 'close'} aria-keyshortcuts="2">
              Apropiat
            </button>
          </div>
          <button
            className={`seg__btn seg__btn--solo ${basemap === 'osm' ? 'is-on' : ''}`}
            onClick={() => setBasemap(basemap === 'osm' ? 'none' : 'osm')}
            aria-pressed={basemap === 'osm'}
            title="Fundal OpenStreetMap (necesită internet)"
          >
            Hartă geografică
          </button>
        </div>
      </main>
      {mode === 'demo' ? (
        <>
          <DetailsPanel />
          <Timeline />
        </>
      ) : (
        <LivePanel />
      )}
    </div>
  );
}
