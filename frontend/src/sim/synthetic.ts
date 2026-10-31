// Traiectorii sintetice pe trasee AIP reale. Doar afișare: timpul de sosire vine din backend,
// aici doar desenăm cum ajunge avionul la acel timp. Toate punctele sunt marcate „synthetic”.
import { bearingDeg, destination, distanceNm, type LatLon } from './geomath';
import type { TrackPoint } from './interpolate';
import { feetToMeters } from './units';

export type PlannedFix = LatLon & { id: string; altitudeFt: number };

/** Leg i = de la fixes[i] la fixes[i+1]; speedsKt are lungimea fixes.length - 1. */
export function trackArrivingAt(fixes: PlannedFix[], speedsKt: number[], arrivalSeconds: number): TrackPoint[] {
  if (fixes.length === 0) return [];
  if (speedsKt.length !== fixes.length - 1) throw new Error('Câte o viteză pentru fiecare segment');
  const offsets = [0];
  for (let i = 1; i < fixes.length; i++) {
    const legSeconds = (distanceNm(fixes[i - 1], fixes[i]) / speedsKt[i - 1]) * 3600;
    offsets.push(offsets[i - 1] + legSeconds);
  }
  const shift = arrivalSeconds - offsets[offsets.length - 1];
  return fixes.map((f, i) => point(offsets[i] + shift, f, f.altitudeFt));
}

/** Continuă un track cu un segment până la `to`, la viteza dată. */
export function appendLeg(track: TrackPoint[], to: LatLon, altitudeFt: number, speedKt: number): TrackPoint[] {
  const last = track[track.length - 1];
  const from = { lat: last.latitudeDeg, lon: last.longitudeDeg };
  const seconds = (distanceNm(from, to) / speedKt) * 3600;
  return [...track, point(last.timeSeconds + seconds, to, altitudeFt)];
}

/** Ture de așteptare circulare în jurul unui centru, în sensul acelor de ceasornic, până la untilSeconds. */
export function appendOrbit(
  track: TrackPoint[],
  center: LatLon,
  radiusNm: number,
  altitudeFt: number,
  speedKt: number,
  untilSeconds: number,
): TrackPoint[] {
  const out = [...track];
  const last = out[out.length - 1];
  const steps = 16;
  const stepSeconds = ((2 * Math.PI * radiusNm) / steps / speedKt) * 3600;
  let angle = bearingDeg(center, { lat: last.latitudeDeg, lon: last.longitudeDeg });
  let t = last.timeSeconds;
  // intrarea în cerc
  const entry = destination(center, angle, radiusNm);
  t += (distanceNm({ lat: last.latitudeDeg, lon: last.longitudeDeg }, entry) / speedKt) * 3600;
  out.push(point(t, entry, altitudeFt));
  while (t < untilSeconds) {
    angle = (angle + 360 / steps) % 360;
    t += stepSeconds;
    out.push(point(t, destination(center, angle, radiusNm), altitudeFt));
  }
  return out;
}

/**
 * Circuit standard de așteptare de tip hipodrom (ICAO Racetrack Holding Pattern).
 * Înlocuiește cercurile arbitrare prin traseu realist: Fix -> Viraj 180° -> Outbound -> Viraj 180° -> Inbound spre Fix.
 */
