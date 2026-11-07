import { describe, expect, it } from 'vitest';
import { TEST_TOKEN_SECRET, testApplication, tokenFor } from '../../../entrypoint/test-helpers';
import { answerDroppingHandle, type AnswerDrops } from '../../test-support/answer-dropping-handle';
import { buildTicketingWorld, TICKETING_WORLD_START } from '../../test-support/ticketing-world';
import { DriverScanClient } from './driver-scan-client';
import { HttpTicketScanApi } from './http-ticket-scan-api';

/** The token the test helpers mint for a driver names this person. */
const DRIVER_OF_THE_TOKEN = 'driver-1';
const CAR = 'car-a';
const scanAt = (siteId: string) => ({ siteId, carRef: CAR, entryCode: `entry-${siteId}` });

/** Karim's real ticketing operations from main, composed on the real pipeline; only the ports to other modules are fakes. */
async function buildStack(drops: AnswerDrops = { remaining: 0 }) {
  const world = await buildTicketingWorld({ sites: { 'site-1': 5, 'site-2': 5 } });
  const app = testApplication({ tokenSecret: TEST_TOKEN_SECRET, clock: world.clock, additionalOperations: world.operations });
  const api = new HttpTicketScanApi({ handle: answerDroppingHandle(app.handle, drops), token: () => tokenFor('driver') });
  let requestSerial = 1;
  const client = new DriverScanClient({ api, createRequestId: () => `scan-req-${String(requestSerial++).padStart(4, '0')}` });
  const driverEntries = async () => (await app.audit.readByScope({ personId: DRIVER_OF_THE_TOKEN, role: 'driver' })).map((entry) => entry.operation);
  return { client, world, driverEntries, app };
}

describe('D3 Driver App scanning over the HTTP entry point, against Karim\'s ticketing operations', () => {
  it('scan twice quickly opens one ticket and leaves one audit entry', async () => {
    const { client, world, driverEntries } = await buildStack();

    const [first, second] = await Promise.all([client.scanEntry(scanAt('site-1')), client.scanEntry(scanAt('site-1'))]);

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value).toMatchObject({ ticketId: 'ticket-1', siteId: 'site-1', carRef: CAR, driverRef: DRIVER_OF_THE_TOKEN, state: 'open', paymentStatus: 'unpaid', openedAt: TICKETING_WORLD_START.toISOString() });
      expect(second.value.ticketId).toBe(first.value.ticketId);
    }
    expect(await world.openTicketsAt('site-1')).toBe(1);
    expect(await driverEntries()).toEqual(['ticketing.openTicket']);

    console.log(`D3 report: duplicate tickets in test = ${(await world.openTicketsAt('site-1')) - 1}`);
  });

  it('airplane mode mid-scan then retry uses the kept request id and still one ticket', async () => {
    const { client, world, driverEntries } = await buildStack({ remaining: 1 });

    const lost = await client.scanEntry(scanAt('site-1'));
    expect(lost).toEqual({ ok: false, error: 'connection lost', requestId: 'scan-req-0001' });
    expect(client.pendingEntryRequestId()).toBe('scan-req-0001');
    expect(await world.openTicketsAt('site-1')).toBe(1);

    const retry = await client.scanEntry(scanAt('site-1'));

    expect(retry.ok && retry.value.ticketId).toBe('ticket-1');
    expect(await world.openTicketsAt('site-1')).toBe(1);
    expect(client.pendingEntryRequestId()).toBeUndefined();
    expect(await driverEntries()).toEqual(['ticketing.openTicket']);

    console.log(`D3 report: duplicate tickets after airplane retry = ${(await world.openTicketsAt('site-1')) - 1}`);
  });

  it('closes from the exit code: the exit time and the fee are the server\'s, and the state word is "closed"', async () => {
    const { client, world, driverEntries } = await buildStack();
    await client.scanEntry(scanAt('site-1'));
    world.clock.advanceByMilliseconds(30 * 60 * 1000);

    const closed = await client.scanExit('exit-site-1');

    expect(closed.ok && closed.value).toMatchObject({ ticketId: 'ticket-1', state: 'closed', closedAt: world.clock.now().toISOString(), fee: world.price.firstHourFee });
    expect(client.activeTicket()).toBeUndefined();
    expect(await world.openTicketsAt('site-1')).toBe(0);
    expect(await driverEntries()).toEqual(['ticketing.openTicket', 'ticketing.closeTicket']);
  });

  it('shows a forged code as the server refusal and leaves no ticket and no audit entry', async () => {
    const { client, world, driverEntries } = await buildStack();

    const result = await client.scanEntry({ siteId: 'site-1', carRef: CAR, entryCode: 'not-a-real-code' });

    expect(result).toEqual({ ok: false, error: 'forged code' });
    expect(await world.openTicketsAt('site-1')).toBe(0);
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

  it('refuses an exit scan made with the entry code with Karim\'s word for a code of the wrong kind, and the ticket stays open', async () => {
    const { client, world, driverEntries } = await buildStack();
    await client.scanEntry(scanAt('site-1'));

    const wrong = await client.scanExit('entry-site-1');

    expect(wrong).toEqual({ ok: false, error: 'forged code' });
    expect(client.activeTicket()).toBe('ticket-1');
    expect(await world.openTicketsAt('site-1')).toBe(1);
    expect(await driverEntries()).toEqual(['ticketing.openTicket']);
  });

  it('shows "not signed in" when the server does not accept the token', async () => {
    const world = await buildTicketingWorld({ sites: { 'site-1': 5 } });
    const app = testApplication({ tokenSecret: TEST_TOKEN_SECRET, clock: world.clock, additionalOperations: world.operations });
    const client = new DriverScanClient({
      api: new HttpTicketScanApi({ handle: app.handle, token: () => 'not-a-token' }),
      createRequestId: () => 'scan-req-0099',
    });

    expect(await client.scanEntry(scanAt('site-1'))).toEqual({ ok: false, error: 'not signed in' });
    expect(await world.openTicketsAt('site-1')).toBe(0);
  });
});
