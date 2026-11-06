import { describe, expect, it } from 'vitest';
import { buildTicketingWorld, openCommand } from './testing/ticketing-world';

describe('B7 repeat-safe opening', () => {
  it('answers the same request id twice with one ticket and identical answers', async () => {
    const { opening, store } = await buildTicketingWorld();
    const command = openCommand({ carRef: 'car-a' });
    const first = await opening.openTicket(command);
    const second = await opening.openTicket(command);
    expect(second).toEqual(first);
    expect(first.ok).toBe(true);
    expect(await store.countOpen('site-1')).toBe(1);
  });

  it('answers a repeat even when the site has closed since', async () => {
    const { opening, sites } = await buildTicketingWorld();
    const command = openCommand();
    const first = await opening.openTicket(command);
    sites.closeSite('site-1');
    expect(await opening.openTicket(command)).toEqual(first);
  });

  it('opens one ticket when the same request arrives twice at the same moment', async () => {
    const { opening, store } = await buildTicketingWorld();
    const command = openCommand();
    const [first, second] = await Promise.all([opening.openTicket(command), opening.openTicket(command)]);
    expect(second).toEqual(first);
    expect(await store.countOpen('site-1')).toBe(1);
  });

  it('does not use a second space for a repeat', async () => {
    const { opening, store } = await buildTicketingWorld(1);
    const command = openCommand();
    await opening.openTicket(command);
    await opening.openTicket(command);
    expect(await store.countOpen('site-1')).toBe(1);
  });

  it('creates no ticket when a refused request is repeated', async () => {
    const { opening, store } = await buildTicketingWorld();
    const command = openCommand({ entryCode: 'made-up' });
    const first = await opening.openTicket(command);
    expect(await opening.openTicket(command)).toEqual(first);
    expect(await store.countOpen('site-1')).toBe(0);
  });

  it('treats a new request id from the same car as a new attempt', async () => {
    const { opening } = await buildTicketingWorld();
    await opening.openTicket(openCommand({ carRef: 'car-a' }));
    expect(await opening.openTicket(openCommand({ carRef: 'car-a' }))).toEqual({ ok: false, error: 'car already parked' });
  });

  it('keeps two drivers who reuse a request id apart', async () => {
    const { opening } = await buildTicketingWorld();
    const one = await opening.openTicket(openCommand({ requestId: 'shared-request-id', driverRef: 'driver-1', carRef: 'car-a' }));
    const two = await opening.openTicket(openCommand({ requestId: 'shared-request-id', driverRef: 'driver-2', carRef: 'car-b' }));
    expect(one.ok && two.ok && one.value.ticketId !== two.value.ticketId).toBe(true);
  });
});
