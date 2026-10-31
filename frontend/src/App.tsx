import { useEffect } from 'react';
import { DetailsPanel } from './components/DetailsPanel';
import { MapView } from './components/MapView';
import { Timeline } from './components/Timeline';
import { TopBar } from './components/TopBar';
import { useApp } from './state/store';

export default function App() {
  const view = useApp((s) => s.view);
  const basemap = useApp((s) => s.basemap);
  const { setView, setBasemap } = useApp.getState();

  useEffect(() => {
    void useApp.getState().load();
  }, []);

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
        if (target.closest('button, a[href], [role="button"]')) return;
        e.preventDefault();
        if (s.evaluation) s.togglePlay();
      } else if (e.key === 'Escape') s.select(null);
      else if (e.key === '1') s.setView('wide');
      else if (e.key === '2') s.setView('close');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <TopBar />
      <main className="map-area">
        <MapView />
        <div className="map-banner">SIMULARE · nu pentru uz operațional · poziții sintetice pe trasee AIP (AIRAC 2026-10-01)</div>
        <div className="map-controls" role="group" aria-label="Vedere hartă">
          <button className={`btn btn--seg ${view === 'wide' ? 'is-on' : ''}`} onClick={() => setView('wide')} title="Tasta 1">
            Larg
          </button>
          <button className={`btn btn--seg ${view === 'close' ? 'is-on' : ''}`} onClick={() => setView('close')} title="Tasta 2">
            Apropiat
          </button>
          <button
            className={`btn btn--seg ${basemap === 'osm' ? 'is-on' : ''}`}
            onClick={() => setBasemap(basemap === 'osm' ? 'none' : 'osm')}
            title="Fundal OpenStreetMap (necesită internet)"
          >
            Hartă OSM
          </button>
        </div>
      </main>
      <DetailsPanel />
      <Timeline />
    </div>
  );
}
