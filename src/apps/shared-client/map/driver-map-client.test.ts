import { describe, expect, it } from 'vitest';
import { InMemoryDriverMapApi } from '../../test-support/in-memory-driver-map-api';
import { FREE_SPACE_BAND_REFRESH_MILLISECONDS } from './driver-map-api';
import { DriverMapClient } from './driver-map-client';

function siteAt(siteId: string, latitude: number, longitude: number, openTicketCount: number) {
  return { siteId, latitude, longitude, firstHourFee: 10, capacity: 20, openTicketCount };
}

describe('D2 driver map client', () => {
  it('shows the nearby sites in the order and with the band words the server answered', async () => {
    const api = new InMemoryDriverMapApi([siteAt('site-a', 30.01, 31.01, 2), siteAt('site-b', 30.02, 31.02, 16)]);

    const client = new DriverMapClient({ api, now: () => 0 });
    const result = await client.nearbySites({ latitude: 30.0, longitude: 31.0 }, 10_000);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('expected nearby sites to load');
    }
    expect(result.value.map((site) => [site.siteId, site.band])).toEqual([
      ['site-a', 'free'],
      ['site-b', 'few'],
    ]);
  });

  it('shows the new band word after the server changed it; the client re-reads, it never derives', async () => {
    const api = new InMemoryDriverMapApi([siteAt('site-c', 30.2, 31.2, 1)]);
    const client = new DriverMapClient({ api, now: () => 0 });
    const before = await client.nearbySites({ latitude: 30.2, longitude: 31.2 }, 500);
    expect(before.ok && before.value[0]?.band).toBe('free');

    api.updateSiteTicketCount('site-c', 19);
    const after = await client.nearbySites({ latitude: 30.2, longitude: 31.2 }, 500);

    expect(after.ok && after.value[0]?.band).toBe('few');
  });

  it('re-reads every 15 seconds, the named constant of the data layer', async () => {
    const client = new DriverMapClient({ api: new InMemoryDriverMapApi(), now: () => 10_000 });

    await client.nearbySites({ latitude: 30.0, longitude: 31.0 }, 1_000);

    expect(FREE_SPACE_BAND_REFRESH_MILLISECONDS).toBe(15_000);
    expect(client.refreshIntervalMs()).toBe(FREE_SPACE_BAND_REFRESH_MILLISECONDS);
    expect(client.isRefreshDue(25_000)).toBe(true);
    expect(client.isRefreshDue(24_999)).toBe(false);
  });
});
