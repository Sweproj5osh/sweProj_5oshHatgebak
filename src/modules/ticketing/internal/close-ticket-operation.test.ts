import { describe, expect, it } from 'vitest';
import { composeInMemoryApplication } from '../../../entrypoint/composition';
import { foundationOperations } from '../../../entrypoint/operations/foundation-operations';
import { TEST_TOKEN_SECRET, tokenFor, writeRequest } from '../../../entrypoint/test-helpers';
import { REQUEST_ID_HEADER } from '../../../shared/request-id';
import { createTicketingOperations } from '../public';
import { buildTicketingWorld } from './testing/ticketing-world';

async function application() {
  const world = await buildTicketingWorld();
  const app = composeInMemoryApplication({
    tokenSecret: TEST_TOKEN_SECRET,
    clock: world.clock,
    operations: [...foundationOperations, ...createTicketingOperations(world)],
  });
  const opened = await app.handle(writeRequest('/tickets/open', 'driver', 'open-request-1', { siteId: 'site-1', carRef: 'car-a', entryCode: 'entry-site-1' }));
  const ticketId = (opened.body as { ticket: { ticketId: string } }).ticket.ticketId;
  world.clock.advanceByMilliseconds(2 * 60 * 60 * 1000);
  return { ...world, app, ticketId };
}

const closeBody = (ticketId: string, exitCode = 'exit-site-1') => ({ ticketId, exitCode });

function auditRows(app: Awaited<ReturnType<typeof application>>['app']) {
  return app.audit.readByScope({ personId: 'chair-1', role: 'chair' });
}

describe('closing a ticket through the entry point', () => {
  it('closes the ticket and leaves one more audit entry and one "ticket closed" event', async () => {
    const { app, ticketId } = await application();
    const response = await app.handle(writeRequest('/tickets/close', 'driver', 'close-request-1', closeBody(ticketId)));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ticket: { state: 'closed', fee: 15 } });
    const rows = await auditRows(app);
    expect(rows.map((row) => row.operation)).toEqual(['ticketing.openTicket', 'ticketing.closeTicket']);
    const events = await app.outbox.undelivered();
    expect(events.map((event) => event.topic)).toEqual(['ticket.closed']);
  });

  it('leaves no audit entry and no event for a refused close', async () => {
    const { app, ticketId } = await application();
    const response = await app.handle(writeRequest('/tickets/close', 'driver', 'close-request-1', closeBody(ticketId, 'exit-site-2')));
    expect(response.status).toBe(403);
    expect((await auditRows(app)).map((row) => row.operation)).toEqual(['ticketing.openTicket']);
    expect(await app.outbox.undelivered()).toHaveLength(0);
  });

  it('answers a repeated request id with the same response, one audit entry and one event', async () => {
    const { app, ticketId } = await application();
    const first = await app.handle(writeRequest('/tickets/close', 'driver', 'close-request-1', closeBody(ticketId)));
    const second = await app.handle(writeRequest('/tickets/close', 'driver', 'close-request-1', closeBody(ticketId)));
    expect(second).toEqual(first);
    expect((await auditRows(app)).filter((row) => row.operation === 'ticketing.closeTicket')).toHaveLength(1);
    expect(await app.outbox.undelivered()).toHaveLength(1);
  });

  it('does not let another driver close the ticket', async () => {
    const { app, ticketId, store } = await application();
    const response = await app.handle({
      method: 'POST',
      path: '/tickets/close',
      query: {},
      headers: { authorization: `Bearer ${tokenFor('driver', { personId: 'driver-2' })}`, [REQUEST_ID_HEADER]: 'close-request-9' },
      body: closeBody(ticketId),
    });
    expect(response.status).toBe(403);
    expect((await store.findById(app.database, ticketId))?.state).toBe('open');
  });

  it('rejects a body that carries a time', async () => {
    const { app, ticketId } = await application();
    const response = await app.handle(writeRequest('/tickets/close', 'driver', 'close-request-1', { ...closeBody(ticketId), closedAt: '2026-11-09T09:00:00Z' }));
    expect(response.status).toBe(400);
  });
});
