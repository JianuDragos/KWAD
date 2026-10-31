import type { WeatherCondition } from '../contracts/backend';

export interface WeatherPreset {
  id: string;
  label: string;
  weather: WeatherCondition;
}

// Preseturi de simulare (inventate), nu observații reale.
export const WEATHER_PRESETS: WeatherPreset[] = [
  { id: 'calm', label: 'Calm', weather: { windDirectionDegrees: 90, windSpeedKnots: 6, windGustKnots: 8, visibilityMeters: 9999 } },
  { id: 'west', label: 'Vânt de vest', weather: { windDirectionDegrees: 260, windSpeedKnots: 15, windGustKnots: 18, visibilityMeters: 9999 } },
  { id: 'cross-moderate', label: 'Vânt lateral', weather: { windDirectionDegrees: 200, windSpeedKnots: 12, windGustKnots: 14, visibilityMeters: 9999 } },
  { id: 'cross-critical', label: 'Vânt lateral puternic', weather: { windDirectionDegrees: 180, windSpeedKnots: 22, windGustKnots: 26, visibilityMeters: 9999 } },
];

export const DEFAULT_PRESET_ID = 'calm';

/** Eticheta din listă, cu vântul în unitatea aleasă; rafalele apar doar când diferă vizibil (4 kt sau mai mult). */
export function presetLabel(p: WeatherPreset, speed: (knots: number) => string): string {
  const w = p.weather;
  const gust = w.windGustKnots - w.windSpeedKnots >= 4 ? ` cu rafale ${speed(w.windGustKnots)}` : '';
  return `${p.label}, ${String(w.windDirectionDegrees).padStart(3, '0')}° ${speed(w.windSpeedKnots)}${gust}`;
}
