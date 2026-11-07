import { describe, expect, it } from 'vitest';
import { PRICE, buildTicketingWorld, openCommand, START } from './testing/ticketing-world';

const HOUR = 60 * 60 * 1000;

async function openTicket(world: Awaited<ReturnType<typeof buildTicketingWorld>>, carRef = 'car-a') {
  const opened = await world.openTicket(openCommand({ carRef }));
  if (!opened.ok) throw new Error(`open failed: ${opened.error}`);
  return opened.value;
}

describe('B8 closing a ticket', () => {
  it('freezes the exit time at the server clock and charges the fee: two hours give 15', async () => {
    const world = await buildTicketingWorld();
    const ticket = await openTicket(world);
    world.clock.advanceByMilliseconds(2 * HOUR);
    const closed = await world.closeTicket('close-request-1', ticket.ticketId, 'exit-site-1');
    expect(closed).toMatchObject({
      ok: true,
      value: { state: 'closed', paymentStatus: 'unpaid', fee: 15, closedAt: new Date(START.getTime() + 2 * HOUR).toISOString() },
    });
  });

  it('refuses the exit code of another site and leaves the ticket open', async () => {
    const world = await buildTicketingWorld();
    const ticket = await openTicket(world);
    expect(await world.closeTicket('close-request-1', ticket.ticketId, 'exit-site-2')).toEqual({ ok: false, error: 'wrong site' });
    expect((await world.findById(ticket.ticketId))?.state).toBe('open');
  });

  it('refuses a forged code and an entry code shown at the exit', async () => {
    const world = await buildTicketingWorld();
    const ticket = await openTicket(world);
    expect(await world.closeTicket('close-request-1', ticket.ticketId, 'made-up')).toEqual({ ok: false, error: 'forged code' });
    expect(await world.closeTicket('close-request-2', ticket.ticketId, 'entry-site-1')).toEqual({ ok: false, error: 'forged code' });
    expect((await world.findById(ticket.ticketId))?.state).toBe('open');
  });

  it('says "no open ticket" for a ticket already closed and for one that does not exist', async () => {
    const world = await buildTicketingWorld();
    const ticket = await openTicket(world);
    await world.closeTicket('close-request-1', ticket.ticketId, 'exit-site-1');
    expect(await world.closeTicket('close-request-2', ticket.ticketId, 'exit-site-1')).toEqual({ ok: false, error: 'no open ticket' });
    expect(await world.closeTicket('close-request-3', 'no-such-ticket', 'exit-site-1')).toEqual({ ok: false, error: 'no open ticket' });
  });

  it('refuses an exit before the entry with an error instead of charging 0', async () => {
    const world = await buildTicketingWorld();
    const future = { ...(await openTicket(world, 'car-future')), ticketId: 'ticket-future', carRef: 'car-future-2', openedAt: '2026-11-10T00:00:00.000Z' };
    await world.transact((transaction) => world.store.openIfPossible(transaction, { requestKey: 'seed-future', ticket: future, capacity: 5 }));
    expect(await world.closeTicket('close-request-1', 'ticket-future', 'exit-site-1')).toEqual({ ok: false, error: 'exit before entry' });
    expect((await world.findById('ticket-future'))?.state).toBe('open');
  });

  it('uses the price in force when the ticket opened, not a later one: three hours give 20', async () => {
    const world = await buildTicketingWorld();
    const ticket = await openTicket(world);
    await world.prices.applyApprovedVersion(
      { ...PRICE, versionId: 'price-2', firstHourFee: 100, validFrom: '2026-11-09T09:00:00.000Z' },
      'approval-2',
    );
    world.clock.advanceByMilliseconds(3 * HOUR);
    const closed = await world.closeTicket('close-request-1', ticket.ticketId, 'exit-site-1');
    expect(closed).toMatchObject({ ok: true, value: { fee: 20 } });
  });

  it('stops at the daily cap: a stay of 30 hours gives 50', async () => {
    const world = await buildTicketingWorld();
    const ticket = await openTicket(world);
    world.clock.advanceByMilliseconds(30 * HOUR);
    expect(await world.closeTicket('close-request-1', ticket.ticketId, 'exit-site-1')).toMatchObject({ ok: true, value: { fee: 50 } });
  });

  it('charges a resident car 0', async () => {
    const world = await buildTicketingWorld(5, { residents: ['car-resident'] });
    const ticket = await openTicket(world, 'car-resident');
    world.clock.advanceByMilliseconds(2 * HOUR);
    expect(await world.closeTicket('close-request-1', ticket.ticketId, 'exit-site-1')).toMatchObject({ ok: true, value: { fee: 0 } });
  });

  it('refuses to close when no price was known at the opening, and leaves the ticket open', async () => {
    const world = await buildTicketingWorld(5, { withPrice: false });
    const ticket = await openTicket(world);
    world.clock.advanceByMilliseconds(HOUR);
    expect(await world.closeTicket('close-request-1', ticket.ticketId, 'exit-site-1')).toEqual({ ok: false, error: 'no price known' });
    expect((await world.findById(ticket.ticketId))?.state).toBe('open');
  });

  it('answers the same request id twice with the same closed ticket', async () => {
    const world = await buildTicketingWorld();
    const ticket = await openTicket(world);
    world.clock.advanceByMilliseconds(HOUR);
    const first = await world.closeTicket('close-request-1', ticket.ticketId, 'exit-site-1');
    world.clock.advanceByMilliseconds(HOUR);
    expect(await world.closeTicket('close-request-1', ticket.ticketId, 'exit-site-1')).toEqual(first);
  });

  it('answers two identical closes at the same moment with one closed ticket', async () => {
    const world = await buildTicketingWorld();
    const ticket = await openTicket(world);
    world.clock.advanceByMilliseconds(HOUR);
    const [first, second] = await world.transact((transaction) =>
      Promise.all([
        world.closing.closeTicket(transaction, 'close-request-1', ticket.ticketId, 'exit-site-1'),
        world.closing.closeTicket(transaction, 'close-request-1', ticket.ticketId, 'exit-site-1'),
      ]),
    );
    expect(second).toEqual(first);
    expect(first.ok).toBe(true);
  });

  it('reports the close latency', async () => {
    const world = await buildTicketingWorld(5000);
    const milliseconds: number[] = [];
    for (let attempt = 0; attempt < 2000; attempt += 1) {
      const ticket = await openTicket(world, `car-${attempt}`);
      const startedAt = performance.now();
      await world.closeTicket(`close-${attempt}-request`, ticket.ticketId, 'exit-site-1');
      milliseconds.push(performance.now() - startedAt);
    }
    milliseconds.sort((a, b) => a - b);
    const median = milliseconds[Math.floor(milliseconds.length * 0.5)] ?? 0;
    const p95 = milliseconds[Math.floor(milliseconds.length * 0.95)] ?? 0;
    console.log(`B8 report: close latency median ${median.toFixed(4)} ms, 95th percentile ${p95.toFixed(4)} ms (2000 closes, in memory)`);
    expect(milliseconds).toHaveLength(2000);
  });
});
