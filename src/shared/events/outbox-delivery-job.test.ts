import { describe, expect, it } from 'vitest';
import { InMemoryDatabase } from '../../adapters/in-memory/in-memory-database';
import { InMemoryOutboxStore } from '../../adapters/in-memory/in-memory-outbox-store';
import { FixedClock } from '../clock';
import type { EventSubscriber, StoredEvent } from './event';
import { OutboxDeliveryJob } from './outbox-delivery-job';

const clock = new FixedClock(new Date('2026-11-04T10:00:00Z'));

/** A subscriber that tolerates duplicates by remembering event ids, and can be told to fail once. */
class RecordingSubscriber implements EventSubscriber {
  readonly name: string;
  readonly handledIds = new Set<string>();
  deliveries = 0;
  private failOnTopic: string | undefined;

  constructor(name: string) {
    this.name = name;
  }

  failOnceOn(topic: string): void {
    this.failOnTopic = topic;
  }

  async handle(event: StoredEvent): Promise<void> {
    if (this.failOnTopic === event.topic) {
      this.failOnTopic = undefined;
      throw new Error(`${this.name} crashed while handling ${event.topic}`);
    }
    this.deliveries += 1;
    this.handledIds.add(event.id);
  }
}

function setUp(...subscribers: EventSubscriber[]) {
  const database = new InMemoryDatabase();
  const outbox = new InMemoryOutboxStore(database, clock);
  const job = new OutboxDeliveryJob(outbox, subscribers, clock);
  return { database, outbox, job };
}

describe('outbox', () => {
  it('writes nothing when the publishing transaction rolls back', async () => {
    const { database, outbox } = setUp();
    const transaction = database.begin();
    outbox.publisherBoundTo(transaction).publish({ topic: 'TicketClosed', payload: { ticketId: 't-1' } });
    await transaction.rollback();
    expect(outbox.allEvents()).toHaveLength(0);
  });

  it('writes one row when the publishing transaction commits', async () => {
    const { database, outbox } = setUp();
    const transaction = database.begin();
    outbox.publisherBoundTo(transaction).publish({ topic: 'TicketClosed', payload: { ticketId: 't-1' } });
    await transaction.commit();
    expect(outbox.allEvents()).toHaveLength(1);
    expect(await outbox.undelivered()).toHaveLength(1);
  });

  it('delivers each event to every subscriber and marks it delivered', async () => {
    const notifications = new RecordingSubscriber('notifications');
    const dashboard = new RecordingSubscriber('dashboard');
    const { database, outbox, job } = setUp(notifications, dashboard);
    await publishCommitted(database, outbox, 'TicketClosed');

    const report = await job.run();

    expect(report).toEqual({ delivered: 1, failed: 0 });
    expect(notifications.deliveries).toBe(1);
    expect(dashboard.deliveries).toBe(1);
    expect(await outbox.undelivered()).toHaveLength(0);
    expect(outbox.allEvents()[0]?.deliveredAt).toBe('2026-11-04T10:00:00.000Z');
  });

  it('loses no event when a subscriber crashes mid-way; the rerun redelivers and handlers tolerate the duplicate', async () => {
    const first = new RecordingSubscriber('first');
    const second = new RecordingSubscriber('second');
    second.failOnceOn('TicketPaid');
    const { database, outbox, job } = setUp(first, second);
    await publishCommitted(database, outbox, 'TicketClosed');
    await publishCommitted(database, outbox, 'TicketPaid');

    const crashedRun = await job.run();
    expect(crashedRun).toEqual({ delivered: 1, failed: 1 });
    expect(await outbox.undelivered()).toHaveLength(1);

    const rerun = await job.run();
    expect(rerun).toEqual({ delivered: 1, failed: 0 });
    expect(await outbox.undelivered()).toHaveLength(0);
    expect(first.deliveries).toBe(3);
    expect(first.handledIds.size).toBe(2);
    expect(second.handledIds.size).toBe(2);
    console.log(`Z7 report: redelivery count ${first.deliveries - first.handledIds.size}`);
  });
});

async function publishCommitted(database: InMemoryDatabase, outbox: InMemoryOutboxStore, topic: string) {
  const transaction = database.begin();
  outbox.publisherBoundTo(transaction).publish({ topic, payload: { topic } });
  await transaction.commit();
}
