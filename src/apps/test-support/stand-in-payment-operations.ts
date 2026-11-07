/**
 * Stand-in for Amina's `payments.payInApp` (on main, not yet in the composed registry) for the data-layer tests only
 * (P14; deleted when her line joins composition.ts and the tests compose the real module). It declares her exact
 * schema, `{ ticketId }`, so a client that sent an amount would be refused by the pipeline's body validation, and
 * answers as her operation does: 201 with the payment, 202 with a pending attempt and "pay later or pay cash", 409
 * refusals by word.
 */
import type { TicketId } from '../../shared/identifiers';
import { refuse, respond, type Operation, type WriteOperation } from '../../shared/operation-contract';
import { PAY_LATER_OR_PAY_CASH } from '../shared-client/payments/driver-payment-api';
import { DRIVER_PAY_OPERATION, DRIVER_PAY_PATH } from '../shared-client/payments/driver-payment-routes';

export interface StandInPaymentState {
  readonly feeOfClosedUnpaidTicket: Map<TicketId, number>;
  readonly providerTimesOutFor: Set<TicketId>;
  readonly paid: Set<TicketId>;
  paymentsMade: number;
}

export function createStandInPaymentState(
  closedUnpaidTickets: readonly { readonly ticketId: TicketId; readonly fee: number }[],
  providerTimesOutFor: readonly TicketId[] = [],
): StandInPaymentState {
  return {
    feeOfClosedUnpaidTicket: new Map(closedUnpaidTickets.map((ticket) => [ticket.ticketId, ticket.fee])),
    providerTimesOutFor: new Set(providerTimesOutFor),
    paid: new Set(),
    paymentsMade: 0,
  };
}

export function createStandInPaymentOperations(state: StandInPaymentState): readonly Operation[] {
  return [payInApp(state)];
}

function payInApp(state: StandInPaymentState): WriteOperation {
  return {
    kind: 'write',
    name: DRIVER_PAY_OPERATION,
    method: 'POST',
    path: DRIVER_PAY_PATH,
    allowedRoles: ['driver'],
    bodySchema: { fields: { ticketId: 'string' } },
    examples: { valid: { ticketId: 'ticket-1' }, invalid: {} },
    async handle({ body }) {
      const ticketId = String(body['ticketId']);
      const fee = state.feeOfClosedUnpaidTicket.get(ticketId);
      if (fee === undefined) {
        return { response: refuse(409, 'ticket not closed') };
      }
      if (state.paid.has(ticketId)) {
        return { response: refuse(409, 'nothing to pay') };
      }
      state.paymentsMade += 1;
      const paymentId = `payment-${state.paymentsMade}`;
      if (state.providerTimesOutFor.has(ticketId)) {
        const payment = { paymentId, ticketId, amount: fee, method: 'app', state: 'pending' };
        return { response: respond(202, { payment, message: PAY_LATER_OR_PAY_CASH }), audit: {} };
      }
      state.paid.add(ticketId);
      const payment = { paymentId, ticketId, amount: fee, method: 'app', state: 'paid' };
      return { response: respond(201, { payment }), audit: {} };
    },
  };
}
