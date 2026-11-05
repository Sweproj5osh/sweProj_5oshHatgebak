import { describe, expect, it } from 'vitest';
import { InMemoryDatabase } from './in-memory-database';

describe('InMemoryDatabase transactions', () => {
  it('shows staged rows inside the transaction and nowhere else until commit', async () => {
    const database = new InMemoryDatabase();
    const transaction = database.begin();
    transaction.insert('tickets', { ticketId: 't-1' });
    expect(transaction.rows('tickets')).toHaveLength(1);
    expect(database.rows('tickets')).toHaveLength(0);
    await transaction.commit();
    expect(database.rows('tickets')).toHaveLength(1);
  });

  it('discards staged rows on rollback', async () => {
    const database = new InMemoryDatabase();
    const transaction = database.begin();
    transaction.insert('tickets', { ticketId: 't-1' });
    await transaction.rollback();
    expect(database.rows('tickets')).toHaveLength(0);
  });

  it('refuses to be used after it ended', async () => {
    const transaction = new InMemoryDatabase().begin();
    await transaction.commit();
    expect(() => transaction.insert('tickets', {})).toThrow('already committed');
  });
});
