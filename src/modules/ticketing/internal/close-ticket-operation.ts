import { refuse, respond, type Operation, type WriteOperation } from '../../../shared/operation-contract';
import type { CloseRefusal, TicketClosing } from '../public';
import type { TicketStore } from './ticket-store';

export const STATUS_FOR_CLOSE_REFUSAL: Readonly<Record<CloseRefusal, number>> = {
  'forged code': 403,
  'wrong site': 403,
  'no open ticket': 409,
  'exit before entry': 409,
  'no price known': 409,
  'not an assisted ticket': 409,
  'attendant not clocked in at this site': 403,
  'car does not match': 409,
};

export const TICKET_CLOSED_TOPIC = 'ticket.closed';

/**
 * A driver scans the exit code. Only the driver who holds the ticket may close it. The exit time is the server
 * clock's; a refusal rolls the unit of work back, so it leaves no audit entry and no event. A success leaves one audit
 * entry (appended by the entry point) and one "ticket closed" event, stored only when the unit of work commits.
 */
export function createCloseTicketOperation(closing: TicketClosing, store: TicketStore): Operation {
  const operation: WriteOperation = {
    kind: 'write',
    name: 'ticketing.closeTicket',
    method: 'POST',
    path: '/tickets/close',
    allowedRoles: ['driver'],
    bodySchema: { fields: { ticketId: 'string', exitCode: 'string' } },
    examples: { valid: { ticketId: 'ticket-1', exitCode: 'exit-site-1' }, invalid: { ticketId: 7 } },
    async handle({ actor, requestId, body, events }) {
      const ticketId = String(body['ticketId']);
      const held = await store.findById(ticketId);
      if (held !== undefined && held.driverRef !== actor.personId) {
        return { response: refuse(403, 'not your ticket') };
      }
      const closed = await closing.closeTicket(requestId, ticketId, String(body['exitCode']));
      if (!closed.ok) {
        return { response: refuse(STATUS_FOR_CLOSE_REFUSAL[closed.error], closed.error) };
      }
      const { value } = closed;
      events.publish({
        topic: TICKET_CLOSED_TOPIC,
        payload: { ticketId: value.ticketId, siteId: value.siteId, driverRef: value.driverRef, closedAt: value.closedAt, fee: value.fee },
      });
      return { response: respond(200, { ticket: value }) };
    },
  };
  return operation;
}
