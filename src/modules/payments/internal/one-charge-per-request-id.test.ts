import { afterAll, describe, expect, it } from 'vitest';
import { InMemoryDatabase } from '../../../adapters/in-memory/in-memory-database';
import { InMemoryOutboxStore } from '../../../adapters/in-memory/in-memory-outbox-store';
import { composeInMemoryApplication } from '../../../entrypoint/composition';
import { TEST_ADDRESS, TEST_TOKEN_SECRET, tokenFor, writeRequest } from '../../../entrypoint/test-helpers';
import type { RequestId } from '../../../shared/request-id';
import { PAYMENTS_TABLE } from '../public';
import type { StoredPayment } from './ports';
import { buildPaymentsWorld, closedTicket, DRIVER, PAY_PATH } from './test-support/payments-test-world';

/**
 * Task C3: one charge per request id. Two pays with one id give one payment row and one call to the provider.
 * Checked at both levels: through the entry point (its stored response answers the repeat) and straight at the
 * ledger (the row the id already created answers the repeat).
 */
const ONE_ID: RequestId = 'request-repeat-0001';

const results: Record<'entry point' | 'ledger', 'PASS' | 'FAIL'> = { 'entry point': 'FAIL', ledger: 'FAIL' };

describe('C3 one charge per request id', () => {
  it('through the entry point: two pays with one id give identical answers, one row and one charge', async () => {
    const { clock, tickets, gateway, payments } = buildPaymentsWorld();
    tickets.seed(closedTicket('ticket-1', 11));
    const application = composeInMemoryApplication({ tokenSecret: TEST_TOKEN_SECRET, clock, additionalOperations: payments.operations });

    const first = await application.handle(writeRequest(PAY_PATH, 'driver', ONE_ID, { ticketId: 'ticket-1' }));
    const second = await application.handle(writeRequest(PAY_PATH, 'driver', ONE_ID, { ticketId: 'ticket-1' }));

    expect(first.status).toBe(201);
    expect(second).toEqual(first);
    expect(await application.database.list<StoredPayment>(PAYMENTS_TABLE)).toHaveLength(1);
    expect(gateway.chargeCallCount(ONE_ID)).toBe(1);
    expect(gateway.chargeCallCount()).toBe(1);
    expect(await application.audit.readByScope({ personId: 'chair-1', role: 'chair' })).toHaveLength(1);
    expect(application.outbox.allEvents()).toHaveLength(1);
    results['entry point'] = 'PASS';
  });

  it('at the ledger itself: a repeat of a committed pay returns the recorded payment without a second charge', async () => {
    const { clock, tickets, gateway, payments } = buildPaymentsWorld();
    tickets.seed(closedTicket('ticket-1', 11));
    const database = new InMemoryDatabase();
    const outbox = new InMemoryOutboxStore(database, clock);

    const firstTransaction = database.begin();
    const first = await payments.ledgerBoundTo(firstTransaction, outbox.publisherBoundTo(firstTransaction.tables)).payInApp(ONE_ID, 'ticket-1', DRIVER);
    await firstTransaction.commit();

    const secondTransaction = database.begin();
    const second = await payments.ledgerBoundTo(secondTransaction, outbox.publisherBoundTo(secondTransaction.tables)).payInApp(ONE_ID, 'ticket-1', DRIVER);
    await secondTransaction.commit();

    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(await database.list<StoredPayment>(PAYMENTS_TABLE)).toHaveLength(1);
    expect(gateway.chargeCallCount(ONE_ID)).toBe(1);
    expect(outbox.allEvents()).toHaveLength(1);
    results.ledger = 'PASS';
  });

  it('stages the payment row inside the write\'s unit of work: nothing is committed until the unit of work commits (ADR-13)', async () => {
    const { clock, tickets, payments } = buildPaymentsWorld();
    tickets.seed(closedTicket('ticket-1', 11));
    const database = new InMemoryDatabase();
    const outbox = new InMemoryOutboxStore(database, clock);

    const transaction = database.begin();
    const paid = await payments.ledgerBoundTo(transaction, outbox.publisherBoundTo(transaction.tables)).payInApp(ONE_ID, 'ticket-1', DRIVER);

    expect(paid.ok).toBe(true);
    expect(await database.list<StoredPayment>(PAYMENTS_TABLE)).toHaveLength(0);
    await transaction.commit();
    expect(await database.list<StoredPayment>(PAYMENTS_TABLE)).toHaveLength(1);
  });

  it('a pay that was rolled back leaves no row, so the same id on retry charges once and lands once', async () => {
    const { clock, tickets, gateway, payments } = buildPaymentsWorld();
    tickets.seed(closedTicket('ticket-1', 11));
    const database = new InMemoryDatabase();
    const outbox = new InMemoryOutboxStore(database, clock);

    const abandoned = database.begin();
    await payments.ledgerBoundTo(abandoned, outbox.publisherBoundTo(abandoned.tables)).payInApp(ONE_ID, 'ticket-1', DRIVER);
    await abandoned.rollback();
    tickets.seed(closedTicket('ticket-1', 11));

    const retry = database.begin();
    const retried = await payments.ledgerBoundTo(retry, outbox.publisherBoundTo(retry.tables)).payInApp(ONE_ID, 'ticket-1', DRIVER);
    await retry.commit();

    expect(retried.ok).toBe(true);
    expect(await database.list<StoredPayment>(PAYMENTS_TABLE)).toHaveLength(1);
    expect(gateway.chargeCallCount(ONE_ID)).toBe(2);
    expect(retried.ok && retried.value.providerReference).toBeTruthy();
  });

  it('P19 at the ledger: the same id for another ticket of the same payer is refused, not answered with the earlier payment', async () => {
    const { clock, tickets, gateway, payments } = buildPaymentsWorld();
    tickets.seed(closedTicket('ticket-1', 11));
    tickets.seed(closedTicket('ticket-2', 11));
    const database = new InMemoryDatabase();
    const outbox = new InMemoryOutboxStore(database, clock);

    const first = database.begin();
    await payments.ledgerBoundTo(first, outbox.publisherBoundTo(first.tables)).payInApp(ONE_ID, 'ticket-1', DRIVER);
    await first.commit();
    const reused = database.begin();
    const refused = await payments.ledgerBoundTo(reused, outbox.publisherBoundTo(reused.tables)).payInApp(ONE_ID, 'ticket-2', DRIVER);

    expect(refused).toEqual({ ok: false, error: 'request id reused for another ticket or payer' });
    expect(gateway.chargeCallCount()).toBe(1);
  });

  it('P19 through the entry point: another payer reusing the id reaches the ledger (another response key) and is refused with 409', async () => {
    const { clock, tickets, gateway, payments } = buildPaymentsWorld();
    tickets.seed(closedTicket('ticket-1', 11));
    tickets.seed({ ...closedTicket('ticket-2', 11), driverRef: 'driver-2' });
    const application = composeInMemoryApplication({ tokenSecret: TEST_TOKEN_SECRET, clock, additionalOperations: payments.operations });

    expect((await application.handle(writeRequest(PAY_PATH, 'driver', ONE_ID, { ticketId: 'ticket-1' }))).status).toBe(201);
    const otherPayer = await application.handle({
      method: 'POST',
      path: PAY_PATH,
      query: {},
      headers: { authorization: `Bearer ${tokenFor('driver', { personId: 'driver-2' })}`, 'x-request-id': ONE_ID },
      address: TEST_ADDRESS,
      body: { ticketId: 'ticket-2' },
    });

    expect(otherPayer.status).toBe(409);
    expect(otherPayer.body).toEqual({ error: 'request id reused for another ticket or payer' });
    expect(await application.database.list<StoredPayment>(PAYMENTS_TABLE)).toHaveLength(1);
    expect(gateway.chargeCallCount()).toBe(1);
  });

  it('two concurrent pays of one ticket under two request ids give one row and one charge: the ticket is locked per attempt', async () => {
    const { clock, tickets, gateway, payments } = buildPaymentsWorld();
    tickets.seed(closedTicket('ticket-1', 11));
    const application = composeInMemoryApplication({ tokenSecret: TEST_TOKEN_SECRET, clock, additionalOperations: payments.operations });

    const [first, second] = await Promise.all([
      application.handle(writeRequest(PAY_PATH, 'driver', 'request-race-0001', { ticketId: 'ticket-1' })),
      application.handle(writeRequest(PAY_PATH, 'driver', 'request-race-0002', { ticketId: 'ticket-1' })),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(await application.database.list<StoredPayment>(PAYMENTS_TABLE)).toHaveLength(1);
    expect(gateway.chargeCallCount()).toBe(1);
    expect((await tickets.statusOf('ticket-1')).paymentStatus).toBe('paid');
  });

  it('a declined attempt releases the ticket, so the driver may try again under a new request id', async () => {
    const { clock, tickets, gateway, payments } = buildPaymentsWorld();
    tickets.seed(closedTicket('ticket-1', 12));
    const application = composeInMemoryApplication({ tokenSecret: TEST_TOKEN_SECRET, clock, additionalOperations: payments.operations });

    expect((await application.handle(writeRequest(PAY_PATH, 'driver', 'request-declined-0001', { ticketId: 'ticket-1' }))).status).toBe(402);
    tickets.seed(closedTicket('ticket-1', 11));
    const retried = await application.handle(writeRequest(PAY_PATH, 'driver', 'request-declined-0002', { ticketId: 'ticket-1' }));

    expect(retried.status).toBe(201);
    expect(gateway.chargeCallCount()).toBe(2);
  });

  afterAll(() => {
    console.log(`C3 report: entry point ${results['entry point']}; ledger ${results.ledger}`);
  });
});
