import { describe, expect, it } from 'vitest';
import { composeInMemoryApplication } from '../../../entrypoint/composition';
import { foundationOperations } from '../../../entrypoint/operations/foundation-operations';
import { TEST_TOKEN_SECRET, writeRequest } from '../../../entrypoint/test-helpers';
import { refuse, type WriteOperation } from '../../../shared/operation-contract';
import { createTicketingOperations, type TicketPaymentStatus } from '../public';
import { buildTicketingWorld, openCommand } from './testing/ticketing-world';

const HOUR = 60 * 60 * 1000;

type World = Awaited<ReturnType<typeof buildTicketingWorld>>;

async function closedTicket(world: World) {
  const opened = await world.openTicket(openCommand({ carRef: 'car-a' }));
  if (!opened.ok) throw new Error('open failed');
  world.clock.advanceByMilliseconds(HOUR);
  const closed = await world.closeTicket('close-request-1', opened.value.ticketId, 'exit-site-1');
  if (!closed.ok) throw new Error('close failed');
  return closed.value;
}

/**
 * P1 and ADR-13: the ticket store writes through the unit of work it is handed, so a ticket changed by a caller whose
 * transaction rolls back is unchanged afterwards. Before this change the store kept private maps, and "Amina's payment
 * rolled back while the ticket stayed paid" (section 17, P1).
 */
describe('ticket writes live inside the caller\'s unit of work (P1)', () => {
  it('a payment status change rolls back with the transaction that made it', async () => {
    const world = await buildTicketingWorld();
    const ticket = await closedTicket(world);
    const transaction = world.database.begin();
    const changed = await world.payments.changePaymentStatus(transaction, 'payment-request-1', ticket.ticketId, 'paid');
    expect(changed).toMatchObject({ ok: true, value: { paymentStatus: 'paid' } });
    await transaction.rollback();
    expect((await world.findById(ticket.ticketId))?.paymentStatus).toBe('unpaid');
  });

  it('an opened ticket is invisible outside its transaction until the transaction commits', async () => {
    const world = await buildTicketingWorld();
    const transaction = world.database.begin();
    const opened = await world.opening.openTicket(transaction, openCommand({ carRef: 'car-a' }));
    if (!opened.ok) throw new Error('open failed');
    expect(await world.findById(opened.value.ticketId)).toBeUndefined();
    await transaction.commit();
    expect((await world.findById(opened.value.ticketId))?.state).toBe('open');
  });

  it('through the entry point, a payment that marks the ticket paid and then fails leaves the ticket unpaid and no audit entry', async () => {
    const world = await buildTicketingWorld();
    const app = composeInMemoryApplication({
      tokenSecret: TEST_TOKEN_SECRET,
      clock: world.clock,
      operations: [...foundationOperations, ...createTicketingOperations(world), paymentThatFailsAfterMarkingPaid(world.payments)],
    });
    const opened = await app.handle(writeRequest('/tickets/open', 'driver', 'open-request-1', { siteId: 'site-1', carRef: 'car-a', entryCode: 'entry-site-1' }));
    expect(opened.status, JSON.stringify(opened.body)).toBe(201);
    const ticketId = (opened.body as { ticket: { ticketId: string } }).ticket.ticketId;
    world.clock.advanceByMilliseconds(HOUR);
    await app.handle(writeRequest('/tickets/close', 'driver', 'close-request-1', { ticketId, exitCode: 'exit-site-1' }));

    const failed = await app.handle(writeRequest('/test/failing-payment', 'driver', 'payment-request-1', { ticketId }));
    expect(failed.status).toBe(502);
    expect((await world.store.findById(app.database, ticketId))?.paymentStatus).toBe('unpaid');
    const operations = (await app.audit.readByScope({ personId: 'chair-1', role: 'chair' })).map((row) => row.operation);
    expect(operations).toEqual(['ticketing.openTicket', 'ticketing.closeTicket']);
  });
});

/** Stands in for a payment write whose provider answers after the ticket was marked: the refusal must undo the mark. */
function paymentThatFailsAfterMarkingPaid(payments: TicketPaymentStatus): WriteOperation {
  return {
    kind: 'write',
    name: 'test.failingPayment',
    method: 'POST',
    path: '/test/failing-payment',
    allowedRoles: ['driver'],
    bodySchema: { fields: { ticketId: 'string' } },
    examples: { valid: { ticketId: 'ticket-1' }, invalid: {} },
    async handle({ requestId, body, transaction }) {
      const marked = await payments.changePaymentStatus(transaction, requestId, String(body['ticketId']), 'paid');
      if (!marked.ok) {
        return { response: refuse(409, marked.error) };
      }
      return { response: refuse(502, 'provider unavailable') };
    },
  };
}
