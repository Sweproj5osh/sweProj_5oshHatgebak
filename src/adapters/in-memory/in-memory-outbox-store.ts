import { randomUUID } from 'node:crypto';
import type { Clock } from '../../shared/clock';
import type { DomainEvent, EventPublisher, OutboxStore, StoredEvent } from '../../shared/events/event';
import type { InMemoryDatabase, TableAccess } from './in-memory-database';

export const OUTBOX_TABLE = 'outbox';

export class InMemoryOutboxStore implements OutboxStore {
  constructor(
    private readonly database: InMemoryDatabase,
    private readonly clock: Clock,
  ) {}

  /** A publisher whose events are stored only when `access` (normally a transaction) commits. */
  publisherBoundTo(access: TableAccess): EventPublisher {
    return {
      publish: (event: DomainEvent) => access.insert(OUTBOX_TABLE, this.toStoredEvent(event)),
    };
  }

  async undelivered(): Promise<readonly StoredEvent[]> {
    return this.database.rows<StoredEvent>(OUTBOX_TABLE).filter((event) => event.deliveredAt === null);
  }

  async markDelivered(eventId: string, deliveredAt: string): Promise<void> {
    this.database.replaceWhere<StoredEvent>(
      OUTBOX_TABLE,
      (event) => event.id === eventId,
      (event) => ({ ...event, deliveredAt, deliveryAttempts: event.deliveryAttempts + 1 }),
    );
  }

  async recordFailedAttempt(eventId: string): Promise<void> {
    this.database.replaceWhere<StoredEvent>(
      OUTBOX_TABLE,
      (event) => event.id === eventId,
      (event) => ({ ...event, deliveryAttempts: event.deliveryAttempts + 1 }),
    );
  }

  allEvents(): readonly StoredEvent[] {
    return this.database.rows<StoredEvent>(OUTBOX_TABLE);
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
