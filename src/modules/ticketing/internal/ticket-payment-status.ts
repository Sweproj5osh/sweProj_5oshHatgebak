import type { PaymentStatus, TicketPaymentStatus } from '../public';
import type { TicketStore } from './ticket-store';

/**
 * The only paths a payment status may take. Paid and waived are final: a paid ticket cannot be waived because the
 * money would have to go back, and nothing returns to unpaid.
 */
export const ALLOWED_PAYMENT_CHANGES: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  unpaid: ['paid', 'disputed', 'waived'],
  disputed: ['paid', 'waived'],
  paid: [],
  waived: [],
};

export function createTicketPaymentStatusService(store: TicketStore): TicketPaymentStatus {
  return {
    changePaymentStatus(unitOfWork, requestId, ticketId, to) {
      return store.changePaymentStatus(unitOfWork, { requestKey: `payment:${requestId}:${ticketId}`, ticketId, to });
    },
  };
}
