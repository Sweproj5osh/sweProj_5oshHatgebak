import type { TicketId } from '../../../shared/identifiers';
import type { RequestId } from '../../../shared/request-id';
import type { PaymentRecord } from '../public';

/**
 * Storage ports owned by this module. The in-memory adapter in `adapters/` implements them for every test; the
 * PostgreSQL adapter will implement the same ports over the `payments` schema.
 */

/** One row of the payments table: the public record plus what the module keeps for itself. */
export interface StoredPayment extends PaymentRecord {
  /** The request id of the write that created the row; the provider's idempotency key (ADR-08). */
  readonly requestId: RequestId;
  readonly payerId: string;
  /** Server time, from the clock (Rule I). */
  readonly recordedAt: string;
  /** When the provider's final answer was recorded on the attempt; absent while it is pending. */
  readonly settledAt?: string;
}

/**
 * The payments table. An attempt's row is added before the provider is asked and its state is replaced when the
 * answer arrives (P18); amounts are never edited, a correction is a new row (task C7).
 */
export interface PaymentStore {
  add(payment: StoredPayment): Promise<void>;
  replace(payment: StoredPayment): Promise<void>;
  forTicket(ticketId: TicketId): Promise<readonly StoredPayment[]>;
  /** The row a request id already created, if any: a repeat must find it before the provider is called (C3). */
  byRequestId(requestId: RequestId): Promise<StoredPayment | undefined>;
}

