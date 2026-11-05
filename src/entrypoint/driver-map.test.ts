import { describe, expect, it } from 'vitest';
import {
  addSiteToMap,
  createDriverMapState,
  getRefreshIntervalMs,
  isRefreshDue,
  nearbySites,
  updateSiteTicketCount,
} from './driver-map';

describe('D2 driver app map', () => {
  it('shows nearby sites in distance order with a free-space band', () => {
    const state = createDriverMapState();

    addSiteToMap(state, {
      siteId: 'site-a',
      latitude: 30.01,
      longitude: 31.01,
      firstHourFee: 10,
      capacity: 20,
      openTicketCount: 2,
    });
    addSiteToMap(state, {
      siteId: 'site-b',
      latitude: 30.02,
      longitude: 31.02,
      firstHourFee: 15,
      capacity: 20,
      openTicketCount: 16,
    });

    const results = nearbySites(state, { latitude: 30.0, longitude: 31.0 }, 10_000);

    expect(results[0]?.siteId).toBe('site-a');
    expect(results[0]?.band).toBe('free');
    expect(results[1]?.siteId).toBe('site-b');
    expect(results[1]?.band).toBe('few');
  });

  it('updates the free-space band when the server changes the ticket count', () => {
    const state = createDriverMapState();

    addSiteToMap(state, {
      siteId: 'site-c',
      latitude: 30.2,
      longitude: 31.2,
      firstHourFee: 12,
      capacity: 10,
      openTicketCount: 1,
    });

    expect(nearbySites(state, { latitude: 30.2, longitude: 31.2 }, 500)[0]?.band).toBe('free');

    updateSiteTicketCount(state, 'site-c', 9);

    expect(nearbySites(state, { latitude: 30.2, longitude: 31.2 }, 500)[0]?.band).toBe('few');
  });

  it('refreshes every 15 seconds according to the requirement', () => {
    const state = createDriverMapState();
    state.lastRefreshedAtMs = 10_000;

    expect(getRefreshIntervalMs()).toBe(15_000);
    expect(isRefreshDue(state, 25_000)).toBe(true);
    expect(isRefreshDue(state, 23_000)).toBe(false);
  });
});
