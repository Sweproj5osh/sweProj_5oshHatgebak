import { describe, expect, it } from 'vitest';
import { createTicketReading } from '../public';
import { ATTENDANT_AT_SITE_1, assistedCommand, buildTicketingWorld, openCommand, START } from './testing/ticketing-world';

const HOUR = 60 * 60 * 1000;

async function world(options: Parameters<typeof buildTicketingWorld>[1] = {}) {
  const built = await buildTicketingWorld(5, options);
  built.sites.withCapacity('site-2', 5);
  const reading = createTicketReading({ store: built.store, plates: built.plates, fees: built.fees });
  return { ...built, reading, sweep: (siteId: string, maximumHours: number) => built.transact((transaction) => built.closing.closeStaleTickets(transaction, siteId, maximumHours)) };
}

type World = Awaited<ReturnType<typeof world>>;

async function open(w: World, carRef: string, siteId = 'site-1', driverRef = 'driver-1') {
  const opened = await w.openTicket(openCommand({ carRef, siteId, entryCode: `entry-${siteId}`, driverRef }));
  if (!opened.ok) throw new Error(`open failed: ${opened.error}`);
  return opened.value;
}

describe('closing stale tickets (TicketDesk.closeStaleTickets)', () => {
  it('closes the tickets open for the maximum or longer at the server time and the capped fee, and leaves younger ones open', async () => {
    const w = await world();
    const old = await open(w, 'car-old');
    w.clock.advanceByMilliseconds(3 * HOUR);
    const young = await open(w, 'car-young');
    w.clock.advanceByMilliseconds(10 * HOUR);
    expect(await w.sweep('site-1', 12)).toEqual({ closed: [old.ticketId], leftOpen: [] });
    expect(await w.findById(old.ticketId)).toMatchObject({ state: 'closed', fee: 50, closedAt: new Date(START.getTime() + 13 * HOUR).toISOString() });
    expect((await w.findById(young.ticketId))?.state).toBe('open');
  });

  it('closes exactly at the maximum, counts only the asked site, and closes nothing on a second sweep', async () => {
    const w = await world();
    const here = await open(w, 'car-here');
    await open(w, 'car-there', 'site-2');
    w.clock.advanceByMilliseconds(12 * HOUR);
    expect((await w.sweep('site-1', 12)).closed).toEqual([here.ticketId]);
    expect(await w.sweep('site-1', 12)).toEqual({ closed: [], leftOpen: [] });
    expect(await w.countOpen('site-2')).toBe(1);
  });

  it('names a ticket it cannot close and leaves it open instead of dropping it', async () => {
    const w = await world({ withPrice: false });
    const ticket = await open(w, 'car-unpriced');
    w.clock.advanceByMilliseconds(24 * HOUR);
    expect(await w.sweep('site-1', 12)).toEqual({ closed: [], leftOpen: [{ ticketId: ticket.ticketId, reason: 'no price known' }] });
    expect((await w.findById(ticket.ticketId))?.state).toBe('open');
  });
});

describe('frequent sites (TicketQuery.frequentSites)', () => {
  it('orders sites by visits, most visited first, and the most recent first among equals', async () => {
    const w = await world();
    await open(w, 'car-1', 'site-2');
    w.clock.advanceByMilliseconds(HOUR);
    await open(w, 'car-2', 'site-1');
    w.clock.advanceByMilliseconds(HOUR);
    await open(w, 'car-3', 'site-1');
    expect(await w.reading.frequentSites(w.database, 'driver-1')).toEqual(['site-1', 'site-2']);
    await open(w, 'car-4', 'site-2', 'driver-2');
    expect(await w.reading.frequentSites(w.database, 'driver-2')).toEqual(['site-2']);
    expect(await w.reading.frequentSites(w.database, 'driver-3')).toEqual([]);
  });
});

describe('closed tickets of a site in a window (TicketQuery.closedTicketsBetween, P28 #36)', () => {
  it('lists fee, payment status and the assisted flag of the tickets closed from the start (inclusive) to the end (exclusive), oldest first', async () => {
    const w = await world();
    const first = await open(w, 'car-a');
    const assisted = await w.openAssistedTicket(assistedCommand({ carRef: 'car-b' }), ATTENDANT_AT_SITE_1);
    if (!assisted.ok) throw new Error('open failed');
    await open(w, 'car-elsewhere', 'site-2');
    w.clock.advanceByMilliseconds(HOUR);
    await w.closeTicket('close-a', first.ticketId, 'exit-site-1');
    await w.changePaymentStatus('pay-a', first.ticketId, 'paid');
    w.clock.advanceByMilliseconds(HOUR);
    await w.closeAssistedTicket('close-b', assisted.value.ticketId, 'exit-site-1', ATTENDANT_AT_SITE_1, 'car-b');
    const firstClose = new Date(START.getTime() + HOUR);
    const secondClose = new Date(START.getTime() + 2 * HOUR);

    expect(await w.reading.closedTicketsBetween(w.database, 'site-1', START, new Date(secondClose.getTime() + 1))).toEqual([
      { ticketId: first.ticketId, closedAt: firstClose.toISOString(), fee: 10, paymentStatus: 'paid', assisted: false },
      { ticketId: assisted.value.ticketId, closedAt: secondClose.toISOString(), fee: 15, paymentStatus: 'unpaid', assisted: true },
    ]);
    expect((await w.reading.closedTicketsBetween(w.database, 'site-1', START, secondClose)).map((summary) => summary.ticketId)).toEqual([first.ticketId]);
    expect(await w.reading.closedTicketsBetween(w.database, 'site-2', START, new Date(START.getTime() + 3 * HOUR))).toEqual([]);
  });
});
