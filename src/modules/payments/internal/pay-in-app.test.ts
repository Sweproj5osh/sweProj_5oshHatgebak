import { performance } from 'node:perf_hooks';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { composeInMemoryApplication } from '../../../entrypoint/composition';
import { TEST_TOKEN_SECRET, tokenFor, writeRequest } from '../../../entrypoint/test-helpers';
import {
  operations,
  PAY_LATER_OR_PAY_CASH,
  PAYMENTS_TABLE,
  PROVIDER_TIMEOUT_MILLISECONDS,
  TICKET_PAID_TOPIC,
  type ChargeOutcome,
  type PaymentGateway,
  type PaymentRecord,
} from '../public';
import type { StoredPayment } from './ports';
import { buildPaymentsWorld, closedTicket, DRIVER, openTicket, PAY_PATH } from './test-support/payments-test-world';

/**
 * Task C2: paying in the app. Charge through the port with the request id as the idempotency key, record the
 * result, mark the ticket paid, publish "ticket paid". Every test goes through the entry point, so the token, the
 * role, the request id, the audit entry and the outbox are all exercised.
 */
function setUp(overrides: { readonly gateway?: PaymentGateway } = {}) {
  const world = buildPaymentsWorld(overrides);
  const application = composeInMemoryApplication({
    tokenSecret: TEST_TOKEN_SECRET,
    clock: world.clock,
    additionalOperations: world.payments.operations,
  });
  const pay = (requestId: string, ticketId: string) =>
    application.handle(writeRequest(PAY_PATH, 'driver', requestId, { ticketId }));
  const paymentRows = () => application.database.list<StoredPayment>(PAYMENTS_TABLE);
  const auditRows = () => application.audit.readByScope({ personId: 'chair-1', role: 'chair' });
  return { ...world, application, pay, paymentRows, auditRows };
}

function paymentIn(response: { body: unknown }): PaymentRecord {
  return (response.body as { payment: PaymentRecord }).payment;
}

function errorIn(response: { body: unknown }): string {
  return (response.body as { error: string }).error;
}

function messageIn(response: { body: unknown }): string {
  return (response.body as { message: string }).message;
}

let payLatencyMilliseconds = Number.NaN;
let timeoutHonouredMilliseconds = Number.NaN;
let pendingSettledPerRun = Number.NaN;

