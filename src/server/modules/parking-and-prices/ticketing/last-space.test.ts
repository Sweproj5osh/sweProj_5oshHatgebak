import { describe, expect, it } from 'vitest';
import { buildTicketingWorld, openCommand } from './testing/ticketing-world';

/**
 * The twenty opens race inside one unit of work: that is the view the store's indivisible step protects (count the open
 * tickets, insert, in one step). Across separate transactions the in-memory database does not lock (ADR-13), so there
 * the PostgreSQL adapter's site lock is the guard; the contract on `TicketStore` says so.
 */
describe('B6 the last-space rule (F3)', () => {
  it('opens exactly 5 tickets for 20 simultaneous opens on 5 spaces', async () => {
    const { world } = await runTwentyOnFive();
    expect(await world.countOpen('site-1')).toBe(5);
  });

  it('repeats the 20-on-5 race 50 times with no failure', async () => {
    let failures = 0;
    for (let run = 0; run < 50; run += 1) {
      const { results, world } = await runTwentyOnFive();
      const tickets = results.filter((result) => result.ok).length;
      const refusals = results.filter((result) => !result.ok && result.error === 'site full').length;
      if (tickets !== 5 || refusals !== 15 || (await world.countOpen('site-1')) !== 5) failures += 1;
    }
    console.log(`B6 report: runs 50, failures ${failures}`);
    expect(failures).toBe(0);
  });

  it('frees exactly one space when one ticket closes', async () => {
    const world = await buildTicketingWorld(2);
    const first = await world.openTicket(openCommand());
    await world.openTicket(openCommand());
    expect(await world.openTicket(openCommand())).toEqual({ ok: false, error: 'site full' });
    if (!first.ok) throw new Error('first open failed');
    await world.closeTicket('close-request-1', first.value.ticketId, 'exit-site-1');
    expect((await world.openTicket(openCommand())).ok).toBe(true);
    expect(await world.openTicket(openCommand())).toEqual({ ok: false, error: 'site full' });
  });

  it('refuses everything at a site with no spaces', async () => {
    const world = await buildTicketingWorld(0);
    expect(await world.openTicket(openCommand())).toEqual({ ok: false, error: 'site full' });
  });
});

async function runTwentyOnFive() {
  const world = await buildTicketingWorld(5);
  const results = await world.transact((transaction) =>
    Promise.all(Array.from({ length: 20 }, () => world.opening.openTicket(transaction, openCommand()))),
  );
  return { world, results };
}
