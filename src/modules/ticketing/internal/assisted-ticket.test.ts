import { describe, expect, it } from 'vitest';
import { createTicketCounts, createTicketOpening } from '../public';
import { assistedCommand, buildTicketingWorld, openCommand, START } from './testing/ticketing-world';

const HOUR = 60 * 60 * 1000;

describe('B10 assisted tickets: opening', () => {
  it('lets an assigned attendant open a flagged ticket for a driver without a phone', async () => {
    const world = await buildTicketingWorld();
    const opened = await world.opening.openAssistedTicket(assistedCommand({ carRef: 'car-a' }), 'attendant-1');
    expect(opened).toMatchObject({
      ok: true,
      value: { assisted: true, driverRef: 'walk-in-driver', carRef: 'car-a', state: 'open', openedAt: START.toISOString() },
    });
  });

  it('refuses an attendant of another site, and one who is assigned nowhere, and creates no ticket', async () => {
    const world = await buildTicketingWorld();
    expect(await world.opening.openAssistedTicket(assistedCommand(), 'attendant-2')).toEqual({ ok: false, error: 'attendant not assigned to this site' });
    expect(await world.opening.openAssistedTicket(assistedCommand(), 'attendant-unknown')).toEqual({ ok: false, error: 'attendant not assigned to this site' });
    expect(await world.store.countOpen('site-1')).toBe(0);
  });

  it('keeps every ordinary check: forged code, closed site, car already parked, full site', async () => {
    const world = await buildTicketingWorld(1);
    expect(await world.opening.openAssistedTicket(assistedCommand({ entryCode: 'made-up' }), 'attendant-1')).toEqual({ ok: false, error: 'forged code' });
    await world.opening.openAssistedTicket(assistedCommand({ carRef: 'car-a' }), 'attendant-1');
    expect(await world.opening.openAssistedTicket(assistedCommand({ carRef: 'car-a' }), 'attendant-1')).toEqual({ ok: false, error: 'car already parked' });
    expect(await world.opening.openAssistedTicket(assistedCommand({ carRef: 'car-b' }), 'attendant-1')).toEqual({ ok: false, error: 'site full' });
    world.sites.closeSite('site-1');
    expect(await world.opening.openAssistedTicket(assistedCommand({ carRef: 'car-c' }), 'attendant-1')).toEqual({ ok: false, error: 'site closed' });
  });

  it('refuses every attendant when no assignment source is connected', async () => {
    const world = await buildTicketingWorld();
    const unconnected = createTicketOpening({ sites: world.sites, store: world.store, clock: world.clock });
    expect(await unconnected.openAssistedTicket(assistedCommand(), 'attendant-1')).toEqual({ ok: false, error: 'attendant not assigned to this site' });
  });

  it('does not flag an ordinary driver ticket', async () => {
    const world = await buildTicketingWorld();
    expect(await world.opening.openTicket(openCommand())).toMatchObject({ ok: true, value: { assisted: false } });
  });

  it('answers a repeated request id with the same ticket', async () => {
    const world = await buildTicketingWorld();
    const command = assistedCommand();
    const first = await world.opening.openAssistedTicket(command, 'attendant-1');
    expect(await world.opening.openAssistedTicket(command, 'attendant-1')).toEqual(first);
    const counts = createTicketCounts({ sites: world.sites, store: world.store });
    expect(await counts.assistedTicketCount('site-1', 2026, 11)).toBe(1);
  });
});

