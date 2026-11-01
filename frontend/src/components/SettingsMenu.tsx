// Setările de afișare, strânse sub o roată în bara de sus: se schimbă rar, deci nu ocupă loc pe hartă sau în bară.
import { useEffect, useRef, useState } from 'react';
import { HINT } from '../data/glossary';
import { DISTANCE_UNIT_LABEL, SPEED_UNIT_LABEL } from '../sim/units';
import { useLive } from '../state/live';
import type { Mode } from '../state/mode';
import { useApp } from '../state/store';
import { useUnits } from '../state/units';

export function SettingsMenu({ mode }: { mode: Mode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="settings" ref={root}>
      <button
        type="button"
        className={`settings__btn ${open ? 'is-on' : ''}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Setări"
      >
        {/* Iconița „settings” din Feather Icons (licență MIT). */}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open && (
        <div className="settings__panel" role="dialog" aria-label="Setări de afișare">
          <SpeedUnitRow />
          <DistanceUnitRow />
          {mode !== 'assistant' && <MapRows mode={mode} />}
        </div>
      )}
    </div>
  );
}

function SpeedUnitRow() {
  const unit = useUnits((s) => s.speed);
  const setSpeed = useUnits((s) => s.setSpeed);
  return (
    <div className="settings__row">
      <span className="settings__label" title={HINT.SPEED_UNIT}>
        Viteză
      </span>
      <div className="seg" role="group" aria-label="Unitatea vitezei">
        {(['kt', 'kmh'] as const).map((u) => (
          <button key={u} className={`seg__btn ${unit === u ? 'is-on' : ''}`} onClick={() => setSpeed(u)} aria-pressed={unit === u}>
            {SPEED_UNIT_LABEL[u]}
          </button>
        ))}
      </div>
    </div>
  );
}

function DistanceUnitRow() {
  const unit = useUnits((s) => s.distance);
  const setDistance = useUnits((s) => s.setDistance);
  return (
    <div className="settings__row">
      <span className="settings__label" title="Distanța avioanelor față de aeroport și lungimile rutelor: mile marine (1 NM = 1,852 km) sau kilometri.">
        Distanță
      </span>
      <div className="seg" role="group" aria-label="Unitatea distanței">
        {(['nm', 'km'] as const).map((u) => (
          <button key={u} className={`seg__btn ${unit === u ? 'is-on' : ''}`} onClick={() => setDistance(u)} aria-pressed={unit === u}>
            {DISTANCE_UNIT_LABEL[u]}
          </button>
        ))}
      </div>
    </div>
  );
}

function MapRows({ mode }: { mode: Mode }) {
  const showSectors = useApp((s) => s.showSectors);
  const showLegend = useApp((s) => s.showAltitudeLegend);
  const demoRoutes = useApp((s) => s.showAllRoutes);
  const liveRoutes = useLive((s) => s.showRoutes);
  const { setShowSectors, setShowAllRoutes, setShowAltitudeLegend } = useApp.getState();
  const isLive = mode === 'live';
  return (
    <>
      <Toggle
        label="Sectoare FIR"
        hint="Limitele FIR, TMA Craiova și căile aeriene"
        on={showSectors}
        onChange={setShowSectors}
      />
      <Toggle
        label={isLive ? 'Direcții estimate' : 'Rute complete'}
        hint={isLive ? 'Unde ajunge fiecare avion în 5 minute, pe direcția actuală' : 'Traseul complet de la decolare la aterizare pentru fiecare avion'}
        on={isLive ? liveRoutes : demoRoutes}
        onChange={isLive ? useLive.getState().setShowRoutes : setShowAllRoutes}
      />
      <Toggle label="Legendă altitudine" hint="Culorile altitudinii din eticheta fiecărui avion" on={showLegend} onChange={setShowAltitudeLegend} />
    </>
  );
}

function Toggle({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className="settings__row settings__toggle" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span className="settings__text">
        <span className="settings__label">{label}</span>
        <span className="settings__hint">{hint}</span>
      </span>
      <span className={`switch ${on ? 'is-on' : ''}`} aria-hidden="true" />
    </button>
  );
}
