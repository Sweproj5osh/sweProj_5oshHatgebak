import { describe, expect, it } from 'vitest';
import type { RequestId } from '../../../shared/request-id';
import { InMemoryDriverPaymentApi } from '../../test-support/in-memory-driver-payment-api';
import { ServerTransportError } from '../server-call';
import { DriverPaymentRefusedError, PAY_LATER_OR_PAY_CASH, type DriverPaymentApi } from './driver-payment-api';
import { DriverPaymentClient } from './driver-payment-client';

const TICKET_ID = 'ticket-7';
const RECEIPT = {
  ticketId: TICKET_ID,
  siteId: 'site-12',
  openedAt: '2026-11-06T10:00:00Z',
  closedAt: '2026-11-06T10:30:00Z',
  hours: 1,
  fee: 20,
  plate: 'ABC-123',
};

function buildClient(api: DriverPaymentApi = new InMemoryDriverPaymentApi()) {
  let serial = 1;
  const client = new DriverPaymentClient({
    api,
    createRequestId: () => `d4-req-${String(serial++).padStart(4, '0')}`,
  });
  return { client };
}

class AnswerLosingApi implements DriverPaymentApi {
  readonly seenRequestIds: RequestId[] = [];
  readonly plan: boolean[];

  constructor(
    private readonly inner: DriverPaymentApi,
    plan: boolean[] = [],
  ) {
    this.plan = plan;
  }

  async pay(ticketId: string, requestId: RequestId) {
    this.seenRequestIds.push(requestId);
    const result = await this.inner.pay(ticketId, requestId);
    this.loseAnswer();
    return result;
  }

  async receipt(ticketId: string, requestId: RequestId) {
    return this.inner.receipt(ticketId, requestId);
  }

  private loseAnswer(): void {
    if (this.plan.shift() === true) {
      throw new ServerTransportError();
    }
  }
}

describe('D4 Driver App payment and receipt client', () => {
  it('pays a closed ticket with one tap and shows the receipt with the plate; the fee is the server figure', async () => {
    const { client } = buildClient(new InMemoryDriverPaymentApi([{ ...RECEIPT, paid: false }]));

    const payment = await client.pay(TICKET_ID);
    const receipt = await client.receipt(TICKET_ID);

    expect(payment).toEqual({
      ok: true,
      value: { payment: { paymentId: 'payment-1', ticketId: TICKET_ID, amount: 20, method: 'app', state: 'paid' } },
    });
    expect(receipt).toEqual({ ok: true, value: RECEIPT });
  });

  it('keeps the same request id while a connection loss is retried, so the ticket is charged once', async () => {
    const api = new AnswerLosingApi(new InMemoryDriverPaymentApi([{ ...RECEIPT, ticketId: 'ticket-9', fee: 18, paid: false }]), [true, false]);
    const { client } = buildClient(api);

    const lost = await client.pay('ticket-9');
    expect(lost).toEqual({ ok: false, error: 'connection lost', requestId: 'd4-req-0001' });
    expect(client.pendingPaymentRequestId()).toBe('d4-req-0001');

    const retry = await client.pay('ticket-9');
    expect(retry).toMatchObject({ ok: true, value: { payment: { ticketId: 'ticket-9', amount: 18, state: 'paid' } } });
    expect(client.pendingPaymentRequestId()).toBeUndefined();
    expect(api.seenRequestIds).toEqual(['d4-req-0001', 'd4-req-0001']);
  });

  it('shows the server\'s "pay later or pay cash" with a pending attempt, and never says the ticket is paid (P18)', async () => {
    const pending = { paymentId: 'payment-3', ticketId: 'ticket-3', amount: 19, method: 'app', state: 'pending' } as const;
    const api: DriverPaymentApi = {
      pay: async () => ({ payment: pending, message: PAY_LATER_OR_PAY_CASH }),
      receipt: async () => RECEIPT,
    };

    const { client } = buildClient(api);

    expect(await client.pay('ticket-3')).toEqual({ ok: true, value: { payment: pending, message: 'pay later or pay cash' } });
    expect(client.pendingPaymentRequestId()).toBeUndefined();
  });

  it('shows a second tap during a pending attempt as the server refusal', async () => {
    const api: DriverPaymentApi = {
      pay: async () => {
        throw new DriverPaymentRefusedError('payment pending, try again shortly');
      },
      receipt: async () => RECEIPT,
    };

    expect(await buildClient(api).client.pay('ticket-3')).toEqual({ ok: false, error: 'payment pending, try again shortly' });
  });
});
