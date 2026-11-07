import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { composeInMemoryApplication } from '../../../entrypoint/composition';
import { operations, type PaymentStatus } from '../public';
import { buildTicketingWorld, openCommand } from './testing/ticketing-world';

type World = Awaited<ReturnType<typeof buildTicketingWorld>>;

async function closedTicket(world: World, carRef = 'car-a') {
  const opened = await world.openTicket(openCommand({ carRef }));
  if (!opened.ok) throw new Error('open failed');
  world.clock.advanceByMilliseconds(60 * 60 * 1000);
  const closed = await world.closeTicket(`close-${carRef}`, opened.value.ticketId, 'exit-site-1');
  if (!closed.ok) throw new Error('close failed');
  return closed.value;
}

async function openTicketOnly(world: World, carRef = 'car-open') {
  const opened = await world.openTicket(openCommand({ carRef }));
  if (!opened.ok) throw new Error('open failed');
  return opened.value;
}

let counter = 0;
const change = (world: World, ticketId: string, to: PaymentStatus | string, requestId = `payment-request-${(counter += 1)}`) =>
  world.changePaymentStatus(requestId, ticketId, to as PaymentStatus);

describe('B9 payment status on the ticket', () => {
  it('marks a closed ticket paid and leaves its state closed', async () => {
    const world = await buildTicketingWorld();
    const ticket = await closedTicket(world);
    expect(await change(world, ticket.ticketId, 'paid')).toMatchObject({ ok: true, value: { paymentStatus: 'paid', state: 'closed' } });
  });

  it('refuses to mark an open ticket paid, disputed or waived', async () => {
    const world = await buildTicketingWorld();
    const ticket = await openTicketOnly(world);
    for (const to of ['paid', 'disputed', 'waived']) {
      expect(await change(world, ticket.ticketId, to)).toEqual({ ok: false, error: 'ticket not closed' });
    }
    expect((await world.findById(ticket.ticketId))?.paymentStatus).toBe('unpaid');
  });

  it('allows unpaid to disputed, and unpaid to waived', async () => {
    const world = await buildTicketingWorld();
    const first = await closedTicket(world, 'car-a');
    const second = await closedTicket(world, 'car-b');
    expect(await change(world, first.ticketId, 'disputed')).toMatchObject({ ok: true, value: { paymentStatus: 'disputed' } });
    expect(await change(world, second.ticketId, 'waived')).toMatchObject({ ok: true, value: { paymentStatus: 'waived' } });
  });

  it('lets a disputed ticket be settled as paid or as waived', async () => {
    const world = await buildTicketingWorld();
    const first = await closedTicket(world, 'car-a');
    const second = await closedTicket(world, 'car-b');
    await change(world, first.ticketId, 'disputed');
    await change(world, second.ticketId, 'disputed');
    expect(await change(world, first.ticketId, 'paid')).toMatchObject({ ok: true, value: { paymentStatus: 'paid' } });
    expect(await change(world, second.ticketId, 'waived')).toMatchObject({ ok: true, value: { paymentStatus: 'waived' } });
  });

  it('never moves a paid ticket: not to disputed, waived or unpaid', async () => {
    const world = await buildTicketingWorld();
    const ticket = await closedTicket(world);
    await change(world, ticket.ticketId, 'paid');
    for (const to of ['disputed', 'waived', 'unpaid']) {
      expect(await change(world, ticket.ticketId, to)).toEqual({ ok: false, error: 'status change not allowed' });
    }
    expect((await world.findById(ticket.ticketId))?.paymentStatus).toBe('paid');
  });

  it('never moves a waived ticket', async () => {
    const world = await buildTicketingWorld();
    const ticket = await closedTicket(world);
    await change(world, ticket.ticketId, 'waived');
    for (const to of ['paid', 'disputed', 'unpaid']) {
      expect(await change(world, ticket.ticketId, to)).toEqual({ ok: false, error: 'status change not allowed' });
    }
  });

  it('refuses a change to the status the ticket already has', async () => {
    const world = await buildTicketingWorld();
    const ticket = await closedTicket(world);
    expect(await change(world, ticket.ticketId, 'unpaid')).toEqual({ ok: false, error: 'status change not allowed' });
  });

  it('refuses a status that does not exist', async () => {
    const world = await buildTicketingWorld();
    const ticket = await closedTicket(world);
    const invented = ['left', 'unpaid'].join(' ');
    expect(await change(world, ticket.ticketId, invented)).toEqual({ ok: false, error: 'status change not allowed' });
    expect((await world.findById(ticket.ticketId))?.paymentStatus).toBe('unpaid');
  });

  it('refuses an unknown ticket', async () => {
    const world = await buildTicketingWorld();
    expect(await change(world, 'no-such-ticket', 'paid')).toEqual({ ok: false, error: 'unknown ticket' });
  });

  it('answers the same request id twice with the same ticket instead of refusing the second', async () => {
    const world = await buildTicketingWorld();
    const ticket = await closedTicket(world);
    const first = await change(world, ticket.ticketId, 'paid', 'payment-request-repeat');
    expect(await change(world, ticket.ticketId, 'paid', 'payment-request-repeat')).toEqual(first);
  });

  it('lets exactly one of two simultaneous changes win', async () => {
    const world = await buildTicketingWorld();
    const ticket = await closedTicket(world);
    const results = await world.transact((transaction) =>
      Promise.all([
        world.payments.changePaymentStatus(transaction, 'payment-race-1', ticket.ticketId, 'paid'),
        world.payments.changePaymentStatus(transaction, 'payment-race-2', ticket.ticketId, 'waived'),
      ]),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const status = (await world.findById(ticket.ticketId))?.paymentStatus;
    expect(['paid', 'waived']).toContain(status);
  });

  it('exposes no request that changes a payment status', async () => {
    const world = await buildTicketingWorld();
    const writes = operations(world.dependencies).filter((operation) => operation.kind === 'write').map((operation) => operation.name);
    expect(writes.filter((name) => /payment|status|waive|dispute/i.test(name))).toEqual([]);
    expect(composeInMemoryApplication).toBeDefined();
  });

  it('has the forbidden invented status phrase nowhere in the code', () => {
    const phrase = ['left', 'unpaid'].join(' ');
    const hits = sourceFiles('src').filter((file) => readFileSync(file, 'utf8').toLowerCase().includes(phrase));
    expect(hits).toEqual([]);
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (name === 'node_modules' || name === 'fixtures') return [];
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}
