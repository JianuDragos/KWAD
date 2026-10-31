import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchScenarioTraffic } from './client';
import { liveTraffic } from './mockBackend';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('fetchScenarioTraffic', () => {
  it('pornește Demo-ul și fără zborurile ROMATSA (backend vechi, 404)', async () => {
    const base = liveTraffic('eurasia');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('/romatsa/') ? json({ error: 'nu există' }, 404) : json(base))));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await fetchScenarioTraffic();
    expect(res.traffic).toEqual(base.traffic);
  });

  it('presetul eurasia nu cere și nu adaugă zborurile ROMATSA', async () => {
    const fetch = vi.fn(async (_url: string) => json(liveTraffic('eurasia')));
    vi.stubGlobal('fetch', fetch);
    await fetchScenarioTraffic(undefined, 'eurasia');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/craiova/live-traffic?forceSimulated=true&preset=eurasia']);
  });
});