describe('C2 paying in the app', () => {
  it('pays a closed ticket: paid with a provider reference, ticket shows paid, one row, one audit entry, one event', async () => {
    const { tickets, gateway, application, pay, paymentRows, auditRows } = setUp();
    tickets.seed(closedTicket('ticket-1', 11));

    const started = performance.now();
    const response = await pay('request-pay-0001', 'ticket-1');
    payLatencyMilliseconds = performance.now() - started;

    expect(response.status).toBe(201);
    const payment = paymentIn(response);
    expect(payment).toMatchObject({ ticketId: 'ticket-1', amount: 11, method: 'app', state: 'paid' });
    expect(payment.providerReference).toMatch(/^fake-/);
    expect((await tickets.ticketStatus('ticket-1')).paymentStatus).toBe('paid');

    expect(await paymentRows()).toHaveLength(1);
    expect((await paymentRows())[0]).toMatchObject({
      paymentId: payment.paymentId,
      requestId: 'request-pay-0001',
      payerId: DRIVER,
      recordedAt: '2026-11-06T10:05:00.000Z',
    });
    expect(gateway.chargeCallCount('request-pay-0001')).toBe(1);

    const audit = await auditRows();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ operation: 'payments.payInApp', personId: DRIVER, requestId: 'request-pay-0001' });

    const events = application.outbox.allEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      topic: TICKET_PAID_TOPIC,
      payload: { ticketId: 'ticket-1', paymentId: payment.paymentId, amount: 11, providerReference: payment.providerReference },
    });
  });

  it('records a pending answer as a pending attempt with the provider reference, leaves the ticket unpaid and publishes nothing yet', async () => {
    const { tickets, application, pay, paymentRows } = setUp();
    tickets.seed(closedTicket('ticket-1', 13));

    const response = await pay('request-pay-0002', 'ticket-1');

    expect(response.status).toBe(202);
    expect(paymentIn(response).state).toBe('pending');
    expect(messageIn(response)).toBe(PAY_LATER_OR_PAY_CASH);
    expect((await tickets.ticketStatus('ticket-1')).paymentStatus).toBe('unpaid');
    expect(await paymentRows()).toHaveLength(1);
    expect((await paymentRows())[0]).toMatchObject({ state: 'pending', providerReference: expect.stringMatching(/^fake-/) });
    expect(application.outbox.allEvents()).toHaveLength(0);
  });

  it('P18: a ticket with a pending attempt refuses a second charge under a new request id', async () => {
    const { tickets, gateway, pay, paymentRows } = setUp();
    tickets.seed(closedTicket('ticket-1', 13));

    expect((await pay('request-pay-0011', 'ticket-1')).status).toBe(202);
    const second = await pay('request-pay-0012', 'ticket-1');

    expect(second.status).toBe(409);
    expect(errorIn(second)).toBe('payment pending, try again shortly');
    expect(await paymentRows()).toHaveLength(1);
    expect(gateway.chargeCallCount()).toBe(1);
    expect((await tickets.ticketStatus('ticket-1')).paymentStatus).toBe('unpaid');
  });

  describe('a late answer is recorded at reconciliation (P18, item 7)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** Reconciliation runs in its own unit of work, as the scheduler's job will; here the test opens it. */
    async function settleOnce(application: ReturnType<typeof setUp>['application'], payments: ReturnType<typeof setUp>['payments']): Promise<number> {
      const transaction = application.database.begin();
      const settled = await payments.ledgerBoundTo(transaction, application.outbox.publisherBoundTo(transaction.tables)).settlePendingPayments();
      await transaction.commit();
      return settled;
    }

    it('a slow provider that says paid after the timer: the attempt row written before the timer is marked paid and the ticket is paid', async () => {
      const { tickets, gateway, application, payments, pay, paymentRows } = setUp();
      tickets.seed(closedTicket('ticket-1', 19));
      const paying = pay('request-pay-0016', 'ticket-1');
      await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MILLISECONDS);
      expect((await paying).status).toBe(202);
      await vi.advanceTimersByTimeAsync(1_000);

      const settled = await settleOnce(application, payments);

      expect(settled).toBe(1);
      expect((await paymentRows())[0]).toMatchObject({ state: 'paid', requestId: 'request-pay-0016', providerReference: expect.stringMatching(/^fake-/) });
      expect((await tickets.ticketStatus('ticket-1')).paymentStatus).toBe('paid');
      expect(application.outbox.allEvents().map((event) => event.topic)).toEqual([TICKET_PAID_TOPIC]);
      expect(gateway.chargeCallCount('request-pay-0016')).toBe(2);
      pendingSettledPerRun = settled;
    });

    it('a pending answer the provider later declines: the attempt fails, the ticket stays unpaid and may be paid again', async () => {
      const { tickets, gateway, application, payments, pay, paymentRows } = setUp();
      tickets.seed(closedTicket('ticket-1', 13));
      const pending = paymentIn(await pay('request-pay-0017', 'ticket-1'));
      gateway.settle(pending.providerReference ?? '', 'declined');

      expect(await settleOnce(application, payments)).toBe(1);

      expect((await paymentRows())[0]).toMatchObject({ state: 'failed', settledAt: '2026-11-06T10:05:00.000Z' });
      expect((await tickets.ticketStatus('ticket-1')).paymentStatus).toBe('unpaid');
      tickets.seed(closedTicket('ticket-1', 11));
      expect((await pay('request-pay-0018', 'ticket-1')).status).toBe(201);
      expect(await paymentRows()).toHaveLength(2);
    });

    it('a provider still pending settles nothing and leaves the attempt pending', async () => {
      const { tickets, application, payments, pay, paymentRows } = setUp();
      tickets.seed(closedTicket('ticket-1', 13));
      await pay('request-pay-0019', 'ticket-1');

      expect(await settleOnce(application, payments)).toBe(0);
      expect((await paymentRows())[0]?.state).toBe('pending');
    });
  });

  describe('Rule B: a provider answer outside paid, declined and pending is an adapter error', () => {
    /** An adapter that lets the provider's own word through; the cast is the adapter error under test. */
    function gatewaySaying(outcome: string): PaymentGateway {
      return {
        charge: async () => ({ outcome: outcome as ChargeOutcome, providerReference: 'fake-raw-1' }),
        status: async () => 'pending',
      };
    }

    const throwingGateway: PaymentGateway = {
      charge: async () => {
        throw new Error('connection reset');
      },
      status: async () => 'pending',
    };

    it('is recorded as a pending attempt carrying the raw outcome, not on the audit entry, and answered 202, never 201', async () => {
      const { tickets, application, pay, paymentRows, auditRows } = setUp({ gateway: gatewaySaying('authorized') });
      tickets.seed(closedTicket('ticket-1', 11));

      const response = await pay('request-pay-0014', 'ticket-1');

      expect(response.status).toBe(202);
      expect(paymentIn(response).state).toBe('pending');
      expect((await paymentRows())[0]).toMatchObject({ state: 'pending', rawProviderOutcome: 'authorized' });
      expect(JSON.stringify(await auditRows())).not.toContain('authorized');
      expect((await tickets.ticketStatus('ticket-1')).paymentStatus).toBe('unpaid');
      expect(application.outbox.allEvents()).toHaveLength(0);
    });

    it('treats a throwing adapter the same way: the attempt stays pending with the error as its raw outcome', async () => {
      const { tickets, pay, paymentRows } = setUp({ gateway: throwingGateway });
      tickets.seed(closedTicket('ticket-1', 11));

      const response = await pay('request-pay-0015', 'ticket-1');

      expect(response.status).toBe(202);
      expect((await paymentRows())[0]).toMatchObject({ state: 'pending', rawProviderOutcome: 'provider error: connection reset' });
    });
  });

  describe('C4: the 8-second timer is the ledger\'s', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('gives the slow provider exactly 8 seconds, then records a pending attempt, keeps the ticket unpaid and says pay later or pay cash', async () => {
      const { tickets, gateway, pay, paymentRows } = setUp();
      tickets.seed(closedTicket('ticket-1', 19));
      let answered = false;
      const paying = pay('request-pay-0013', 'ticket-1').then((response) => {
        answered = true;
        return response;
      });

      await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MILLISECONDS - 1);
      expect(answered).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const response = await paying;
      timeoutHonouredMilliseconds = PROVIDER_TIMEOUT_MILLISECONDS;

      expect(response.status).toBe(202);
      expect(messageIn(response)).toBe(PAY_LATER_OR_PAY_CASH);
      expect(paymentIn(response).state).toBe('pending');
      expect((await tickets.ticketStatus('ticket-1')).paymentStatus).toBe('unpaid');
      expect((await paymentRows())[0]).toMatchObject({ state: 'pending', requestId: 'request-pay-0013', rawProviderOutcome: 'timed out' });
      expect((await paymentRows())[0]?.providerReference).toBeUndefined();
      expect(gateway.chargeCallCount()).toBe(1);
    });
  });

  it('refuses a declined charge and keeps no row, no audit entry and no event', async () => {
    const { tickets, application, pay, paymentRows, auditRows } = setUp();
    tickets.seed(closedTicket('ticket-1', 12));

    const response = await pay('request-pay-0003', 'ticket-1');

    expect(response.status).toBe(402);
    expect(errorIn(response)).toBe('declined');
    expect((await tickets.ticketStatus('ticket-1')).paymentStatus).toBe('unpaid');
    expect(await paymentRows()).toHaveLength(0);
    expect(await auditRows()).toHaveLength(0);
    expect(application.outbox.allEvents()).toHaveLength(0);
  });

  it('refuses to pay a ticket that is still open', async () => {
    const { tickets, pay, paymentRows } = setUp();
    tickets.seed(openTicket('ticket-1'));

    const response = await pay('request-pay-0004', 'ticket-1');

    expect(response.status).toBe(409);
    expect(errorIn(response)).toBe('ticket not closed');
    expect(await paymentRows()).toHaveLength(0);
  });

  it('refuses to pay a ticket that is already paid, so a second request id cannot charge it again', async () => {
    const { tickets, gateway, pay, paymentRows } = setUp();
    tickets.seed(closedTicket('ticket-1', 11));

    expect((await pay('request-pay-0005', 'ticket-1')).status).toBe(201);
    const again = await pay('request-pay-0006', 'ticket-1');

    expect(again.status).toBe(409);
    expect(errorIn(again)).toBe('nothing to pay');
    expect(await paymentRows()).toHaveLength(1);
    expect(gateway.chargeCallCount()).toBe(1);
  });

  it("refuses to let a driver pay another driver's ticket", async () => {
    const { tickets, pay, paymentRows } = setUp();
    tickets.seed(closedTicket('ticket-1', 11, { driverRef: 'driver-2' }));

    const response = await pay('request-pay-0007', 'ticket-1');

    expect(response.status).toBe(403);
    expect(errorIn(response)).toBe('not your ticket');
    expect(await paymentRows()).toHaveLength(0);
  });

  it('is open to drivers only: the permission table refuses an attendant before the ledger runs', async () => {
    const { tickets, application, paymentRows } = setUp();
    tickets.seed(closedTicket('ticket-1', 11));

    const response = await application.handle({
      method: 'POST',
      path: PAY_PATH,
      query: {},
      headers: { authorization: `Bearer ${tokenFor('attendant')}`, 'x-request-id': 'request-pay-0008' },
      body: { ticketId: 'ticket-1' },
    });

    expect(response.status).toBe(403);
    expect(await paymentRows()).toHaveLength(0);
  });

  it('leaves zero audit rows for a body that fails validation (fitness function F5)', async () => {
    const { application, auditRows } = setUp();
    const response = await application.handle(writeRequest(PAY_PATH, 'driver', 'request-pay-0009', {}));
    expect(response.status).toBe(400);
    expect(await auditRows()).toHaveLength(0);
  });

  it('registers through operations(dependencies) beside the composed registry, as the composition root will call it (P4)', async () => {
    const { clock, tickets, gateway } = buildPaymentsWorld();
    tickets.seed(closedTicket('ticket-1', 11));
    const application = composeInMemoryApplication({
      tokenSecret: TEST_TOKEN_SECRET,
      clock,
      additionalOperations: operations({ gateway, ticketDesk: tickets, ticketQuery: tickets, clock }),
    });

    expect(application.registry.writes().map((operation) => operation.name)).toContain('payments.payInApp');
    const response = await application.handle(writeRequest(PAY_PATH, 'driver', 'request-pay-0010', { ticketId: 'ticket-1' }));
    expect(response.status).toBe(201);
  });

  afterAll(() => {
    console.log(`C2 report: pay latency ${payLatencyMilliseconds.toFixed(1)} ms (one pay through the entry point on the in-memory stack)`);
    console.log(`C5 report (by-product of P18 item 7): pending settled per run ${pendingSettledPerRun}`);
    console.log(`C4 report: timeout honoured at ${(timeoutHonouredMilliseconds / 1000).toFixed(3)} s (the ledger's timer, measured with fake timers)`);
  });
});
