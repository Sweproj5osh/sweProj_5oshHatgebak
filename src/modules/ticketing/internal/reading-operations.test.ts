import { describe, expect, it } from 'vitest';
import { composeInMemoryApplication } from '../../../entrypoint/composition';
import { TEST_TOKEN_SECRET, loggedReadRequest, readRequest, tokenFor, writeRequest } from '../../../entrypoint/test-helpers';
import { buildTicketingWorld } from './testing/ticketing-world';

async function application() {
  const world = await buildTicketingWorld();
  const app = composeInMemoryApplication({ tokenSecret: TEST_TOKEN_SECRET, clock: world.clock, moduleDependencies: world.dependencies });
  const opened = await app.handle(writeRequest('/tickets/open', 'driver', 'open-request-1', { siteId: 'site-1', carRef: 'car-a', entryCode: 'entry-site-1' }));
  const ticketId = (opened.body as { ticket: { ticketId: string } }).ticket.ticketId;
  return { ...world, app, ticketId };
}

type Application = Awaited<ReturnType<typeof application>>;

async function closeAfterTwoHours({ app, clock, ticketId }: Application) {
  clock.advanceByMilliseconds(2 * 60 * 60 * 1000);
  await app.handle(writeRequest('/tickets/close', 'driver', 'close-request-1', { ticketId, exitCode: 'exit-site-1' }));
}

const auditRows = (app: Application['app']) => app.audit.readByScope({ personId: 'chair-1', role: 'chair' });

const driver1 = tokenFor('driver');
const driver2 = tokenFor('driver', { personId: 'driver-2' });

describe('the reads declare their scope (P10)', () => {
  it('own for a driver’s tickets, status and receipt; open for the free-space count; the receipt is a logged read of personal data (P9)', async () => {
    const { app } = await application();
    const reads = Object.fromEntries(app.registry.reads().filter((read) => read.name.startsWith('ticketing.')).map((read) => [read.name, read]));
    expect(Object.keys(reads).sort()).toEqual(['ticketing.freeSpaces', 'ticketing.receipt', 'ticketing.ticketHistory', 'ticketing.ticketStatus']);
    expect(reads['ticketing.ticketHistory']?.scope).toBe('own');
    expect(reads['ticketing.ticketStatus']?.scope).toBe('own');
    expect(reads['ticketing.receipt']).toMatchObject({ scope: 'own', logged: true, audit: { touchesPersonalData: true } });
    expect(reads['ticketing.freeSpaces']?.scope).toBe('open');
  });
});

describe('reading tickets through the entry point', () => {
  it('lists the caller’s own tickets', async () => {
    const { app, ticketId } = await application();
    const response = await app.handle(readRequest('/tickets', driver1));
    expect(response.status).toBe(200);
    expect((response.body as { tickets: Array<{ ticketId: string }> }).tickets.map((ticket) => ticket.ticketId)).toEqual([ticketId]);
    const other = await app.handle(readRequest('/tickets', driver2));
    expect((other.body as { tickets: unknown[] }).tickets).toEqual([]);
  });

  it('shows one of the caller’s tickets, and answers “not found” for another driver’s or an unknown one', async () => {
    const { app, ticketId } = await application();
    expect((await app.handle(readRequest('/tickets/status', driver1, { ticketId }))).status).toBe(200);
    expect((await app.handle(readRequest('/tickets/status', driver2, { ticketId }))).status).toBe(404);
    expect((await app.handle(readRequest('/tickets/status', driver1, { ticketId: 'nope' }))).status).toBe(404);
  });

  it('gives a driver the receipt of a closed ticket of their own, and leaves exactly one audit entry naming the driver and no plate', async () => {
    const world = await application();
    const { app, ticketId, plates } = world;
    await closeAfterTwoHours(world);
    const response = await app.handle(loggedReadRequest('/tickets/receipt', 'driver', 'receipt-request-1', { ticketId }));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ receipt: { ticketId, hours: 2, fee: 15, plate: 'ABC 123' } });
    expect(plates.requests).toHaveLength(1);
    const receiptEntries = (await auditRows(app)).filter((row) => row.operation === 'ticketing.receipt');
    expect(receiptEntries).toHaveLength(1);
    expect(receiptEntries[0]).toMatchObject({ personId: 'driver-1', requestId: 'receipt-request-1', input: { ticketId }, subjectPersonIds: ['driver-1'] });
    expect(JSON.stringify(receiptEntries[0])).not.toContain('ABC 123');
  });

  it('refuses a receipt read without a request id, because the read is logged', async () => {
    const world = await application();
    await closeAfterTwoHours(world);
    expect((await world.app.handle(readRequest('/tickets/receipt', driver1, { ticketId: world.ticketId }))).status).toBe(400);
  });

  it('answers “not found” for another driver’s receipt, and 409 for an open ticket, with no audit entry for either', async () => {
    const world = await application();
    const { app, ticketId, plates } = world;
    expect((await app.handle(loggedReadRequest('/tickets/receipt', 'driver', 'receipt-request-1', { ticketId }))).status).toBe(409);
    await closeAfterTwoHours(world);
    const otherDriver = { ...loggedReadRequest('/tickets/receipt', 'driver', 'receipt-request-2', { ticketId }), headers: { authorization: `Bearer ${driver2}`, 'x-request-id': 'receipt-request-2' } };
    expect((await app.handle(otherDriver)).status).toBe(404);
    expect(plates.requests).toHaveLength(0);
    expect((await auditRows(app)).filter((row) => row.operation === 'ticketing.receipt')).toHaveLength(0);
  });

  it('answers 403 when the identity area refuses the reader', async () => {
    const world = await application();
    await closeAfterTwoHours(world);
    world.plates.refuse('driver-1');
    expect((await world.app.handle(loggedReadRequest('/tickets/receipt', 'driver', 'receipt-request-1', { ticketId: world.ticketId }))).status).toBe(403);
  });

  it('gives the free-space count of a site to any signed-in person, as site configuration', async () => {
    const { app } = await application();
    for (const role of ['driver', 'attendant', 'inspector', 'member', 'chair'] as const) {
      const response = await app.handle(readRequest('/tickets/free-spaces', tokenFor(role), { siteId: 'site-1' }));
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ siteId: 'site-1', freeSpaces: 4 });
    }
  });
});
