import { describe, expect, it } from 'vitest';
import { composeInMemoryApplication } from '../../../entrypoint/composition';
import { foundationOperations } from '../../../entrypoint/operations/foundation-operations';
import { TEST_TOKEN_SECRET, readRequest, tokenFor, writeRequest } from '../../../entrypoint/test-helpers';
import { createTicketReading, createTicketingOperations } from '../public';
import { FakePlates, buildTicketingWorld } from './testing/ticketing-world';

async function application() {
  const world = await buildTicketingWorld();
  const plates = new FakePlates().withPlate('car-a', 'ABC 123');
  const reading = createTicketReading({ store: world.store, plates, fees: world.fees });
  const app = composeInMemoryApplication({
    tokenSecret: TEST_TOKEN_SECRET,
    clock: world.clock,
    operations: [...foundationOperations, ...createTicketingOperations({ ...world, reading })],
  });
  const opened = await app.handle(writeRequest('/tickets/open', 'driver', 'open-request-1', { siteId: 'site-1', carRef: 'car-a', entryCode: 'entry-site-1' }));
  const ticketId = (opened.body as { ticket: { ticketId: string } }).ticket.ticketId;
  return { ...world, app, plates, ticketId };
}

const driver1 = tokenFor('driver');
const driver2 = tokenFor('driver', { personId: 'driver-2' });

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

  it('gives a driver the receipt of a closed ticket of their own', async () => {
    const { app, clock, ticketId, plates } = await application();
    clock.advanceByMilliseconds(2 * 60 * 60 * 1000);
    await app.handle(writeRequest('/tickets/close', 'driver', 'close-request-1', { ticketId, exitCode: 'exit-site-1' }));
    const response = await app.handle(readRequest('/tickets/receipt', driver1, { ticketId }));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ receipt: { ticketId, hours: 2, fee: 15, plate: 'ABC 123' } });
    expect(plates.requests).toHaveLength(1);
  });

  it('answers “not found” for another driver’s receipt, and 409 for an open ticket', async () => {
    const { app, clock, ticketId, plates } = await application();
    expect((await app.handle(readRequest('/tickets/receipt', driver1, { ticketId }))).status).toBe(409);
    clock.advanceByMilliseconds(60 * 60 * 1000);
    await app.handle(writeRequest('/tickets/close', 'driver', 'close-request-1', { ticketId, exitCode: 'exit-site-1' }));
    expect((await app.handle(readRequest('/tickets/receipt', driver2, { ticketId }))).status).toBe(404);
    expect(plates.requests).toHaveLength(0);
  });

  it('answers 403 when the identity area refuses the reader', async () => {
    const { app, clock, ticketId, plates } = await application();
    clock.advanceByMilliseconds(60 * 60 * 1000);
    await app.handle(writeRequest('/tickets/close', 'driver', 'close-request-1', { ticketId, exitCode: 'exit-site-1' }));
    plates.refuse('driver-1');
    expect((await app.handle(readRequest('/tickets/receipt', driver1, { ticketId }))).status).toBe(403);
  });
});
