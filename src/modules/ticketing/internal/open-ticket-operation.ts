import { refuse, respond, type Operation, type WriteOperation } from '../../../shared/operation-contract';
import type { OpenRefusal, TicketOpening } from '../public';

export const STATUS_FOR_OPEN_REFUSAL: Readonly<Record<OpenRefusal, number>> = {
  'forged code': 403,
  'wrong site': 403,
  'site closed': 409,
  'car already parked': 409,
  'site full': 409,
  'attendant not assigned to this site': 403,
};

/**
 * A driver scans the entry code. The entry point has already checked the token, the role, the request id and that
 * the body carries no time; the entry time is set here from the server clock. A refusal rolls the unit of work back,
 * so it leaves no audit entry; a success leaves exactly one, appended by the entry point.
 */
export function createOpenTicketOperation(opening: TicketOpening): Operation {
  const operation: WriteOperation = {
    kind: 'write',
    name: 'ticketing.openTicket',
    method: 'POST',
    path: '/tickets/open',
    allowedRoles: ['driver'],
    bodySchema: { fields: { siteId: 'string', carRef: 'string', entryCode: 'string' } },
    examples: { valid: { siteId: 'site-1', carRef: 'car-1', entryCode: 'entry-site-1' }, invalid: { siteId: 7 } },
    async handle({ actor, requestId, body }) {
      const opened = await opening.openTicket({
        requestId,
        driverRef: actor.personId,
        carRef: String(body['carRef']),
        siteId: String(body['siteId']),
        entryCode: String(body['entryCode']),
      });
      if (!opened.ok) {
        return { response: refuse(STATUS_FOR_OPEN_REFUSAL[opened.error], opened.error) };
      }
      return { response: respond(201, { ticket: opened.value }) };
    },
  };
  return operation;
}
