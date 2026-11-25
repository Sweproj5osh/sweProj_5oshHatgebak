import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Clock } from '../../shared/clock';
import type { DomainEvent, EventPublisher, OutboxStore, StoredEvent } from '../../shared/events/event';
import type { PostgresTransaction, Queryable } from './postgres-database';

interface OutboxRow extends pg.QueryResultRow {
  readonly id: string;
  readonly topic: string;
  readonly payload: unknown;
  readonly published_at: Date;
  readonly delivered_at: Date | null;
  readonly delivery_attempts: number;
}

const COLUMNS = 'id, topic, payload, published_at, delivered_at, delivery_attempts';

/** The outbox over `foundation.outbox` (ADR-07): events stored in the publisher's transaction, delivered in publish order. */
export class PostgresOutboxStore implements OutboxStore {
  constructor(
    private readonly committed: Queryable,
    private readonly clock: Clock,
  ) {}

  /**
   * A publisher whose events are stored only when `transaction` commits. `publish` stays synchronous (the port's
   * shape): the event's id and time are fixed at once, the insert is queued on the transaction, and COMMIT waits for it.
   */
  publisherBoundTo(transaction: PostgresTransaction): EventPublisher {
    return {
      publish: (event: DomainEvent) => {
        const stored = this.toStoredEvent(event);
        transaction.awaitBeforeCommit(
          transaction.query(`INSERT INTO foundation.outbox (id, topic, payload, published_at, delivered_at, delivery_attempts) VALUES ($1, $2, $3::json, $4, NULL, 0)`, [
            stored.id,
            stored.topic,
            JSON.stringify(stored.payload ?? null),
            stored.publishedAt,
          ]),
        );
      },
    };
  }

  async undelivered(): Promise<readonly StoredEvent[]> {
    const result = await this.committed.query<OutboxRow>(`SELECT ${COLUMNS} FROM foundation.outbox WHERE delivered_at IS NULL ORDER BY position`);
    return result.rows.map(eventFrom);
  }

  async markDelivered(eventId: string, deliveredAt: string): Promise<void> {
    await this.update('UPDATE foundation.outbox SET delivered_at = $2, delivery_attempts = delivery_attempts + 1 WHERE id = $1', [eventId, deliveredAt], eventId);
  }

  async recordFailedAttempt(eventId: string): Promise<void> {
    await this.update('UPDATE foundation.outbox SET delivery_attempts = delivery_attempts + 1 WHERE id = $1', [eventId], eventId);
  }

  /** Every stored event in publish order, delivered or not: for the tests and the operator. */
  async allEvents(): Promise<readonly StoredEvent[]> {
    const result = await this.committed.query<OutboxRow>(`SELECT ${COLUMNS} FROM foundation.outbox ORDER BY position`);
    return result.rows.map(eventFrom);
  }

  private async update(sql: string, values: readonly unknown[], eventId: string): Promise<void> {
    const result = await this.committed.query(sql, values);
    if (result.rowCount === 0) {
      throw new Error(`The outbox holds no event with the id ${eventId}`);
    }
  }

  private toStoredEvent(event: DomainEvent): StoredEvent {
    return {
      ...event,
      id: randomUUID(),
      publishedAt: this.clock.now().toISOString(),
      deliveredAt: null,
      deliveryAttempts: 0,
    };
  }
}

function eventFrom(row: OutboxRow): StoredEvent {
  return {
    topic: row.topic,
    payload: row.payload,
    id: row.id,
    publishedAt: row.published_at.toISOString(),
    deliveredAt: row.delivered_at === null ? null : row.delivered_at.toISOString(),
    deliveryAttempts: row.delivery_attempts,
  };
}
