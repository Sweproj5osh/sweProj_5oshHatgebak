import { describe, expect, it } from 'vitest';
import { createTicketCounts } from '../public';
import { ATTENDANT_AT_SITE_1, ATTENDANT_AT_SITE_2, ATTENDANT_CLOCKED_OUT, assistedCommand, buildTicketingWorld, openCommand, START } from './testing/ticketing-world';

const HOUR = 60 * 60 * 1000;

describe('B10 assisted tickets: opening', () => {
  it('lets an attendant clocked in at the site open a flagged ticket for a driver without a phone', async () => {
    const world = await buildTicketingWorld();
    const opened = await world.openAssistedTicket(assistedCommand({ carRef: 'car-a' }), ATTENDANT_AT_SITE_1);
    expect(opened).toMatchObject({
      ok: true,
      value: { assisted: true, driverRef: 'walk-in-driver', carRef: 'car-a', state: 'open', openedAt: START.toISOString() },
    });
  });

  it('refuses an attendant clocked in at another site, and one clocked in nowhere, and creates no ticket', async () => {
    const world = await buildTicketingWorld();
    expect(await world.openAssistedTicket(assistedCommand(), ATTENDANT_AT_SITE_2)).toEqual({ ok: false, error: 'attendant not clocked in at this site' });
    expect(await world.openAssistedTicket(assistedCommand(), ATTENDANT_CLOCKED_OUT)).toEqual({ ok: false, error: 'attendant not clocked in at this site' });
    expect(await world.countOpen('site-1')).toBe(0);
  });

  it('keeps every ordinary check: forged code, closed site, car already parked, full site', async () => {
    const world = await buildTicketingWorld(1);
    expect(await world.openAssistedTicket(assistedCommand({ entryCode: 'made-up' }), ATTENDANT_AT_SITE_1)).toEqual({ ok: false, error: 'forged code' });
    await world.openAssistedTicket(assistedCommand({ carRef: 'car-a' }), ATTENDANT_AT_SITE_1);
    expect(await world.openAssistedTicket(assistedCommand({ carRef: 'car-a' }), ATTENDANT_AT_SITE_1)).toEqual({ ok: false, error: 'car already parked' });
    expect(await world.openAssistedTicket(assistedCommand({ carRef: 'car-b' }), ATTENDANT_AT_SITE_1)).toEqual({ ok: false, error: 'site full' });
    world.sites.closeSite('site-1');
    expect(await world.openAssistedTicket(assistedCommand({ carRef: 'car-c' }), ATTENDANT_AT_SITE_1)).toEqual({ ok: false, error: 'site closed' });
  });

  it('does not flag an ordinary driver ticket', async () => {
    const world = await buildTicketingWorld();
    expect(await world.openTicket(openCommand())).toMatchObject({ ok: true, value: { assisted: false } });
  });

  it('answers a repeated request id with the same ticket', async () => {
    const world = await buildTicketingWorld();
    const command = assistedCommand();
    const first = await world.openAssistedTicket(command, ATTENDANT_AT_SITE_1);
    expect(await world.openAssistedTicket(command, ATTENDANT_AT_SITE_1)).toEqual(first);
    const counts = createTicketCounts({ sites: world.sites, store: world.store });
    expect(await counts.assistedTicketCount(world.database, 'site-1', 2026, 11)).toBe(1);
  });
});

describe('B10 assisted tickets: the monthly count', () => {
  it('counts assisted tickets per site per month and nothing else', async () => {
    const world = await buildTicketingWorld();
    const counts = createTicketCounts({ sites: world.sites, store: world.store });
    world.sites.withCapacity('site-2', 5);
    await world.openAssistedTicket(assistedCommand({ carRef: 'car-a' }), ATTENDANT_AT_SITE_1);
    await world.openTicket(openCommand({ carRef: 'car-b' }));
    await world.openAssistedTicket(assistedCommand({ carRef: 'car-c', siteId: 'site-2', entryCode: 'entry-site-2' }), ATTENDANT_AT_SITE_2);
    world.clock.advanceByMilliseconds(30 * 24 * HOUR);
    await world.openAssistedTicket(assistedCommand({ carRef: 'car-d' }), ATTENDANT_AT_SITE_1);
    expect(await counts.assistedTicketCount(world.database, 'site-1', 2026, 11)).toBe(1);
    expect(await counts.assistedTicketCount(world.database, 'site-1', 2026, 12)).toBe(1);
    expect(await counts.assistedTicketCount(world.database, 'site-2', 2026, 11)).toBe(1);
    expect(await counts.assistedTicketCount(world.database, 'site-1', 2027, 1)).toBe(0);
  });

  it('keeps counting a ticket after it is closed', async () => {
    const world = await buildTicketingWorld();
    const counts = createTicketCounts({ sites: world.sites, store: world.store });
    const opened = await world.openAssistedTicket(assistedCommand({ carRef: 'car-a' }), ATTENDANT_AT_SITE_1);
    if (!opened.ok) throw new Error('open failed');
    world.clock.advanceByMilliseconds(HOUR);
    await world.closeAssistedTicket('close-request-1', opened.value.ticketId, 'exit-site-1', ATTENDANT_AT_SITE_1, 'car-a');
    expect(await counts.assistedTicketCount(world.database, 'site-1', 2026, 11)).toBe(1);
  });
});

