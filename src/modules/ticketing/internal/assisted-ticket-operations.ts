import { refuse, respond, type Operation, type WriteOperation } from '../../../shared/operation-contract';
import type { Actor } from '../../../shared/identifiers';
import type { ClockedInAttendant, TicketClosing, TicketOpening } from '../public';
import { STATUS_FOR_CLOSE_REFUSAL, TICKET_CLOSED_TOPIC } from './close-ticket-operation';
import { STATUS_FOR_OPEN_REFUSAL } from './open-ticket-operation';

/**
 * The two requests an attendant uses for a driver without a phone. The attendant is proven by the entry point: the
 * token names them and `actor.boundSiteId` is the site their clock-in bound the session to (P26 Q4); both requests are
 * refused unless that site is the ticket's. The photo reference is recorded in the audit entry through the request
 * body; the body schema has no optional field, so an empty text means no photo. The Staff App is where a photo is made
 * mandatory, because the photo store may fail without stopping parking (ADR-03).
 */
export function createAssistedTicketOperations(opening: TicketOpening, closing: TicketClosing): readonly Operation[] {
  return [openAssisted(opening), closeAssisted(closing)];
}

function openAssisted(opening: TicketOpening): WriteOperation {
  return {
    kind: 'write',
    name: 'ticketing.openAssistedTicket',
    method: 'POST',
    path: '/tickets/open-assisted',
    allowedRoles: ['attendant'],
    bodySchema: { fields: { siteId: 'string', carRef: 'string', driverRef: 'string', entryCode: 'string', photoId: 'string' } },
    examples: {
      valid: { siteId: 'site-1', carRef: 'car-1', driverRef: 'driver-9', entryCode: 'entry-site-1', photoId: 'photo-1' },
      invalid: { siteId: 7 },
    },
    async handle({ actor, requestId, body, transaction }) {
      const driverRef = String(body['driverRef']);
      const opened = await opening.openAssistedTicket(
        transaction,
        { requestId, driverRef, carRef: String(body['carRef']), siteId: String(body['siteId']), entryCode: String(body['entryCode']) },
        clockedInAttendant(actor),
      );
      if (!opened.ok) {
        return { response: refuse(STATUS_FOR_OPEN_REFUSAL[opened.error], opened.error) };
      }
      return { response: respond(201, { ticket: opened.value }), audit: { subjectPersonIds: [driverRef] } };
    },
  };
}

function closeAssisted(closing: TicketClosing): WriteOperation {
  return {
    kind: 'write',
    name: 'ticketing.closeAssistedTicket',
    method: 'POST',
    path: '/tickets/close-assisted',
    allowedRoles: ['attendant'],
    bodySchema: { fields: { ticketId: 'string', carRef: 'string', exitCode: 'string', photoId: 'string' } },
    examples: {
      valid: { ticketId: 'ticket-1', carRef: 'car-1', exitCode: 'exit-site-1', photoId: 'photo-2' },
      invalid: { ticketId: 7 },
    },
    async handle({ actor, requestId, body, events, transaction }) {
      const closed = await closing.closeAssistedTicket(
        transaction,
        requestId,
        String(body['ticketId']),
        String(body['exitCode']),
        clockedInAttendant(actor),
        String(body['carRef']),
      );
      if (!closed.ok) {
        return { response: refuse(STATUS_FOR_CLOSE_REFUSAL[closed.error], closed.error) };
      }
      const { value } = closed;
      events.publish({
        topic: TICKET_CLOSED_TOPIC,
        payload: { ticketId: value.ticketId, siteId: value.siteId, driverRef: value.driverRef, closedAt: value.closedAt, fee: value.fee },
      });
      return { response: respond(200, { ticket: value }), audit: { subjectPersonIds: [value.driverRef] } };
    },
  };
}

function clockedInAttendant(actor: Actor): ClockedInAttendant {
  return actor.boundSiteId === undefined ? { attendantId: actor.personId } : { attendantId: actor.personId, boundSiteId: actor.boundSiteId };
}
