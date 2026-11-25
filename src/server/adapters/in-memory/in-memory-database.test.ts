import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../test-support/postgres-test-database';
import type { TableAccess, Transaction } from '../../shared/unit-of-work';
import { InMemoryDatabase } from './in-memory-database';

/** The contract every TableAccess adapter keeps (ADR-13, ADR-21), run against the in-memory and the PostgreSQL adapter. */
type DatabaseUnderTest = TableAccess & { begin(): Transaction };
const ADAPTERS: readonly (readonly [string, () => Promise<DatabaseUnderTest>])[] = [
  ['InMemoryDatabase', async () => new InMemoryDatabase()],
  ['PostgresDatabase', async () => (await createTestDatabase()).database],
];

const TICKETS = 'tickets';

describe.each(ADAPTERS)('%s transactions (P1, ADR-13)', (_adapter, newDatabase) => {
async function databaseWithOneTicket(): Promise<DatabaseUnderTest> {
  const database = await newDatabase();
  await database.insert(TICKETS, 't-1', { ticketId: 't-1', state: 'open' });
  return database;
}

  it('shows staged inserts inside the transaction and nowhere else until commit', async () => {
    const database = await newDatabase();
    const transaction = database.begin();
    await transaction.insert(TICKETS, 't-1', { ticketId: 't-1' });
    expect(await transaction.list(TICKETS)).toHaveLength(1);
    expect(await transaction.read(TICKETS, 't-1')).toEqual({ ticketId: 't-1' });
    expect(await database.list(TICKETS)).toHaveLength(0);
    await transaction.commit();
    expect(await database.list(TICKETS)).toHaveLength(1);
  });

  it('discards staged inserts on rollback', async () => {
    const database = await newDatabase();
    const transaction = database.begin();
    await transaction.insert(TICKETS, 't-1', { ticketId: 't-1' });
    await transaction.rollback();
    expect(await database.list(TICKETS)).toHaveLength(0);
  });

  it('applies a replace on commit and shows it only inside the transaction before that', async () => {
    const database = await databaseWithOneTicket();
    const transaction = database.begin();
    await transaction.replace(TICKETS, 't-1', { ticketId: 't-1', state: 'closed' });
    expect(await transaction.read(TICKETS, 't-1')).toEqual({ ticketId: 't-1', state: 'closed' });
    expect(await database.read(TICKETS, 't-1')).toEqual({ ticketId: 't-1', state: 'open' });
    await transaction.commit();
    expect(await database.read(TICKETS, 't-1')).toEqual({ ticketId: 't-1', state: 'closed' });
  });

  it('rolls a replace back with the transaction', async () => {
    const database = await databaseWithOneTicket();
    const transaction = database.begin();
    await transaction.replace(TICKETS, 't-1', { ticketId: 't-1', state: 'closed' });
    await transaction.rollback();
    expect(await database.read(TICKETS, 't-1')).toEqual({ ticketId: 't-1', state: 'open' });
  });

  it('applies a remove on commit and hides the row inside the transaction before that', async () => {
    const database = await databaseWithOneTicket();
    const transaction = database.begin();
    await transaction.remove(TICKETS, 't-1');
    expect(await transaction.read(TICKETS, 't-1')).toBeUndefined();
    expect(await transaction.list(TICKETS)).toHaveLength(0);
    expect(await database.list(TICKETS)).toHaveLength(1);
    await transaction.commit();
    expect(await database.list(TICKETS)).toHaveLength(0);
  });

  it('rolls a remove back with the transaction', async () => {
    const database = await databaseWithOneTicket();
    const transaction = database.begin();
    await transaction.remove(TICKETS, 't-1');
    await transaction.rollback();
    expect(await database.list(TICKETS)).toHaveLength(1);
  });

  it('keeps two open transactions blind to each other\'s staged rows', async () => {
    const database = await newDatabase();
    const first = database.begin();
    const second = database.begin();
    await first.insert(TICKETS, 't-1', { ticketId: 't-1' });
    expect(await second.list(TICKETS)).toHaveLength(0);
  });

  it('refuses a second insert under the same key, and a replace or remove of a key that does not exist', async () => {
    const database = await databaseWithOneTicket();
    const transaction = database.begin();
    await expect(transaction.insert(TICKETS, 't-1', {})).rejects.toThrow('already holds a row with the key t-1');
    await expect(transaction.replace(TICKETS, 'missing', {})).rejects.toThrow('has no row with the key missing');
    await expect(transaction.remove(TICKETS, 'missing')).rejects.toThrow('has no row with the key missing');
  });

  it('refuses to be used after it ended', async () => {
    const transaction = (await newDatabase()).begin();
    await transaction.commit();
    await expect(transaction.insert(TICKETS, 't-1', {})).rejects.toThrow('already committed');
  });

  it('never reaches audit_log: the audit store has its own port (ADR-10, ADR-13)', async () => {
    const database = await newDatabase();
    const transaction = database.begin();
    const refusal = 'audit_log is reachable only through the audit log store';
    await expect(transaction.insert('audit_log', '1', {})).rejects.toThrow(refusal);
    await expect(transaction.read('audit_log', '1')).rejects.toThrow(refusal);
    await expect(transaction.list('audit_log')).rejects.toThrow(refusal);
    await expect(transaction.replace('audit_log', '1', {})).rejects.toThrow(refusal);
    await expect(transaction.remove('audit_log', '1')).rejects.toThrow(refusal);
    await expect(database.insert('audit_log', '1', {})).rejects.toThrow(refusal);
  });
});
