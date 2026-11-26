import { describe, expect, it } from 'vitest';
import { PostgresAuditLogStore } from '../../../adapters/postgres/postgres-audit-log-store';
import { FixedClock } from '../../../shared/clock';
import { ArrayAuditLogStore } from '../../../test-support/array-audit-log-store';
import { freshTestDatabase } from '../../../test-support/postgres-test-database';
import { createHashChainedAuditTrail, GENESIS_HASH, type AuditEntry, type AuditLogStore, type AuditRecord, type AuditTrail } from './index';

const clock = new FixedClock(new Date('2026-11-04T10:00:00Z'));

function trailOver(store: AuditLogStore): AuditTrail {
  return createHashChainedAuditTrail(store, clock);
}

/** The audit log of a fresh PostgreSQL test database (ADR-21). */
function storedLog(): AuditLogStore {
  return new PostgresAuditLogStore(freshTestDatabase().committed);
}

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    actor: { kind: 'person', personId: 'attendant-7', role: 'attendant' },
    operation: 'payments.tickCash',
    input: { ticketId: 't-1' },
    requestId: 'request-0001',
    districtId: 'district-1',
    ...overrides,
  };
}

/** A copy of the log holding the given records under the original's head, as a tampered copy of the log would. */
function copyWith(original: ArrayAuditLogStore, records: readonly AuditRecord[]): ArrayAuditLogStore {
  return new ArrayAuditLogStore(records, original.chainHead);
}

async function appendThree(trail: AuditTrail): Promise<AuditRecord[]> {
  const records: AuditRecord[] = [];
  for (const operation of ['one', 'two', 'three']) {
    records.push(await trail.append(entry({ operation })));
  }
  return records;
}

describe('hash-chained audit trail', () => {
  it('chains each entry to the previous one and verifies three appends', async () => {
    const trail = trailOver(storedLog());
    const [first, second, third] = await appendThree(trail);
    expect(first?.prevHash).toBe(GENESIS_HASH);
    expect(second?.prevHash).toBe(first?.hash);
    expect(third?.prevHash).toBe(second?.hash);
    expect([first?.id, second?.id, third?.id]).toEqual([1, 2, 3]);
    expect(await trail.verifyChain()).toBe(true);
  });

  it('stamps the server clock, never a caller-supplied time', async () => {
    const trail = trailOver(storedLog());
    const record = await trail.append(entry());
    expect(record.recordedAt).toBe('2026-11-04T10:00:00.000Z');
  });

  it('fails verification when one entry in a copy of the log is altered', async () => {
    const original = new ArrayAuditLogStore();
    const records = await appendThree(trailOver(original));
    const tamperedCopy = copyWith(original, records.map((record, index) => (index === 1 ? { ...record, operation: 'two-but-edited' } : record)));
    expect(await trailOver(tamperedCopy).verifyChain()).toBe(false);
  });

  it('fails verification when one entry in a copy of the log is removed', async () => {
    const original = new ArrayAuditLogStore();
    const records = await appendThree(trailOver(original));
    const shortenedCopy = copyWith(original, records.filter((record) => record.id !== 2));
    expect(await trailOver(shortenedCopy).verifyChain()).toBe(false);
  });

  it('fails verification when the LAST entry is removed: the head record remembers the last id and hash', async () => {
    const log = new ArrayAuditLogStore();
    const trail = trailOver(log);
    const [, , third] = await appendThree(trail);
    log.cut(third?.id ?? 0);
    expect(await trail.verifyChain()).toBe(false);
  });

  it('fails verification when the log is empty but the head says entries existed', async () => {
    const log = new ArrayAuditLogStore();
    const trail = trailOver(log);
    await appendThree(trail);
    for (const id of [1, 2, 3]) {
      log.cut(id);
    }
    expect(await trail.verifyChain()).toBe(false);
  });

  it('reads by scope: member sees own district, Chair sees all, attendant sees entries naming them', async () => {
    const trail = trailOver(storedLog());
    await trail.append(entry({ operation: 'd1-by-attendant-7', districtId: 'district-1' }));
    await trail.append(entry({ operation: 'd2-by-member', actor: { kind: 'person', personId: 'member-2', role: 'member' }, districtId: 'district-2' }));
    await trail.append(
      entry({
        operation: 'd2-licence-of-attendant-7',
        actor: { kind: 'person', personId: 'chair-1', role: 'chair' },
        districtId: 'district-2',
        subjectPersonIds: ['attendant-7'],
      }),
    );

    const names = (records: readonly AuditRecord[]) => records.map((record) => record.operation);
    const asMember = await trail.readByScope({ personId: 'member-2', role: 'member', districtId: 'district-2' });
    const asChair = await trail.readByScope({ personId: 'chair-1', role: 'chair' });
    const asAttendant = await trail.readByScope({ personId: 'attendant-7', role: 'attendant' });

    expect(names(asMember)).toEqual(['d2-by-member', 'd2-licence-of-attendant-7']);
    expect(names(asChair)).toEqual(['d1-by-attendant-7', 'd2-by-member', 'd2-licence-of-attendant-7']);
    expect(names(asAttendant)).toEqual(['d1-by-attendant-7', 'd2-licence-of-attendant-7']);
  });

  it('keeps the chain intact and the ids gapless under 50 concurrent appends', async () => {
    const trail = trailOver(storedLog());
    const records = await Promise.all(
      Array.from({ length: 50 }, (_, index) => trail.append(entry({ requestId: `request-${index}` }))),
    );
    expect(records.map((record) => record.id)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    expect(await trail.verifyChain()).toBe(true);
  });

  it('reports append and verification speed for 10,000 entries (Z3 report numbers)', async () => {
    const trail = trailOver(storedLog());
    const appendStart = performance.now();
    for (let index = 0; index < 10_000; index += 1) {
      await trail.append(entry({ requestId: `request-${index}` }));
    }
    const appendSeconds = (performance.now() - appendStart) / 1000;
    const verifyStart = performance.now();
    expect(await trail.verifyChain()).toBe(true);
    const verifyMilliseconds = performance.now() - verifyStart;
    console.log(
      `Z3 report: ${Math.round(10_000 / appendSeconds)} entries per second appended; ` +
        `verification of 10,000 entries took ${verifyMilliseconds.toFixed(0)} ms`,
    );
  }, 30_000);
});