describe('B10 assisted tickets: the monthly count', () => {
  it('counts assisted tickets per site per month and nothing else', async () => {
    const world = await buildTicketingWorld();
    const counts = createTicketCounts({ sites: world.sites, store: world.store });
    world.sites.withCapacity('site-2', 5);
    await world.opening.openAssistedTicket(assistedCommand({ carRef: 'car-a' }), 'attendant-1');
    await world.opening.openTicket(openCommand({ carRef: 'car-b' }));
    await world.opening.openAssistedTicket(assistedCommand({ carRef: 'car-c', siteId: 'site-2', entryCode: 'entry-site-2' }), 'attendant-2');
    world.clock.advanceByMilliseconds(30 * 24 * HOUR);
    await world.opening.openAssistedTicket(assistedCommand({ carRef: 'car-d' }), 'attendant-1');
    expect(await counts.assistedTicketCount('site-1', 2026, 11)).toBe(1);
    expect(await counts.assistedTicketCount('site-1', 2026, 12)).toBe(1);
    expect(await counts.assistedTicketCount('site-2', 2026, 11)).toBe(1);
    expect(await counts.assistedTicketCount('site-1', 2027, 1)).toBe(0);
  });

  it('keeps counting a ticket after it is closed', async () => {
    const world = await buildTicketingWorld();
    const counts = createTicketCounts({ sites: world.sites, store: world.store });
    const opened = await world.opening.openAssistedTicket(assistedCommand({ carRef: 'car-a' }), 'attendant-1');
    if (!opened.ok) throw new Error('open failed');
    world.clock.advanceByMilliseconds(HOUR);
    await world.closing.closeAssistedTicket('close-request-1', opened.value.ticketId, 'exit-site-1', 'attendant-1', 'car-a');
    expect(await counts.assistedTicketCount('site-1', 2026, 11)).toBe(1);
  });
});

describe('B10 assisted tickets: closing', () => {
  async function assistedTicket(world: Awaited<ReturnType<typeof buildTicketingWorld>>, carRef = 'car-a') {
    const opened = await world.opening.openAssistedTicket(assistedCommand({ carRef }), 'attendant-1');
    if (!opened.ok) throw new Error('open failed');
    world.clock.advanceByMilliseconds(2 * HOUR);
    return opened.value;
  }

  it('lets the assigned attendant close it when the car matches, with the server exit time and the fee', async () => {
    const world = await buildTicketingWorld();
    const ticket = await assistedTicket(world);
    const closed = await world.closing.closeAssistedTicket('close-request-1', ticket.ticketId, 'exit-site-1', 'attendant-1', 'car-a');
    expect(closed).toMatchObject({ ok: true, value: { state: 'closed', fee: 15, closedAt: new Date(START.getTime() + 2 * HOUR).toISOString() } });
  });

  it('refuses a different car at the exit and leaves the ticket open', async () => {
    const world = await buildTicketingWorld();
    const ticket = await assistedTicket(world);
    const refused = await world.closing.closeAssistedTicket('close-request-1', ticket.ticketId, 'exit-site-1', 'attendant-1', 'car-other');
    expect(refused).toEqual({ ok: false, error: 'car does not match' });
    expect((await world.store.findById(ticket.ticketId))?.state).toBe('open');
  });

  it('refuses an ordinary driver ticket', async () => {
    const world = await buildTicketingWorld();
    const opened = await world.opening.openTicket(openCommand({ carRef: 'car-a' }));
    if (!opened.ok) throw new Error('open failed');
    const refused = await world.closing.closeAssistedTicket('close-request-1', opened.value.ticketId, 'exit-site-1', 'attendant-1', 'car-a');
    expect(refused).toEqual({ ok: false, error: 'not an assisted ticket' });
  });

  it('refuses an attendant of another site and one assigned nowhere', async () => {
    const world = await buildTicketingWorld();
    const ticket = await assistedTicket(world);
    for (const attendant of ['attendant-2', 'attendant-unknown']) {
      const refused = await world.closing.closeAssistedTicket(`close-${attendant}`, ticket.ticketId, 'exit-site-1', attendant, 'car-a');
      expect(refused).toEqual({ ok: false, error: 'attendant not assigned to this site' });
    }
    expect((await world.store.findById(ticket.ticketId))?.state).toBe('open');
  });

  it('keeps the exit code check and answers a repeated request id the same way', async () => {
    const world = await buildTicketingWorld();
    const ticket = await assistedTicket(world);
    expect(await world.closing.closeAssistedTicket('close-request-1', ticket.ticketId, 'exit-site-2', 'attendant-1', 'car-a')).toEqual({ ok: false, error: 'wrong site' });
    const first = await world.closing.closeAssistedTicket('close-request-2', ticket.ticketId, 'exit-site-1', 'attendant-1', 'car-a');
    world.clock.advanceByMilliseconds(HOUR);
    expect(await world.closing.closeAssistedTicket('close-request-2', ticket.ticketId, 'exit-site-1', 'attendant-1', 'car-a')).toEqual(first);
  });
});
