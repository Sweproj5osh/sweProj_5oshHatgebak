import { describe, expect, it } from 'vitest';
import type { InMemoryApplicationOptions } from '../../../entrypoint/composition';
import { readRequest, TEST_TOKEN_SECRET, testApplication, tokenFor } from '../../../entrypoint/test-helpers';
import { FixedClock } from '../../../shared/clock';
import { answerDroppingHandle, type AnswerDrops } from '../../test-support/answer-dropping-handle';
import { priceListFor, TEST_PRICE } from '../../test-support/ticketing-ports';
import { DriverScanClient } from './driver-scan-client';
import { HttpTicketScanApi } from './http-ticket-scan-api';

/** The token the test helpers mint for a driver names this person. */
const DRIVER_OF_THE_TOKEN = 'driver-1';
const CAR = 'car-a';
const START = new Date('2026-11-09T08:00:00Z');
/** The in-memory test application's stand-in registry: codes `entry-<site>` and `exit-<site>`, five spaces per site. */
const STAND_IN_CAPACITY = 5;
const scanAt = (siteId: string) => ({ siteId, carRef: CAR, entryCode: `entry-${siteId}` });

/**
 * Karim's ticketing operations exactly as the composition root registers them on main, on the real pipeline. The test
 * fills only the committee price (so a close can charge) and, where a test asks, car ownership.
 */
async function buildStack(drops: AnswerDrops = { remaining: 0 }, moduleDependencies: InMemoryApplicationOptions['moduleDependencies'] = {}) {
  const clock = new FixedClock(START);
  const prices = await priceListFor(['site-1', 'site-2']);
  const app = testApplication({ tokenSecret: TEST_TOKEN_SECRET, clock, moduleDependencies: { prices, ...moduleDependencies } });
  const api = new HttpTicketScanApi({ handle: answerDroppingHandle(app.handle, drops), token: () => tokenFor('driver') });
  let requestSerial = 1;
  const client = new DriverScanClient({ api, createRequestId: () => `scan-req-${String(requestSerial++).padStart(4, '0')}` });
  const driverEntries = async () => (await app.audit.readByScope({ personId: DRIVER_OF_THE_TOKEN, role: 'driver' })).map((entry) => entry.operation);
  /** Counted through Karim's open read `ticketing.freeSpaces`, so the count is the server's (Rule G). */
  const openTicketsAt = async (siteId: string) => {
    const answer = await app.handle(readRequest('/tickets/free-spaces', tokenFor('driver'), { siteId }));
    return STAND_IN_CAPACITY - Number((answer.body as { freeSpaces: number }).freeSpaces);
  };
  return { client, clock, driverEntries, openTicketsAt };
}

