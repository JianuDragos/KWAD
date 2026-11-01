// Modul paginii stă în adresă (#/live, #/assistant sau #/demo): se poate deschide direct și rămâne la refresh.
import { useSyncExternalStore } from 'react';

export type Mode = 'live' | 'assistant' | 'demo';

/** Modul curent, citit direct (pentru cod din afara componentelor, ca tastele rapide). */
export const currentMode = (): Mode => {
  if (window.location.hash === '#/demo') return 'demo';
  if (window.location.hash === '#/assistant') return 'assistant';
  return 'live';
};

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function useMode(): Mode {
  return useSyncExternalStore(subscribe, currentMode);
}

export function setMode(mode: Mode) {
  window.location.hash = `/${mode}`;
}
