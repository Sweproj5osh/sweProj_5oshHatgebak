import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../../shared/clock';
import { composeInMemoryApplication } from '../../../entrypoint/composition';
import { foundationOperations } from '../../../entrypoint/operations/foundation-operations';
import { TEST_TOKEN_SECRET, tokenFor } from '../../../entrypoint/test-helpers';
import { DriverScanClient } from './driver-scan-client';
import { HttpTicketScanApi } from './http-ticket-scan-api';
import {
  createStandInDriverTicketOperations,
  createStandInTicketDeskState,
} from './stand-in-driver-ticket-operations';

function buildStack(dropSuccessfulAnswers = { remaining: 0 }) {
  const ticketState = createStandInTicketDeskState();
  const app = composeInMemoryApplication({
    tokenSecret: TEST_TOKEN_SECRET,
    clock: new FixedClock(new Date('2026-11-05T12:00:00Z')),
    operations: [...foundationOperations, ...createStandInDriverTicketOperations(ticketState)],
  });

  const api = new HttpTicketScanApi({
    handle: app.handle,
    authorizationHeader: () => `Bearer ${tokenFor('driver')}`,
    dropSuccessfulAnswers,
  });

  let requestSerial = 1;
  const client = new DriverScanClient({
    api,
    createRequestId: () => `scan-req-${String(requestSerial++).padStart(4, '0')}`,
  });

  return { client, ticketState, audit: app.audit, dropSuccessfulAnswers };
}

describe('D3 Driver App scanning over the HTTP entry point', () => {
  it('scan twice quickly opens one ticket and one audit entry', async () => {
    const { client, ticketState, audit } = buildStack();

    const [first, second] = await Promise.all([
      client.scanEntry('site-7', 'entry-site-7'),
      client.scanEntry('site-7', 'entry-site-7'),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.ticketId).toBe(second.value.ticketId);
    }
    expect(ticketState.ticketsOpened).toBe(1);

    const entries = await audit.readByScope({ personId: 'driver-1', role: 'driver' });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.operation).toBe('driver.openTicket');

    console.log(`D3 report: duplicate tickets in test = ${ticketState.ticketsOpened - 1}`);
  });

  it('airplane mode mid-scan then retry uses the kept request id and still one ticket', async () => {
    const dropSuccessfulAnswers = { remaining: 1 };
    const { client, ticketState, audit } = buildStack(dropSuccessfulAnswers);

    const lost = await client.scanEntry('site-9', 'entry-site-9');
    expect(lost.ok).toBe(false);
    if (!lost.ok) {
      expect(lost.requestId).toBe('scan-req-0001');
    }
    expect(client.pendingEntryRequestId()).toBe('scan-req-0001');
    expect(ticketState.ticketsOpened).toBe(1);

    const retry = await client.scanEntry('site-9', 'entry-site-9');
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.value.ticketId).toBe('ticket-1');
    }
    expect(ticketState.ticketsOpened).toBe(1);
    expect(client.pendingEntryRequestId()).toBeUndefined();

    const entries = await audit.readByScope({ personId: 'driver-1', role: 'driver' });
    expect(entries).toHaveLength(1);

    console.log(`D3 report: duplicate tickets after airplane retry = ${ticketState.ticketsOpened - 1}`);
  });

  it('closes from the exit code through the entry point', async () => {
    const { client, ticketState, audit } = buildStack();

    const opened = await client.scanEntry('site-4', 'entry-site-4');
    expect(opened.ok).toBe(true);

    const closed = await client.scanExit('site-4', 'exit-site-4');
    expect(closed.ok).toBe(true);
    if (closed.ok) {
      expect(closed.value.status).toBe('closed');
    }
    expect(client.activeTicket()).toBeUndefined();
    expect(ticketState.ticketsOpened).toBe(1);

    const entries = await audit.readByScope({ personId: 'driver-1', role: 'driver' });
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.operation)).toEqual([
      'driver.openTicket',
      'driver.closeTicket',
    ]);
  });
});
