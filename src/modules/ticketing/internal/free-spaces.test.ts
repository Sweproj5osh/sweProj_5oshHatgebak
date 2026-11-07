import { describe, expect, it } from 'vitest';
import { createTicketCounts } from '../public';
import { buildTicketingWorld, openCommand, START } from './testing/ticketing-world';

async function world(capacity = 5) {
  const built = await buildTicketingWorld(capacity);
  return { ...built, counts: createTicketCounts({ sites: built.sites, store: built.store }) };
}

describe('B11 the free-space count', () => {
  it('shows 2 free after 3 of 5 are open, and 3 after one closes', async () => {
    const w = await world(5);
    const tickets = [];
    for (const carRef of ['car-a', 'car-b', 'car-c']) {
      const opened = await w.opening.openTicket(openCommand({ carRef }));
      if (!opened.ok) throw new Error('open failed');
      tickets.push(opened.value);
    }
    expect(await w.counts.freeSpaces('site-1')).toBe(2);
    w.clock.advanceByMilliseconds(60 * 60 * 1000);
    await w.closing.closeTicket('close-request-1', tickets[0]?.ticketId ?? '', 'exit-site-1');
    expect(await w.counts.freeSpaces('site-1')).toBe(3);
  });

  it('is computed from the tickets: tickets added behind the desk are counted too', async () => {
    const w = await world(5);
    for (const carRef of ['car-x', 'car-y']) {
      const ticket = { ticketId: `seed-${carRef}`, siteId: 'site-1', driverRef: 'driver-9', carRef, state: 'open' as const, paymentStatus: 'unpaid' as const, openedAt: START.toISOString(), assisted: false };
      await w.store.openIfPossible({ requestKey: `seed-${carRef}`, ticket, capacity: 5 });
    }
    expect(await w.counts.freeSpaces('site-1')).toBe(3);
  });

  it('shows all spaces free at an empty site', async () => {
    const w = await world(5);
    expect(await w.counts.freeSpaces('site-1')).toBe(5);
  });

  it('never goes below 0 when the capacity is lowered under the open tickets', async () => {
    const w = await world(3);
    for (const carRef of ['car-a', 'car-b', 'car-c']) await w.opening.openTicket(openCommand({ carRef }));
    w.sites.withCapacity('site-1', 1);
    expect(await w.counts.freeSpaces('site-1')).toBe(0);
  });

  it('gives 0 for a site that does not exist', async () => {
    const w = await world();
    expect(await w.counts.freeSpaces('no-such-site')).toBe(0);
  });

  it('counts only the asked site', async () => {
    const w = await world(5);
    w.sites.withCapacity('site-2', 4);
    await w.opening.openTicket(openCommand({ carRef: 'car-a' }));
    expect(await w.counts.freeSpaces('site-2')).toBe(4);
  });

  it('reports the count query time', async () => {
    const w = await world(5000);
    for (let index = 0; index < 1000; index += 1) await w.opening.openTicket(openCommand());
    const milliseconds: number[] = [];
    for (let attempt = 0; attempt < 2000; attempt += 1) {
      const startedAt = performance.now();
      await w.counts.freeSpaces('site-1');
      milliseconds.push(performance.now() - startedAt);
    }
    milliseconds.sort((a, b) => a - b);
    const median = milliseconds[Math.floor(milliseconds.length * 0.5)] ?? 0;
    const p95 = milliseconds[Math.floor(milliseconds.length * 0.95)] ?? 0;
    console.log(`B11 report: free-space count median ${median.toFixed(4)} ms, 95th percentile ${p95.toFixed(4)} ms (1000 open tickets, in memory)`);
    expect(await w.counts.freeSpaces('site-1')).toBe(4000);
  });
});
