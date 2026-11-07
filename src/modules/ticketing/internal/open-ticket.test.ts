import { describe, expect, it } from 'vitest';
import { buildTicketingWorld, openCommand, START } from './testing/ticketing-world';

describe('B5 opening a ticket', () => {
  it('opens a ticket with the entry time from the server clock', async () => {
    const { opening } = await buildTicketingWorld();
    const opened = await opening.openTicket(openCommand({ carRef: 'car-a' }));
    expect(opened).toMatchObject({
      ok: true,
      value: { siteId: 'site-1', carRef: 'car-a', state: 'open', paymentStatus: 'unpaid', openedAt: START.toISOString(), assisted: false },
    });
  });

  it('refuses a forged code and creates no ticket', async () => {
    const { opening, store } = await buildTicketingWorld();
    expect(await opening.openTicket(openCommand({ entryCode: 'made-up' }))).toEqual({ ok: false, error: 'forged code' });
    expect(await store.countOpen('site-1')).toBe(0);
  });

  it('refuses the code of another site', async () => {
    const { opening } = await buildTicketingWorld();
    expect(await opening.openTicket(openCommand({ entryCode: 'entry-site-2' }))).toEqual({ ok: false, error: 'wrong site' });
  });

  it('refuses an exit code shown at the entrance', async () => {
    const { opening } = await buildTicketingWorld();
    expect(await opening.openTicket(openCommand({ entryCode: 'exit-site-1' }))).toEqual({ ok: false, error: 'forged code' });
  });

  it('refuses a closed site', async () => {
    const { opening, sites } = await buildTicketingWorld();
    sites.closeSite('site-1');
    expect(await opening.openTicket(openCommand())).toEqual({ ok: false, error: 'site closed' });
  });

  it('refuses the same car a second time', async () => {
    const { opening } = await buildTicketingWorld();
    await opening.openTicket(openCommand({ carRef: 'car-a' }));
    expect(await opening.openTicket(openCommand({ carRef: 'car-a' }))).toEqual({ ok: false, error: 'car already parked' });
  });

  it('refuses the same car at another site while it is parked', async () => {
    const { opening, sites } = await buildTicketingWorld();
    sites.withCapacity('site-2', 5);
    await opening.openTicket(openCommand({ carRef: 'car-a' }));
    const elsewhere = openCommand({ carRef: 'car-a', siteId: 'site-2', entryCode: 'entry-site-2' });
    expect(await opening.openTicket(elsewhere)).toEqual({ ok: false, error: 'car already parked' });
  });

  it('shows "site closed" first when the site is closed and the car is already parked', async () => {
    const { opening, sites } = await buildTicketingWorld();
    await opening.openTicket(openCommand({ carRef: 'car-a' }));
    sites.closeSite('site-1');
    expect(await opening.openTicket(openCommand({ carRef: 'car-a' }))).toEqual({ ok: false, error: 'site closed' });
  });

  it('lets a car open again after its ticket is closed', async () => {
    const { opening, closing } = await buildTicketingWorld();
    const first = await opening.openTicket(openCommand({ carRef: 'car-a' }));
    if (!first.ok) throw new Error('first open failed');
    await closing.closeTicket('close-request-1', first.value.ticketId, 'exit-site-1');
    expect((await opening.openTicket(openCommand({ carRef: 'car-a' }))).ok).toBe(true);
  });

  it('reports the median and 95th percentile open latency', async () => {
    const { opening } = await buildTicketingWorld(5000);
    const milliseconds: number[] = [];
    for (let attempt = 0; attempt < 2000; attempt += 1) {
      const startedAt = performance.now();
      await opening.openTicket(openCommand());
      milliseconds.push(performance.now() - startedAt);
    }
    milliseconds.sort((a, b) => a - b);
    const median = milliseconds[Math.floor(milliseconds.length * 0.5)] ?? 0;
    const p95 = milliseconds[Math.floor(milliseconds.length * 0.95)] ?? 0;
    console.log(`B5 report: open latency median ${median.toFixed(4)} ms, 95th percentile ${p95.toFixed(4)} ms (2000 opens, in memory)`);
    expect(milliseconds).toHaveLength(2000);
  });
});
