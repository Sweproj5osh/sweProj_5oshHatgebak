import { describe, expect, it } from 'vitest';
import { TEST_TOKEN_SECRET, testApplication, tokenFor } from '../../../entrypoint/test-helpers';
import { respond, type HttpResponse } from '../../../shared/operation-contract';
import { REQUEST_ID_HEADER } from '../../../shared/request-id';
import { createStandInPaymentOperations, createStandInPaymentState } from '../../test-support/stand-in-payment-operations';
import { buildTicketingWorld } from '../../test-support/ticketing-world';
import { DriverScanClient } from '../scanning/driver-scan-client';
import { HttpTicketScanApi } from '../scanning/http-ticket-scan-api';
import type { ServerRequest } from '../server-call';
import { DriverPaymentRefusedError } from './driver-payment-api';
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

function pipelineApi(ticketsClosedUnpaid: readonly { ticketId: string; fee: number }[], providerTimesOutFor: readonly string[] = []) {
  const payments = createStandInPaymentState(ticketsClosedUnpaid, providerTimesOutFor);
  const app = testApplication({ tokenSecret: TEST_TOKEN_SECRET, additionalOperations: createStandInPaymentOperations(payments) });
  const api = new HttpDriverPaymentApi({ handle: app.handle, token: () => tokenFor('driver') });
  return { api, payments, audit: app.audit };
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
    const { api, audit } = pipelineApi([{ ticketId: 'ticket-1', fee: 11 }]);

    const paid = await api.pay('ticket-1', 'd4-http-req-0001');

    expect(paid).toEqual({ payment: PAYMENT });
    const entries = await audit.readByScope({ personId: 'driver-1', role: 'driver' });
    expect(entries.map((entry) => [entry.operation, entry.input])).toEqual([['payments.payInApp', { ticketId: 'ticket-1' }]]);
  });

  it('reads the 202 answer of a pending attempt: the attempt plus "pay later or pay cash", not a refusal and not paid', async () => {
    const { api } = pipelineApi([{ ticketId: 'ticket-2', fee: 19 }], ['ticket-2']);

    const answer = await api.pay('ticket-2', 'd4-http-req-0002');

    expect(answer).toEqual({
      payment: { paymentId: 'payment-1', ticketId: 'ticket-2', amount: 19, method: 'app', state: 'pending' },
      message: 'pay later or pay cash',
    });
  });

  it('shows Amina\'s 409 refusals by their word', async () => {
    const { api } = pipelineApi([]);

    await expect(api.pay('ticket-nobody-closed', 'd4-http-req-0003')).rejects.toEqual(new DriverPaymentRefusedError('ticket not closed'));
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

  it('reads the receipt from Karim\'s real ticketing.receipt read on main, with the plate from the logged join', async () => {
    const world = await buildTicketingWorld({ sites: { 'site-1': 5 }, plates: { 'car-a': 'ABC123' } });
    const app = testApplication({ tokenSecret: TEST_TOKEN_SECRET, clock: world.clock, additionalOperations: world.operations });
    const token = () => tokenFor('driver');
    let scanSerial = 1;
    const scans = new DriverScanClient({ api: new HttpTicketScanApi({ handle: app.handle, token }), createRequestId: () => `d4-scan-${String(scanSerial++).padStart(4, '0')}` });
    const payments = new HttpDriverPaymentApi({ handle: app.handle, token });
    await scans.scanEntry({ siteId: 'site-1', carRef: 'car-a', entryCode: 'entry-site-1' });
    world.clock.advanceByMilliseconds(45 * 60 * 1000);
    const closed = await scans.scanExit('exit-site-1');

    const receipt = await payments.receipt('ticket-1', 'd4-receipt-0001');

    expect(closed.ok).toBe(true);
    expect(receipt).toEqual({ ticketId: 'ticket-1', siteId: 'site-1', openedAt: '2026-11-09T08:00:00.000Z', closedAt: '2026-11-09T08:45:00.000Z', hours: 1, fee: world.price.firstHourFee, plate: 'ABC123' });
  });
});
