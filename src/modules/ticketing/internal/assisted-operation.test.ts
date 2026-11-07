import { describe, expect, it } from 'vitest';
import { composeInMemoryApplication } from '../../../entrypoint/composition';
import { TEST_TOKEN_SECRET, writeRequest } from '../../../entrypoint/test-helpers';
import { buildTicketingWorld, clockedIn } from './testing/ticketing-world';

/** The attendant of the test token (`attendant-1`) is clocked in at site-1 unless a test binds them elsewhere. */
async function application(boundSites: Readonly<Record<string, string>> = { 'attendant-1': 'site-1' }) {
  const world = await buildTicketingWorld();
  const app = composeInMemoryApplication({
    tokenSecret: TEST_TOKEN_SECRET,
    clock: world.clock,
    accessChecks: clockedIn(boundSites),
    moduleDependencies: world.dependencies,
  });
  return { ...world, app };
}

const openBody = { siteId: 'site-1', carRef: 'car-a', driverRef: 'walk-in-driver', entryCode: 'entry-site-1', photoId: 'photo-1' };
const audit = (app: Awaited<ReturnType<typeof application>>['app']) => app.audit.readByScope({ personId: 'chair-1', role: 'chair' });

describe('assisted tickets through the entry point', () => {
  it('lets an attendant open one, with one audit entry naming the attendant and the photo', async () => {
    const { app } = await application();
    const response = await app.handle(writeRequest('/tickets/open-assisted', 'attendant', 'assisted-request-1', openBody));
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ ticket: { assisted: true, driverRef: 'walk-in-driver' } });
    const rows = await audit(app);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ operation: 'ticketing.openAssistedTicket', personId: 'attendant-1', subjectPersonIds: ['walk-in-driver'] });
    expect(JSON.stringify(rows[0]?.input)).toContain('photo-1');
  });

  it('does not let a driver call it', async () => {
    const { app } = await application();
    const response = await app.handle(writeRequest('/tickets/open-assisted', 'driver', 'assisted-request-1', openBody));
    expect(response.status).toBe(403);
    expect(await audit(app)).toHaveLength(0);
  });

  it('refuses an attendant whose session is bound to another site, and leaves no audit entry', async () => {
    const { app } = await application({ 'attendant-1': 'site-9' });
    const response = await app.handle(writeRequest('/tickets/open-assisted', 'attendant', 'assisted-request-1', openBody));
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'attendant not clocked in at this site' });
    expect(await audit(app)).toHaveLength(0);
  });

  it('refuses an attendant who has not clocked in anywhere', async () => {
    const { app } = await application({});
    const response = await app.handle(writeRequest('/tickets/open-assisted', 'attendant', 'assisted-request-1', openBody));
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'attendant not clocked in at this site' });
  });

  it('closes it with one more audit entry and one "ticket closed" event, and refuses a wrong car without either', async () => {
    const { app, clock } = await application();
    const opened = await app.handle(writeRequest('/tickets/open-assisted', 'attendant', 'assisted-request-1', openBody));
    const ticketId = (opened.body as { ticket: { ticketId: string } }).ticket.ticketId;
    clock.advanceByMilliseconds(2 * 60 * 60 * 1000);
    const wrongCar = await app.handle(writeRequest('/tickets/close-assisted', 'attendant', 'assisted-close-1', { ticketId, carRef: 'car-other', exitCode: 'exit-site-1', photoId: 'photo-2' }));
    expect(wrongCar.status).toBe(409);
    expect(await app.outbox.undelivered()).toHaveLength(0);
    const closed = await app.handle(writeRequest('/tickets/close-assisted', 'attendant', 'assisted-close-2', { ticketId, carRef: 'car-a', exitCode: 'exit-site-1', photoId: 'photo-2' }));
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ ticket: { state: 'closed', fee: 15 } });
    expect((await audit(app)).map((row) => row.operation)).toEqual(['ticketing.openAssistedTicket', 'ticketing.closeAssistedTicket']);
    expect((await app.outbox.undelivered()).map((event) => event.topic)).toEqual(['ticket.closed']);
  });

  it('does not let a driver call the assisted close', async () => {
    const { app } = await application();
    const response = await app.handle(writeRequest('/tickets/close-assisted', 'driver', 'assisted-close-1', { ticketId: 'x', carRef: 'car-a', exitCode: 'exit-site-1', photoId: '' }));
    expect(response.status).toBe(403);
  });
});
