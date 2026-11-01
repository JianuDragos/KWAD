import { describe, expect, it } from 'vitest';
import type { CraiovaAircraft } from '../contracts/backend';
import { getAwaitingVfrFlights, type FlightView } from '../sim/traffic';
import { useAssistant } from './assistant';

describe('assistant & vfr approach recommendation', () => {
  it('gestionează respingerea recomandării cu mesajul exact solicitat de controlor', () => {
    const store = useAssistant.getState();
    store.resetVfrApproachRecommendation();

    expect(useAssistant.getState().vfrRecommendation.status).toBe('pending');
    expect(useAssistant.getState().vfrRecommendation.rejectionNotice).toBeNull();

    // Controlorul refuză recomandarea
    store.rejectVfrApproachRecommendation();

    const state = useAssistant.getState();
    expect(state.vfrRecommendation.status).toBe('rejected');
    expect(state.vfrRecommendation.rejectionNotice).toBe(
      'S-a refuzat recomandarea si se vor urma indicatiile controlorului de trafic aerian',
    );

    // Mesajul oficial este înregistrat în istoricul conversației
    const lastMsg = state.messages[state.messages.length - 1];
    expect(lastMsg?.role).toBe('controller');
    expect(lastMsg?.text).toBe(
      'S-a refuzat recomandarea si se vor urma indicatiile controlorului de trafic aerian',
    );

    // Resetare sau revenire
    store.resetVfrApproachRecommendation();
    expect(useAssistant.getState().vfrRecommendation.status).toBe('pending');
    expect(useAssistant.getState().vfrRecommendation.rejectionNotice).toBeNull();
  });

  it('gestionează acceptarea recomandării Asistentului', () => {
    const store = useAssistant.getState();
    store.resetVfrApproachRecommendation();

    store.acceptVfrApproachRecommendation();
    const state = useAssistant.getState();
    expect(state.vfrRecommendation.status).toBe('accepted');
    expect(state.vfrRecommendation.rejectionNotice).toBeNull();
  });

  it('detectează corect 2 sau mai multe aeronave VFR în așteptare pentru aterizare', () => {
    const mockAircraft: CraiovaAircraft = {
      id: 'YR-SAV',
      callsign: 'YR-5123',
      modelName: 'ICP Savannah S',
      category: 'UltralightAndGlider',
      flightRules: 'VFR',
      hasInstrumentAvionics: false,
      maxCrosswindKnots: 11,
      etaSeconds: 120,
      earliestSeconds: 60,
      latestSeconds: 420,
      speedKnots: 65,
      remainingFuelMinutes: 75,
    };

    const vfr1: FlightView = {
      id: 'YR-SAV',
      callsign: 'YR-5123',
      aircraft: mockAircraft,
      advisory: null,
      status: 'HoldInOrbitRecommended',
      slot: null,
      kind: 'hold',
      origin: { icao: 'PODARI', name: 'Podari', city: 'Podari', lat: 44.25, lon: 23.78, elevationFt: 250, fir: 'LRBB' },
      entryFixId: 'VFR-S',
      routeLabel: 'PODARI → VFR-S',
      routeDistanceNm: 5,
      traversedFirs: ['LRBB'],
      fullRoute: [],
      plannedRoute: [],
      diversionRoute: null,
      todPoint: null,
      takeoffSeconds: 0,
      track: [],
      landingSeconds: 300,
      resolvedLandingSeconds: 300,
      tacticalDecision: null,
      alternate: null,
    };

    const vfr2: FlightView = {
      ...vfr1,
      id: 'YR-WILG',
      callsign: 'YR-WLG',
      aircraft: { ...mockAircraft, id: 'YR-WILG', callsign: 'YR-WLG' },
      kind: 'approach',
      landingSeconds: 450,
      resolvedLandingSeconds: 450,
    };

    const ifr1: FlightView = {
      ...vfr1,
      id: 'WZZ3751',
      callsign: 'WZZ3751',
      aircraft: { ...mockAircraft, id: 'WZZ3751', callsign: 'WZZ3751', flightRules: 'IFR' },
      kind: 'approach',
    };

    const allFlights = [vfr1, vfr2, ifr1];

    // La momentul t = 100s, ambele aeronave VFR sunt în zbor și în așteptare
    const awaitingAt100 = getAwaitingVfrFlights(allFlights, 100);
    expect(awaitingAt100).toHaveLength(2);
    expect(awaitingAt100.map((f) => f.callsign)).toEqual(['YR-5123', 'YR-WLG']);

    // La momentul t = 360s, prima aeronavă (landingSeconds = 300s + 45s rollout) a aterizat deja
    const awaitingAt360 = getAwaitingVfrFlights(allFlights, 360);
    expect(awaitingAt360).toHaveLength(1);
    expect(awaitingAt360[0].callsign).toBe('YR-WLG');
  });
});
