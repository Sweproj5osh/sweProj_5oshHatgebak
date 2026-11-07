import { describe, expect, it } from 'vitest';
import { buildTicketingWorld, openCommand } from './testing/ticketing-world';

describe('B6 the last-space rule (F3)', () => {
  it('opens exactly 5 tickets for 20 simultaneous opens on 5 spaces', async () => {
    const { opening, store } = await runTwentyOnFive();
    expect(await store.countOpen('site-1')).toBe(5);
    expect(opening).toBeDefined();
  });

  it('repeats the 20-on-5 race 50 times with no failure', async () => {
    let failures = 0;
    for (let run = 0; run < 50; run += 1) {
      const { results, store } = await runTwentyOnFive();
      const tickets = results.filter((result) => result.ok).length;
      const refusals = results.filter((result) => !result.ok && result.error === 'site full').length;
      if (tickets !== 5 || refusals !== 15 || (await store.countOpen('site-1')) !== 5) failures += 1;
    }
    console.log(`B6 report: runs 50, failures ${failures}`);
    expect(failures).toBe(0);
  });

  it('frees exactly one space when one ticket closes', async () => {
    const { opening, closing } = await buildTicketingWorld(2);
    const first = await opening.openTicket(openCommand());
    await opening.openTicket(openCommand());
    expect(await opening.openTicket(openCommand())).toEqual({ ok: false, error: 'site full' });
    if (!first.ok) throw new Error('first open failed');
    await closing.closeTicket('close-request-1', first.value.ticketId, 'exit-site-1');
    expect((await opening.openTicket(openCommand())).ok).toBe(true);
    expect(await opening.openTicket(openCommand())).toEqual({ ok: false, error: 'site full' });
  });

  it('refuses everything at a site with no spaces', async () => {
    const { opening } = await buildTicketingWorld(0);
    expect(await opening.openTicket(openCommand())).toEqual({ ok: false, error: 'site full' });
  });
});

async function runTwentyOnFive() {
  const world = await buildTicketingWorld(5);
  const results = await Promise.all(Array.from({ length: 20 }, () => world.opening.openTicket(openCommand())));
  return { ...world, results };
}
