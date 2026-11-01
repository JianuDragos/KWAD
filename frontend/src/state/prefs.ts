// Preferințele de afișare (unități, comutatoarele din Setări), ținute minte în browser între refresh-uri.
// Dacă stocarea e blocată (mod privat, teste în Node) se folosește valoarea implicită și alegerea ține până la refresh.

export function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* alegerea rămâne doar până la refresh */
  }
}

export const readFlag = (key: string, fallback: boolean) => readPref(key, ['on', 'off'], fallback ? 'on' : 'off') === 'on';
export const writeFlag = (key: string, on: boolean) => writePref(key, on ? 'on' : 'off');
