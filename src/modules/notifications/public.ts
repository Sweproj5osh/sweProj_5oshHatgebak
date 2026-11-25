/**
 * Notifications — owner: Teammate D (Area 5). May-fail set.
 * Reacts to ticket closed, ticket paid, request awaiting the Chair, deposit confirmed; sends through the
 * MessageDelivery port; a failing delivery never fails the action it reacts to (Rule D).
 */
import type { PersonId } from '../../server/shared/identifiers';
import type { EventSubscriber } from '../../server/shared/events/event';

export interface Message {
  readonly to: PersonId;
  readonly text: string;
}

/** Port to the push or SMS provider (ADR-11). */
export interface MessageDelivery {
  send(message: Message): Promise<void>;
}

export interface Notifier extends EventSubscriber {
  retryFailedDeliveries(): Promise<number>;
}
