import type { EventPublisher } from '../../../../shared/events/event';
import { refuse, respond, type WriteContext, type WriteOperation, type WriteOutcome } from '../../../../shared/operation-contract';
import type { Transaction } from '../../../../shared/unit-of-work';
import type { PaymentLedger, PayRefusal } from '../../public';
import { PAY_LATER_OR_PAY_CASH } from '../payment-ledger';

/** What the operation needs from the module: a ledger joined to the write's unit of work. */
export interface LedgerFactory {
  ledgerBoundTo(transaction: Transaction, events: EventPublisher): PaymentLedger;
}

export const PAY_IN_APP_OPERATION = 'payments.payInApp';

/** The HTTP status for each refusal. 409 is "the ticket is not in a state to be paid now". */
const STATUS_BY_REFUSAL: Readonly<Record<PayRefusal, number>> = {
  declined: 402,
  'ticket not closed': 409,
  'nothing to pay': 409,
  'not your ticket': 403,
  'payment pending, try again shortly': 409,
};

/**
 * POST /payments/app: a driver pays a closed ticket in the app (task C2). The pipeline has already checked the
 * token, the role, the request id and the body; the handler only runs the ledger and shapes the answer. A refusal
 * carries a status of 400 or above, so the pipeline rolls the unit of work back and keeps no row and no entry. A
 * pending attempt is not a refusal but not a success either: 202 with the attempt and "pay later or pay cash", so the
 * row that blocks a second charge commits (P18) and the driver is never told the ticket is paid.
 */
export function payInAppOperation(payments: LedgerFactory): WriteOperation {
  return {
    kind: 'write',
    name: PAY_IN_APP_OPERATION,
    method: 'POST',
    path: '/payments/app',
    allowedRoles: ['driver'],
    bodySchema: { fields: { ticketId: 'string' } },
    examples: { valid: { ticketId: 'ticket-1' }, invalid: {} },
    async handle(context: WriteContext): Promise<WriteOutcome> {
      const ticketId = context.body['ticketId'];
      if (typeof ticketId !== 'string') {
        throw new Error('The body passed validation without a ticketId string');
      }
      const ledger = payments.ledgerBoundTo(context.transaction, context.events);
      const paid = await ledger.payInApp(context.requestId, ticketId, context.actor.personId);
      if (!paid.ok) {
        return { response: refuse(STATUS_BY_REFUSAL[paid.error], paid.error) };
      }
      if (paid.value.state === 'pending') {
        return { response: respond(202, { payment: paid.value, message: PAY_LATER_OR_PAY_CASH }), audit: {} };
      }
      return { response: respond(201, { payment: paid.value }), audit: {} };
    },
  };
}
