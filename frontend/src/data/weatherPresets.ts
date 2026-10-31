import type { WeatherCondition } from '../contracts/backend';

export interface WeatherPreset {
  id: string;
  label: string;
  weather: WeatherCondition;
}

// Preseturi de simulare (inventate), nu observații reale.
export const WEATHER_PRESETS: WeatherPreset[] = [
  { id: 'calm', label: 'Calm, 090° 6 kt', weather: { windDirectionDegrees: 90, windSpeedKnots: 6, windGustKnots: 8, visibilityMeters: 9999 } },
  { id: 'west', label: 'Vânt de vest, 260° 15 kt', weather: { windDirectionDegrees: 260, windSpeedKnots: 15, windGustKnots: 18, visibilityMeters: 9999 } },
  { id: 'cross-moderate', label: 'Vânt lateral, 200° 12 kt', weather: { windDirectionDegrees: 200, windSpeedKnots: 12, windGustKnots: 14, visibilityMeters: 9999 } },
  { id: 'cross-critical', label: 'Vânt lateral puternic, 180° 22 kt cu rafale 26', weather: { windDirectionDegrees: 180, windSpeedKnots: 22, windGustKnots: 26, visibilityMeters: 9999 } },
];

export const DEFAULT_PRESET_ID = 'calm';
