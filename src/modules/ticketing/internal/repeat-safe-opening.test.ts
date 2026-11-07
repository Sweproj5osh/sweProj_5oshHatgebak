import { describe, expect, it } from 'vitest';
import { buildTicketingWorld, openCommand } from './testing/ticketing-world';

describe('B7 repeat-safe opening', () => {
  it('answers the same request id twice with one ticket and identical answers', async () => {
    const world = await buildTicketingWorld();
    const command = openCommand({ carRef: 'car-a' });
    const first = await world.openTicket(command);
    const second = await world.openTicket(command);
    expect(second).toEqual(first);
    expect(first.ok).toBe(true);
    expect(await world.countOpen('site-1')).toBe(1);
  });

  it('answers a repeat even when the site has closed since', async () => {
    const world = await buildTicketingWorld();
    const command = openCommand();
    const first = await world.openTicket(command);
    world.sites.closeSite('site-1');
    expect(await world.openTicket(command)).toEqual(first);
  });

  /**
   * Two sends of one request id in separate transactions are serialised by the entry point's per-request-id lock
   * (Rule H, P19); inside one transaction the store's own indivisible step is what keeps them to one ticket.
   */
  it('opens one ticket when the same request arrives twice at the same moment', async () => {
    const world = await buildTicketingWorld();
    const command = openCommand();
    const [first, second] = await world.transact((transaction) =>
      Promise.all([world.opening.openTicket(transaction, command), world.opening.openTicket(transaction, command)]),
    );
    expect(second).toEqual(first);
    expect(await world.countOpen('site-1')).toBe(1);
  });

  it('does not use a second space for a repeat', async () => {
    const world = await buildTicketingWorld(1);
    const command = openCommand();
    await world.openTicket(command);
    await world.openTicket(command);
    expect(await world.countOpen('site-1')).toBe(1);
  });

  it('creates no ticket when a refused request is repeated', async () => {
    const world = await buildTicketingWorld();
    const command = openCommand({ entryCode: 'made-up' });
    const first = await world.openTicket(command);
    expect(await world.openTicket(command)).toEqual(first);
    expect(await world.countOpen('site-1')).toBe(0);
  });

  it('treats a new request id from the same car as a new attempt', async () => {
    const world = await buildTicketingWorld();
    await world.openTicket(openCommand({ carRef: 'car-a' }));
    expect(await world.openTicket(openCommand({ carRef: 'car-a' }))).toEqual({ ok: false, error: 'car already parked' });
  });

  it('keeps two drivers who reuse a request id apart', async () => {
    const world = await buildTicketingWorld();
    const one = await world.openTicket(openCommand({ requestId: 'shared-request-id', driverRef: 'driver-1', carRef: 'car-a' }));
    const two = await world.openTicket(openCommand({ requestId: 'shared-request-id', driverRef: 'driver-2', carRef: 'car-b' }));
    expect(one.ok && two.ok && one.value.ticketId !== two.value.ticketId).toBe(true);
  });
});
