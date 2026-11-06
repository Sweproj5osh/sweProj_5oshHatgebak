import { describe, expect, it } from 'vitest';
import { composeInMemoryApplication } from '../../../entrypoint/composition';
import { foundationOperations } from '../../../entrypoint/operations/foundation-operations';
import { TEST_TOKEN_SECRET, writeRequest } from '../../../entrypoint/test-helpers';
import { TIMESTAMPS_ARE_SET_BY_THE_SERVER } from '../../../entrypoint/handle-request';
import { createTicketingOperations } from '../public';
import { buildTicketingWorld, START } from './testing/ticketing-world';

function application() {
  const world = buildTicketingWorld();
  const app = composeInMemoryApplication({
    tokenSecret: TEST_TOKEN_SECRET,
    clock: world.clock,
    operations: [...foundationOperations, ...createTicketingOperations(world.opening)],
  });
  return { ...world, app };
}

const body = { siteId: 'site-1', carRef: 'car-a', entryCode: 'entry-site-1' };

async function auditRows(app: ReturnType<typeof application>['app']) {
  return app.audit.readByScope({ personId: 'chair-1', role: 'chair' });
}

describe('opening a ticket through the entry point', () => {
  it('leaves exactly one audit entry for an opened ticket', async () => {
    const { app } = application();
    const response = await app.handle(writeRequest('/tickets/open', 'driver', 'request-id-1', body));
    expect(response.status).toBe(201);
    const rows = await auditRows(app);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.operation).toBe('ticketing.openTicket');
  });

  it('leaves no audit entry for a refused open', async () => {
    const { app } = application();
    const response = await app.handle(writeRequest('/tickets/open', 'driver', 'request-id-1', { ...body, entryCode: 'made-up' }));
    expect(response.status).toBe(403);
    expect(await auditRows(app)).toHaveLength(0);
  });

  it('sets the entry time from the server clock', async () => {
    const { app } = application();
    const response = await app.handle(writeRequest('/tickets/open', 'driver', 'request-id-1', body));
    expect(response.body).toMatchObject({ ticket: { openedAt: START.toISOString() } });
  });

  it('rejects a body that carries a time', async () => {
    const { app } = application();
    const response = await app.handle(writeRequest('/tickets/open', 'driver', 'request-id-1', { ...body, openedAt: '2026-11-09T07:00:00Z' }));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: TIMESTAMPS_ARE_SET_BY_THE_SERVER });
  });

  it('answers a repeated request id with the same ticket and one audit entry', async () => {
    const { app } = application();
    const first = await app.handle(writeRequest('/tickets/open', 'driver', 'request-id-1', body));
    const second = await app.handle(writeRequest('/tickets/open', 'driver', 'request-id-1', body));
    expect(second).toEqual(first);
    expect(await auditRows(app)).toHaveLength(1);
  });

  it('does not let an attendant open a driver ticket', async () => {
    const { app } = application();
    const response = await app.handle(writeRequest('/tickets/open', 'attendant', 'request-id-1', body));
    expect(response.status).toBe(403);
  });
});
