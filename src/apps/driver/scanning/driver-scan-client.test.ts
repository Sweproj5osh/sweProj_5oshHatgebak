import { describe, expect, it } from 'vitest';
import { DriverScanClient } from './driver-scan-client';
import { InMemoryTicketScanApi } from './in-memory-ticket-scan-api';

function clientWith(api: InMemoryTicketScanApi, requestIds: string[]): DriverScanClient {
  let index = 0;
  return new DriverScanClient({
    api,
    createRequestId: () => {
      const next = requestIds[index];
      if (next === undefined) {
        throw new Error(`test ran out of request ids at index ${index}`);
      }
      index += 1;
      return next;
    },
  });
}

describe('D3 Driver App scanning', () => {
  it('scan twice quickly with one pending request id opens exactly one ticket', async () => {
    const api = new InMemoryTicketScanApi();
    const client = clientWith(api, ['scan-req-0001']);

    const [first, second] = await Promise.all([
      client.scanEntry('site-7', 'entry-site-7'),
      client.scanEntry('site-7', 'entry-site-7'),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.ticketId).toBe(second.value.ticketId);
      expect(first.value.status).toBe('opened');
    }
    expect(api.ticketsOpenedCount()).toBe(1);
    expect(client.activeTicket()).toBe('ticket-1');
    expect(client.pendingEntryRequestId()).toBeUndefined();

    console.log(`D3 report: duplicate tickets in test = ${api.ticketsOpenedCount() - 1}`);
  });

  it('airplane mode mid-scan then retry with the kept request id still opens one ticket', async () => {
    const api = new InMemoryTicketScanApi();
    const client = clientWith(api, ['scan-req-0002']);

    api.dropNextAnswers(1);

    const lost = await client.scanEntry('site-9', 'entry-site-9');
    expect(lost.ok).toBe(false);
    if (!lost.ok) {
      expect(lost.error).toBe('connection lost');
      expect(lost.requestId).toBe('scan-req-0002');
    }
    expect(client.pendingEntryRequestId()).toBe('scan-req-0002');
    expect(api.ticketsOpenedCount()).toBe(1);

    const retry = await client.scanEntry('site-9', 'entry-site-9');
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.value.ticketId).toBe('ticket-1');
    }
    expect(api.ticketsOpenedCount()).toBe(1);
    expect(client.pendingEntryRequestId()).toBeUndefined();

    console.log(`D3 report: duplicate tickets after airplane retry = ${api.ticketsOpenedCount() - 1}`);
  });

  it('closes from the exit code and keeps the close request id across a dropped answer', async () => {
    const api = new InMemoryTicketScanApi();
    const client = clientWith(api, ['scan-req-0003', 'scan-req-0004']);

    const opened = await client.scanEntry('site-4', 'entry-site-4');
    expect(opened.ok).toBe(true);

    api.dropNextAnswers(1);
    const lostClose = await client.scanExit('site-4', 'exit-site-4');
    expect(lostClose.ok).toBe(false);
    expect(client.pendingExitRequestId()).toBe('scan-req-0004');
    expect(client.activeTicket()).toBe('ticket-1');

    const closed = await client.scanExit('site-4', 'exit-site-4');
    expect(closed.ok).toBe(true);
    if (closed.ok) {
      expect(closed.value.status).toBe('closed');
      expect(closed.value.ticketId).toBe('ticket-1');
    }
    expect(client.activeTicket()).toBeUndefined();
    expect(client.pendingExitRequestId()).toBeUndefined();
    expect(api.ticketsOpenedCount()).toBe(1);
  });
});
