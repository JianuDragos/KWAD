import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchScenarioTraffic } from './client';
import { liveTraffic } from './mockBackend';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('fetchScenarioTraffic', () => {
  it('cere traficul scenariului implicit (5 aeronave: 3 IFR + 2 VFR)', async () => {
    const base = liveTraffic('default');
    vi.stubGlobal('fetch', vi.fn(async () => json(base)));
    const res = await fetchScenarioTraffic();
    expect(res.traffic).toEqual(base.traffic);
    expect(res.traffic).toHaveLength(5);
  });

  it('presetul eurasia cere ruta specifică eurasia', async () => {
    const fetch = vi.fn(async (_url: string) => json(liveTraffic('eurasia')));
    vi.stubGlobal('fetch', fetch);
    await fetchScenarioTraffic(undefined, 'eurasia');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/craiova/live-traffic?forceSimulated=true&preset=eurasia']);
  });
});
