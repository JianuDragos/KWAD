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
  const showSectors = useApp((s) => s.showSectors);
  const showAllRoutes = useApp((s) => s.showAllRoutes);
  const { setView, setShowSectors, setShowAllRoutes } = useApp.getState();

  const mode = useMode();
  const simRunway = useApp((s) => s.evaluation?.traffic.runway ?? null);
  const metar = useLive((s) => s.metar);
  const liveRunway = metar ? runwayForWind(metar.windDirectionDegrees, metar.windSpeedKnots) : null;

  useEffect(() => {
    void useApp.getState().load();
  }, []);

  // Datele reale se cer doar cât e deschisă pagina Live (cache partajat 15s + protecție cotă OpenSky).
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
        if (target.closest('button, a[href], [role="button"]') || currentMode() !== 'demo') return;
        e.preventDefault();
        if (s.evaluation) s.togglePlay();
      } else if (e.key === 'Escape') {
        s.select(null);
        useLive.getState().select(null);
      } else if (e.key === '0') s.setView('continental');
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
        <div className="map-controls">
          <div className="seg" role="group" aria-label="Vedere hartă">
            <button
              className={`seg__btn ${view === 'continental' ? 'is-on' : ''}`}
              onClick={() => setView('continental')}
              aria-pressed={view === 'continental'}
              aria-keyshortcuts="0"
              title="Încadrează toate aeroporturile de decolare și rutele complete (tasta 0)"
            >
              Continental
            </button>
            <button
              className={`seg__btn ${view === 'wide' ? 'is-on' : ''}`}
              onClick={() => setView('wide')}
              aria-pressed={view === 'wide'}
              aria-keyshortcuts="1"
              title="Zona terminală TMA/CTR Craiova (tasta 1)"
            >
              Larg
            </button>
            <button
              className={`seg__btn ${view === 'close' ? 'is-on' : ''}`}
              onClick={() => setView('close')}
              aria-pressed={view === 'close'}
              aria-keyshortcuts="2"
              title="Pragul pistei LRCV 08/26 (tasta 2)"
            >
              Apropiat
            </button>
          </div>
          <button
            className={`seg__btn seg__btn--solo ${showSectors ? 'is-on' : ''}`}
            onClick={() => setShowSectors(!showSectors)}
            aria-pressed={showSectors}
            title="Afișează sectoarele FIR (LRBB + Europa/Asia), TMA Craiova și căile aeriene ATS"
          >
            Sectoare FIR
          </button>
          <button
            className={`seg__btn seg__btn--solo ${showAllRoutes ? 'is-on' : ''}`}
            onClick={() => setShowAllRoutes(!showAllRoutes)}
            aria-pressed={showAllRoutes}
            title="Afișează traiectoria completă Decolare → Aterizare pentru fiecare aeronavă"
          >
            Rute complete
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