describe('B10 assisted tickets: closing', () => {
  async function assistedTicket(world: Awaited<ReturnType<typeof buildTicketingWorld>>, carRef = 'car-a') {
    const opened = await world.openAssistedTicket(assistedCommand({ carRef }), ATTENDANT_AT_SITE_1);
    if (!opened.ok) throw new Error('open failed');
    world.clock.advanceByMilliseconds(2 * HOUR);
    return opened.value;
  }

  it('lets the clocked-in attendant close it when the car matches, with the server exit time and the fee', async () => {
    const world = await buildTicketingWorld();
    const ticket = await assistedTicket(world);
    const closed = await world.closeAssistedTicket('close-request-1', ticket.ticketId, 'exit-site-1', ATTENDANT_AT_SITE_1, 'car-a');
    expect(closed).toMatchObject({ ok: true, value: { state: 'closed', fee: 15, closedAt: new Date(START.getTime() + 2 * HOUR).toISOString() } });
  });

  it('refuses a different car at the exit and leaves the ticket open', async () => {
    const world = await buildTicketingWorld();
    const ticket = await assistedTicket(world);
    const refused = await world.closeAssistedTicket('close-request-1', ticket.ticketId, 'exit-site-1', ATTENDANT_AT_SITE_1, 'car-other');
    expect(refused).toEqual({ ok: false, error: 'car does not match' });
    expect((await world.findById(ticket.ticketId))?.state).toBe('open');
  });

  it('refuses an ordinary driver ticket', async () => {
    const world = await buildTicketingWorld();
    const opened = await world.openTicket(openCommand({ carRef: 'car-a' }));
    if (!opened.ok) throw new Error('open failed');
    const refused = await world.closeAssistedTicket('close-request-1', opened.value.ticketId, 'exit-site-1', ATTENDANT_AT_SITE_1, 'car-a');
    expect(refused).toEqual({ ok: false, error: 'not an assisted ticket' });
  });

  it('refuses an attendant clocked in at another site and one clocked in nowhere', async () => {
    const world = await buildTicketingWorld();
    const ticket = await assistedTicket(world);
    for (const attendant of [ATTENDANT_AT_SITE_2, ATTENDANT_CLOCKED_OUT]) {
      const refused = await world.closeAssistedTicket(`close-${attendant.attendantId}`, ticket.ticketId, 'exit-site-1', attendant, 'car-a');
      expect(refused).toEqual({ ok: false, error: 'attendant not clocked in at this site' });
    }
    expect((await world.findById(ticket.ticketId))?.state).toBe('open');
  });

  it('keeps the exit code check and answers a repeated request id the same way', async () => {
    const world = await buildTicketingWorld();
    const ticket = await assistedTicket(world);
    expect(await world.closeAssistedTicket('close-request-1', ticket.ticketId, 'exit-site-2', ATTENDANT_AT_SITE_1, 'car-a')).toEqual({ ok: false, error: 'wrong site' });
    const first = await world.closeAssistedTicket('close-request-2', ticket.ticketId, 'exit-site-1', ATTENDANT_AT_SITE_1, 'car-a');
    world.clock.advanceByMilliseconds(HOUR);
    expect(await world.closeAssistedTicket('close-request-2', ticket.ticketId, 'exit-site-1', ATTENDANT_AT_SITE_1, 'car-a')).toEqual(first);
  });
});