export function appendRacetrack(
  track: TrackPoint[],
  fix: LatLon,
  inboundBearingDeg: number,
  turnDirection: 'Right' | 'Left',
  altitudeFt: number,
  speedKt: number,
  untilSeconds: number,
  legDurationSeconds: number = 60,
): TrackPoint[] {
  const out = [...track];
  const last = out[out.length - 1];
  let t = last.timeSeconds;

  // Segment de zbor de la poziția curentă până la Holding Fix
  const distToFix = distanceNm({ lat: last.latitudeDeg, lon: last.longitudeDeg }, fix);
  if (distToFix > 0.1) {
    t += (distToFix / speedKt) * 3600;
    out.push(point(t, fix, altitudeFt));
  }

  const isRight = turnDirection !== 'Left';
  const speedNmPerSec = speedKt / 3600;
  // Raza virajului de rată 1: R = V / (60 * pi)
  const turnRadiusNm = Math.max(0.4, speedKt / (60 * Math.PI));
  const outboundLegDist = speedNmPerSec * legDurationSeconds;
  const inboundCourse = (inboundBearingDeg % 360 + 360) % 360;
  const outboundCourse = (inboundCourse + 180) % 360;

  const turn1CenterBearing = isRight ? (inboundCourse + 90) % 360 : (inboundCourse - 90 + 360) % 360;
  const turn1Center = destination(fix, turn1CenterBearing, turnRadiusNm);

  const turnSideBearing = turn1CenterBearing;
  const outboundStart = destination(fix, turnSideBearing, 2 * turnRadiusNm);
  const outboundEnd = destination(outboundStart, outboundCourse, outboundLegDist);

  const turn2CenterBearing = isRight ? (outboundCourse + 90) % 360 : (outboundCourse - 90 + 360) % 360;
  const turn2Center = destination(outboundEnd, turn2CenterBearing, turnRadiusNm);

  const inboundStart = destination(fix, outboundCourse, outboundLegDist);

  const turnSteps = 8;
  const turnDurationSeconds = 60;
  const stepTurnSec = turnDurationSeconds / turnSteps;

  while (t < untilSeconds) {
    // 1. Viraj 1 (180° de la inboundCourse la outboundCourse)
    for (let s = 1; s <= turnSteps; s++) {
      const frac = s / turnSteps;
      const sweep = frac * 180;
      const currentBearing = isRight
        ? (turn1CenterBearing + 180 + sweep) % 360
        : (turn1CenterBearing + 180 - sweep + 360) % 360;
      t += stepTurnSec;
      out.push(point(t, destination(turn1Center, currentBearing, turnRadiusNm), altitudeFt));
    }

    // 2. Ramură Outbound (drept înainte pe capul outboundCourse)
    const legSteps = 4;
    const stepLegSec = legDurationSeconds / legSteps;
    for (let s = 1; s <= legSteps; s++) {
      const frac = s / legSteps;
      t += stepLegSec;
      out.push(point(t, destination(outboundStart, outboundCourse, frac * outboundLegDist), altitudeFt));
    }

    // 3. Viraj 2 (180° de la outboundCourse înapoi la inboundCourse)
    for (let s = 1; s <= turnSteps; s++) {
      const frac = s / turnSteps;
      const sweep = frac * 180;
      const currentBearing = isRight
        ? (turn2CenterBearing + 180 + sweep) % 360
        : (turn2CenterBearing + 180 - sweep + 360) % 360;
      t += stepTurnSec;
      out.push(point(t, destination(turn2Center, currentBearing, turnRadiusNm), altitudeFt));
    }

    // 4. Ramură Inbound (drept înainte spre Fix)
    for (let s = 1; s <= legSteps; s++) {
      const frac = s / legSteps;
      t += stepLegSec;
      out.push(point(t, destination(inboundStart, inboundCourse, frac * outboundLegDist), altitudeFt));
    }
  }

  return out;
}

/** Punct „înainte de IAF”, pe prelungirea primului segment, ca avionul să fie vizibil înainte de intrare. */
export function inboundExtension(first: LatLon, second: LatLon, distNm: number): LatLon {
  return destination(first, (bearingDeg(first, second) + 180) % 360, distNm);
}

function point(timeSeconds: number, p: LatLon, altitudeFt: number): TrackPoint {
  return {
    timeSeconds,
    latitudeDeg: p.lat,
    longitudeDeg: p.lon,
    altitudeMeters: feetToMeters(altitudeFt),
    source: 'synthetic',
  };
}
