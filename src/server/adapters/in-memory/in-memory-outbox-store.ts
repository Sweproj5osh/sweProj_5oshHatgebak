import { randomUUID } from 'node:crypto';
import type { Clock } from '../../shared/clock';
import type { DomainEvent, EventPublisher, OutboxStore, StoredEvent } from '../../shared/events/event';
import type { InMemoryDatabase, RowTables } from './in-memory-database';

export const OUTBOX_TABLE = 'outbox';

export class InMemoryOutboxStore implements OutboxStore {
  constructor(
    private readonly database: InMemoryDatabase,
    private readonly clock: Clock,
  ) {}

  /** A publisher whose events are stored only when `tables` (normally a transaction's view) commits. */
  publisherBoundTo(tables: RowTables): EventPublisher {
    return {
      publish: (event: DomainEvent) => {
        const stored = this.toStoredEvent(event);
        tables.insert(OUTBOX_TABLE, stored.id, stored);
      },
    };
  }

  async undelivered(): Promise<readonly StoredEvent[]> {
    return this.allEvents().filter((event) => event.deliveredAt === null);
  }

  async markDelivered(eventId: string, deliveredAt: string): Promise<void> {
    const event = this.existing(eventId);
    this.database.tables.replace(OUTBOX_TABLE, eventId, { ...event, deliveredAt, deliveryAttempts: event.deliveryAttempts + 1 });
  }

  async recordFailedAttempt(eventId: string): Promise<void> {
    const event = this.existing(eventId);
    this.database.tables.replace(OUTBOX_TABLE, eventId, { ...event, deliveryAttempts: event.deliveryAttempts + 1 });
  }

  allEvents(): readonly StoredEvent[] {
    return this.database.tables.list<StoredEvent>(OUTBOX_TABLE);
  }

  private existing(eventId: string): StoredEvent {
    const event = this.database.tables.find<StoredEvent>(OUTBOX_TABLE, eventId);
    if (event === undefined) {
      throw new Error(`The outbox holds no event with the id ${eventId}`);
    }
    return event;
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
