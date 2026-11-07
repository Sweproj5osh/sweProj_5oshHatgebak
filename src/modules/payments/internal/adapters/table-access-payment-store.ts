import type { TicketId } from '../../../../shared/identifiers';
import type { RequestId } from '../../../../shared/request-id';
import type { TableAccess } from '../../../../shared/unit-of-work';
import type { PaymentStore, StoredPayment } from '../ports';

/** The table name inside the foundation's database, mirroring the `payments` schema. */
export const PAYMENTS_TABLE = 'payments.payments';

/**
 * The payments table over the unit of work's table access (ADR-13). Given a write's transaction, every row it adds is
 * staged and lands only when that transaction commits; given the database itself, a row lands at once (for tests).
 */
export class TableAccessPaymentStore implements PaymentStore {
  constructor(private readonly tables: TableAccess) {}

  async add(payment: StoredPayment): Promise<void> {
    await this.tables.insert(PAYMENTS_TABLE, payment.paymentId, payment);
  }

  async replace(payment: StoredPayment): Promise<void> {
    await this.tables.replace(PAYMENTS_TABLE, payment.paymentId, payment);
  }

  async forTicket(ticketId: TicketId): Promise<readonly StoredPayment[]> {
    return (await this.all()).filter((payment) => payment.ticketId === ticketId);
  }

  async byRequestId(requestId: RequestId): Promise<StoredPayment | undefined> {
    return (await this.all()).find((payment) => payment.requestId === requestId);
  }

  private all(): Promise<readonly StoredPayment[]> {
    return this.tables.list<StoredPayment>(PAYMENTS_TABLE);
  }
}