describe('D3 Driver App scanning over the HTTP entry point, against Karim\'s composed ticketing operations', () => {
  it('scan twice quickly opens one ticket and leaves one audit entry', async () => {
    const { client, driverEntries, openTicketsAt } = await buildStack();

    const [first, second] = await Promise.all([client.scanEntry(scanAt('site-1')), client.scanEntry(scanAt('site-1'))]);

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value).toMatchObject({ siteId: 'site-1', carRef: CAR, driverRef: DRIVER_OF_THE_TOKEN, state: 'open', paymentStatus: 'unpaid', openedAt: START.toISOString(), assisted: false });
      expect(second.value.ticketId).toBe(first.value.ticketId);
    }
    expect(await openTicketsAt('site-1')).toBe(1);
    expect(await driverEntries()).toEqual(['ticketing.openTicket']);

    console.log(`D3 report: duplicate tickets in test = ${(await openTicketsAt('site-1')) - 1}`);
  });

  it('airplane mode mid-scan then retry uses the kept request id and still one ticket', async () => {
    const { client, driverEntries, openTicketsAt } = await buildStack({ remaining: 1 });

    const lost = await client.scanEntry(scanAt('site-1'));
    expect(lost).toEqual({ ok: false, error: 'connection lost', requestId: 'scan-req-0001' });
    expect(client.pendingEntryRequestId()).toBe('scan-req-0001');
    expect(await openTicketsAt('site-1')).toBe(1);

    const retry = await client.scanEntry(scanAt('site-1'));

    expect(retry.ok).toBe(true);
    expect(await openTicketsAt('site-1')).toBe(1);
    expect(client.pendingEntryRequestId()).toBeUndefined();
    expect(await driverEntries()).toEqual(['ticketing.openTicket']);

    console.log(`D3 report: duplicate tickets after airplane retry = ${(await openTicketsAt('site-1')) - 1}`);
  });

  it('closes from the exit code: the exit time and the fee are the server\'s, and the state word is "closed"', async () => {
    const { client, clock, driverEntries, openTicketsAt } = await buildStack();
    const opened = await client.scanEntry(scanAt('site-1'));
    clock.advanceByMilliseconds(30 * 60 * 1000);

    const closed = await client.scanExit('exit-site-1');

    expect(closed.ok && closed.value).toMatchObject({ ticketId: opened.ok ? opened.value.ticketId : 'no ticket opened', state: 'closed', closedAt: clock.now().toISOString(), fee: TEST_PRICE.firstHourFee });
    expect(client.activeTicket()).toBeUndefined();
    expect(await openTicketsAt('site-1')).toBe(0);
    expect(await driverEntries()).toEqual(['ticketing.openTicket', 'ticketing.closeTicket']);
  });

  it('shows a forged code as the server refusal and leaves no ticket and no audit entry', async () => {
    const { client, driverEntries, openTicketsAt } = await buildStack();

    const result = await client.scanEntry({ siteId: 'site-1', carRef: CAR, entryCode: 'not-a-real-code' });

    expect(result).toEqual({ ok: false, error: 'forged code' });
    expect(await openTicketsAt('site-1')).toBe(0);
    expect(client.pendingEntryRequestId()).toBeUndefined();
    expect(await driverEntries()).toEqual([]);
  });

  it('refuses a second ticket for a car already parked, and the refusal leaves no second audit entry', async () => {
    const { client, driverEntries } = await buildStack();
    await client.scanEntry(scanAt('site-1'));

    const second = await client.scanEntry(scanAt('site-2'));

    expect(second).toEqual({ ok: false, error: 'car already parked' });
    expect(await driverEntries()).toEqual(['ticketing.openTicket']);
  });

  it('shows "car not registered to this driver" when the server says the car is not the driver\'s (Karim, #39)', async () => {
    const { client, openTicketsAt } = await buildStack({ remaining: 0 }, { carOwnership: { carBelongsTo: async () => false } });

    const result = await client.scanEntry(scanAt('site-1'));

    expect(result).toEqual({ ok: false, error: 'car not registered to this driver' });
    expect(await openTicketsAt('site-1')).toBe(0);
  });

  it('refuses an exit scan made with the entry code with the server word, and the ticket stays open', async () => {
    const { client, driverEntries, openTicketsAt } = await buildStack();
    await client.scanEntry(scanAt('site-1'));

    const wrong = await client.scanExit('entry-site-1');

    expect(wrong).toEqual({ ok: false, error: 'forged code' });
    expect(client.activeTicket()).toBeDefined();
    expect(await openTicketsAt('site-1')).toBe(1);
    expect(await driverEntries()).toEqual(['ticketing.openTicket']);
  });

  it('shows "not signed in" when the server does not accept the token', async () => {
    const { openTicketsAt } = await buildStack();
    const app = testApplication({ tokenSecret: TEST_TOKEN_SECRET });
    const client = new DriverScanClient({
      api: new HttpTicketScanApi({ handle: app.handle, token: () => 'not-a-token' }),
      createRequestId: () => 'scan-req-0099',
    });

    expect(await client.scanEntry(scanAt('site-1'))).toEqual({ ok: false, error: 'not signed in' });
    expect(await openTicketsAt('site-1')).toBe(0);
  });
});
