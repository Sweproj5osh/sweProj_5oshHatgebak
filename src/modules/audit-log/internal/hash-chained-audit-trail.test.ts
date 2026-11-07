import { describe, expect, it } from 'vitest';
import { InMemoryAuditLogStore } from '../../../adapters/in-memory/in-memory-audit-log-store';
import { InMemoryDatabase } from '../../../adapters/in-memory/in-memory-database';
import { FixedClock } from '../../../shared/clock';
import { createHashChainedAuditTrail, GENESIS_HASH, type AuditEntry, type AuditRecord, type AuditTrail } from '../public';

const clock = new FixedClock(new Date('2026-11-04T10:00:00Z'));

function trailOver(database: InMemoryDatabase): AuditTrail {
  return createHashChainedAuditTrail(new InMemoryAuditLogStore(database.tables), clock);
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

async function appendThree(trail: AuditTrail): Promise<AuditRecord[]> {
  const records: AuditRecord[] = [];
  for (const operation of ['one', 'two', 'three']) {
    records.push(await trail.append(entry({ operation })));
  }
  return records;
}

describe('hash-chained audit trail', () => {
  it('chains each entry to the previous one and verifies three appends', async () => {
    const trail = trailOver(new InMemoryDatabase());
    const [first, second, third] = await appendThree(trail);
    expect(first?.prevHash).toBe(GENESIS_HASH);
    expect(second?.prevHash).toBe(first?.hash);
    expect(third?.prevHash).toBe(second?.hash);
    expect([first?.id, second?.id, third?.id]).toEqual([1, 2, 3]);
    expect(await trail.verifyChain()).toBe(true);
  });

  it('stamps the server clock, never a caller-supplied time', async () => {
    const trail = trailOver(new InMemoryDatabase());
    const record = await trail.append(entry());
    expect(record.recordedAt).toBe('2026-11-04T10:00:00.000Z');
  });

  it('fails verification when one entry in a copy of the log is altered', async () => {
    const original = new InMemoryDatabase();
    const records = await appendThree(trailOver(original));
    const tamperedCopy = new InMemoryDatabase();
    records.forEach((record, index) =>
      tamperedCopy.tables.insert('audit_log', String(record.id), index === 1 ? { ...record, operation: 'two-but-edited' } : record),
    );
    expect(await trailOver(tamperedCopy).verifyChain()).toBe(false);
  });

  it('fails verification when one entry in a copy of the log is removed', async () => {
    const original = new InMemoryDatabase();
    const records = await appendThree(trailOver(original));
    const shortenedCopy = new InMemoryDatabase();
    records.filter((record) => record.id !== 2).forEach((record) => shortenedCopy.tables.insert('audit_log', String(record.id), record));
    expect(await trailOver(shortenedCopy).verifyChain()).toBe(false);
  });

  it('reads by scope: member sees own district, Chair sees all, attendant sees entries naming them', async () => {
    const trail = trailOver(new InMemoryDatabase());
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
    const trail = trailOver(new InMemoryDatabase());
    const records = await Promise.all(
      Array.from({ length: 50 }, (_, index) => trail.append(entry({ requestId: `request-${index}` }))),
    );
    expect(records.map((record) => record.id)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    expect(await trail.verifyChain()).toBe(true);
  });

  it('reports append and verification speed for 10,000 entries (Z3 report numbers)', async () => {
    const trail = trailOver(new InMemoryDatabase());
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
