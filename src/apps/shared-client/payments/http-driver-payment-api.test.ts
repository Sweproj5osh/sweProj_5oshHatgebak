import { describe, expect, it } from 'vitest';
import { TEST_TOKEN_SECRET, testApplication, tokenFor } from '../../../entrypoint/test-helpers';
import { respond, type HttpResponse } from '../../../shared/operation-contract';
import { REQUEST_ID_HEADER } from '../../../shared/request-id';
import { createStandInPaymentOperations, createStandInPaymentState } from '../../test-support/stand-in-payment-operations';
import type { ServerRequest } from '../server-call';
import { DriverPaymentClient } from './driver-payment-client';
import { HttpDriverPaymentApi } from './http-driver-payment-api';

const PAYMENT = { paymentId: 'payment-1', ticketId: 'ticket-1', amount: 11, method: 'app', state: 'paid' };
const RECEIPT = { ticketId: 'ticket-1', siteId: 'site-1', openedAt: '2026-11-09T08:00:00.000Z', closedAt: '2026-11-09T09:00:00.000Z', hours: 1, fee: 11, plate: 'ABC123' };

function recordingApi(answer: HttpResponse) {
  const requests: ServerRequest[] = [];
  const api = new HttpDriverPaymentApi({
    handle: async (request) => {
      requests.push(request);
      return answer;
    },
    token: () => 'driver-token',
  });
  return { api, requests };
}

function pipelineClient(ticketsClosedUnpaid: readonly { ticketId: string; fee: number }[], providerTimesOutFor: readonly string[] = []) {
  const payments = createStandInPaymentState(ticketsClosedUnpaid, providerTimesOutFor);
  const app = testApplication({ tokenSecret: TEST_TOKEN_SECRET, additionalOperations: createStandInPaymentOperations(payments) });
  const api = new HttpDriverPaymentApi({ handle: app.handle, token: () => tokenFor('driver') });
  let serial = 1;
  const client = new DriverPaymentClient({ api, createRequestId: () => `d4-http-req-${String(serial++).padStart(4, '0')}` });
  return { client, payments, audit: app.audit };
}

describe('D4 data layer: pay and receipt over the HTTP entry point', () => {
  it('the pay request carries only the ticket id in the body and the request id in the header, never an amount (Rule I)', async () => {
    const { api, requests } = recordingApi(respond(201, { payment: PAYMENT }));

    const payment = await api.pay('ticket-1', 'request-0001');

    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/payments/app',
        query: {},
        headers: { authorization: 'Bearer driver-token', [REQUEST_ID_HEADER]: 'request-0001' },
        body: { ticketId: 'ticket-1' },
      },
    ]);
    expect(payment).toEqual({ payment: PAYMENT });
  });

  it('is accepted by a server that declares Amina\'s schema { ticketId }: the pipeline would refuse any extra field with 400', async () => {
    const { client, audit } = pipelineClient([{ ticketId: 'ticket-1', fee: 11 }]);

    const paid = await client.pay('ticket-1');

    expect(paid).toEqual({ ok: true, value: { payment: PAYMENT } });
    const entries = await audit.readByScope({ personId: 'driver-1', role: 'driver' });
    expect(entries.map((entry) => [entry.operation, entry.input])).toEqual([['payments.payInApp', { ticketId: 'ticket-1' }]]);
  });

  it('reads the 202 answer of a pending attempt: the attempt plus "pay later or pay cash", not a refusal and not paid', async () => {
    const { client } = pipelineClient([{ ticketId: 'ticket-2', fee: 19 }], ['ticket-2']);

    const answer = await client.pay('ticket-2');

    expect(answer).toEqual({
      ok: true,
      value: { payment: { paymentId: 'payment-1', ticketId: 'ticket-2', amount: 19, method: 'app', state: 'pending' }, message: 'pay later or pay cash' },
    });
    expect(client.pendingPaymentRequestId()).toBeUndefined();
  });

  it('shows Amina\'s 409 refusals by their word', async () => {
    const { client } = pipelineClient([]);

    expect(await client.pay('ticket-nobody-closed')).toEqual({ ok: false, error: 'ticket not closed' });
  });

  it('the receipt is a GET with the request id header, because showing the plate is a logged read (P9)', async () => {
    const { api, requests } = recordingApi(respond(200, { receipt: RECEIPT }));

    const receipt = await api.receipt('ticket-1', 'request-0002');

    expect(requests).toEqual([
      {
        method: 'GET',
        path: '/tickets/receipt',
        query: { ticketId: 'ticket-1' },
        headers: { authorization: 'Bearer driver-token', [REQUEST_ID_HEADER]: 'request-0002' },
      },
    ]);
    expect(receipt).toEqual(RECEIPT);
  });
});
