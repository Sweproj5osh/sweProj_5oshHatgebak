import { describe, expect, it } from 'vitest';
import { createHashChainedAuditTrail, type AuditEntry } from '../../modules/foundation/audit-log/index';
import { FixedClock } from '../../shared/clock';
import { ArrayAuditLogStore } from '../../test-support/array-audit-log-store';
import { createTestDatabase } from '../../test-support/postgres-test-database';
import { PostgresAuditLogStore } from './postgres-audit-log-store';
import { PostgresOutboxStore } from './postgres-outbox-store';
import { PostgresResponseStore } from './postgres-response-store';

const START = new Date('2026-11-25T08:00:00.123Z');

/** One entry of every actor shape, with and without each optional field (ADR-10, ADR-15). */
const ENTRIES: readonly AuditEntry[] = [
  { actor: { kind: 'system' }, operation: 'accounts.bootstrapChair', input: {}, requestId: 'system-bootstrap-first-chair', subjectPersonIds: ['chair-1'] },
  { actor: { kind: 'anonymous', address: '203.0.113.7' }, operation: 'signIn', input: { personId: 'driver-1' }, requestId: 'request-0001' },
  {
    actor: { kind: 'person', personId: 'member-1', role: 'member' },
    operation: 'sites.changeCapacity',
    input: { siteId: 'site-1', capacity: 8, reason: 'new lines painted', nested: { b: [1, 2.5], a: null } },
    requestId: 'request-0002',
    reason: 'new lines painted',
    districtId: 'district-1',
    subjectPersonIds: [],
  },
  { actor: { kind: 'person', personId: 'chair-1', role: 'chair' }, operation: 'approvals.approve', input: {}, requestId: 'request-0003', approverId: 'chair-1' },
];

describe('PostgreSQL audit log store (ADR-10, ADR-21)', () => {
  it('keeps every record exactly as the trail built it, so the chain and the head verify', async () => {
    const { database } = await createTestDatabase();
    const clock = new FixedClock(START);
    const reference = new ArrayAuditLogStore();
    const expected = createHashChainedAuditTrail(reference, new FixedClock(START));
    for (const entry of ENTRIES) {
      const transaction = database.begin();
      await createHashChainedAuditTrail(new PostgresAuditLogStore(transaction), clock).append(entry);
      await transaction.commit();
      await expected.append(entry);
    }
    const stored = createHashChainedAuditTrail(new PostgresAuditLogStore(database.committed), clock);
    expect(await stored.verifyChain()).toBe(true);
    expect(await new PostgresAuditLogStore(database.committed).readAll()).toEqual(await reference.readAll());
    expect(await stored.readByScope({ personId: 'chair-1', role: 'chair' })).toHaveLength(ENTRIES.length);
  });

  it('leaves no record when the unit of work rolls back', async () => {
    const { database } = await createTestDatabase();
    const transaction = database.begin();
    await createHashChainedAuditTrail(new PostgresAuditLogStore(transaction), new FixedClock(START)).append(ENTRIES[0]!);
    await transaction.rollback();
    expect(await new PostgresAuditLogStore(database.committed).readAll()).toEqual([]);
    expect(await new PostgresAuditLogStore(database.committed).head()).toBeUndefined();
  });

  it('chains appends from two server copies one after the other, under the advisory lock', async () => {
    const { database } = await createTestDatabase();
    const clock = new FixedClock(START);
    const appendFromACopy = async (entry: AuditEntry) => {
      const transaction = database.begin();
      await createHashChainedAuditTrail(new PostgresAuditLogStore(transaction), clock).append(entry);
      await transaction.commit();
    };
    await Promise.all(Array.from({ length: 12 }, (_, index) => appendFromACopy({ ...ENTRIES[1]!, requestId: `request-copy-${index}` })));
    const records = await new PostgresAuditLogStore(database.committed).readAll();
    expect(records.map((record) => record.id)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect(await createHashChainedAuditTrail(new PostgresAuditLogStore(database.committed), clock).verifyChain()).toBe(true);
  });
});

describe('PostgreSQL outbox store (ADR-07, ADR-21)', () => {
  it('stores events only when the unit of work commits, and delivers them in publish order', async () => {
    const { database } = await createTestDatabase();
    const outbox = new PostgresOutboxStore(database.committed, new FixedClock(START));
    const rolledBack = database.begin();
    outbox.publisherBoundTo(rolledBack).publish({ topic: 'ticket.opened', payload: { ticketId: 't-0' } });
    await rolledBack.rollback();
    const committed = database.begin();
    const publisher = outbox.publisherBoundTo(committed);
    publisher.publish({ topic: 'ticket.opened', payload: { ticketId: 't-1', siteId: 's-1' } });
    publisher.publish({ topic: 'ticket.closed', payload: { ticketId: 't-1' } });
    await committed.commit();
    const events = await outbox.allEvents();
    expect(events.map((event) => [event.topic, event.payload, event.deliveredAt, event.deliveryAttempts])).toEqual([
      ['ticket.opened', { ticketId: 't-1', siteId: 's-1' }, null, 0],
      ['ticket.closed', { ticketId: 't-1' }, null, 0],
    ]);
    expect(events[0]?.publishedAt).toBe(START.toISOString());
    await outbox.markDelivered(events[0]!.id, '2026-11-25T08:01:00.000Z');
    await outbox.recordFailedAttempt(events[1]!.id);
    expect((await outbox.undelivered()).map((event) => [event.topic, event.deliveryAttempts])).toEqual([['ticket.closed', 1]]);
    await expect(outbox.markDelivered('00000000-0000-4000-8000-000000000000', START.toISOString())).rejects.toThrow('The outbox holds no event with the id');
  });
});

describe('PostgreSQL response store (Rule H, P19, ADR-21)', () => {
  it('gives back the first answer and its body hash exactly, an absent body included', async () => {
    const { database } = await createTestDatabase();
    const store = new PostgresResponseStore(database.committed, new FixedClock(START));
    const answer = { response: { status: 201, body: { ticket: { ticketId: 't-1', fee: null, warnings: [] } } }, bodyHash: 'a'.repeat(64) };
    await store.save('driver-1/request-0001', answer);
    await store.save('driver-1/request-0001', { response: { status: 500, body: {} }, bodyHash: 'b'.repeat(64) });
    await store.save('driver-1/request-0002', { response: { status: 204, body: undefined }, bodyHash: 'c'.repeat(64) });
    expect(await store.find('driver-1/request-0001')).toEqual(answer);
    expect(await store.find('driver-1/request-0002')).toStrictEqual({ response: { status: 204, body: undefined }, bodyHash: 'c'.repeat(64) });
    expect(await store.find('driver-1/request-0003')).toBeUndefined();
  });
});
