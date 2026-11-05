import type { Clock } from '../clock';
import type { EventSubscriber, OutboxStore, StoredEvent } from './event';

export interface DeliveryReport {
  readonly delivered: number;
  readonly failed: number;
}

/**
 * Hands every undelivered event to every subscriber, then marks the event delivered.
 * A subscriber that throws leaves the event unmarked, so the next run redelivers it: at-least-once delivery.
 */
export class OutboxDeliveryJob {
  constructor(
    private readonly store: OutboxStore,
    private readonly subscribers: readonly EventSubscriber[],
    private readonly clock: Clock,
  ) {}

  async run(): Promise<DeliveryReport> {
    let delivered = 0;
    let failed = 0;
    for (const event of await this.store.undelivered()) {
      const succeeded = await this.deliverToAllSubscribers(event);
      if (succeeded) {
        delivered += 1;
      } else {
        failed += 1;
      }
    }
    return { delivered, failed };
  }

  private async deliverToAllSubscribers(event: StoredEvent): Promise<boolean> {
    try {
      for (const subscriber of this.subscribers) {
        await subscriber.handle(event);
      }
      await this.store.markDelivered(event.id, this.clock.now().toISOString());
      return true;
    } catch {
      await this.store.recordFailedAttempt(event.id);
      return false;
    }
  }
}
