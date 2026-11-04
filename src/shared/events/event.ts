/** An event published by a module after its write committed, delivered later by the outbox job (ADR-07). */
export interface DomainEvent {
  readonly topic: string;
  readonly payload: unknown;
}

/** A row in the outbox: the event plus delivery bookkeeping. */
export interface StoredEvent extends DomainEvent {
  readonly id: string;
  readonly publishedAt: string;
  readonly deliveredAt: string | null;
  readonly deliveryAttempts: number;
}

/** Bound to one unit of work: a published event is stored only when that unit of work commits. */
export interface EventPublisher {
  publish(event: DomainEvent): void;
}

/** A reactor. Handlers receive each event at least once, so they must tolerate a repeat of the same event id. */
export interface EventSubscriber {
  readonly name: string;
  handle(event: StoredEvent): Promise<void>;
}

/** The storage port the delivery job reads from and marks. */
export interface OutboxStore {
  undelivered(): Promise<readonly StoredEvent[]>;
  markDelivered(eventId: string, deliveredAt: string): Promise<void>;
  recordFailedAttempt(eventId: string): Promise<void>;
}
