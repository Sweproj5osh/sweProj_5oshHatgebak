import { describe, expect, it } from 'vitest';
import { pathWith } from './route-path';

describe('pathWith fills a route template from the request values (ADR-22)', () => {
  it('fills each named segment, encodes it, and leaves a fixed path alone', () => {
    expect(pathWith('/tickets/:ticketId/closure', { ticketId: 'ticket 1/2', exitCode: 'x' })).toBe('/tickets/ticket%201%2F2/closure');
    expect(pathWith('/tickets', { siteId: 'site-1' })).toBe('/tickets');
  });

  it('refuses a template whose value the request does not carry', () => {
    expect(() => pathWith('/sites/:siteId', {})).toThrow('the route /sites/:siteId needs a value for siteId');
  });
});
