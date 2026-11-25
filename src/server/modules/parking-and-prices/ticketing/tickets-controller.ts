import { ALL_ROLES } from '../../../shared/identifiers';
import { refuse, respond, type Operation, type WriteOperation, type AuditDetail, type ReadContext, type ReadOperation, type ReadOutcome } from '../../../shared/operation-contract';
import type { OpenRefusal, TicketOpening, CloseRefusal, Ticket, TicketClosing, TicketCounts, TicketReading } from './index';
import { SAMPLE_CAR, SAMPLE_ENTRY_CODE, SAMPLE_SITE, SAMPLE_EXIT_CODE, SAMPLE_TICKET, type SampleSeeder } from './sample-rows';
import { TicketReadRefusal, type TicketReadReason } from './ticket-reading';
import type { TicketStore } from './ticket-store';

export const STATUS_FOR_OPEN_REFUSAL: Readonly<Record<OpenRefusal, number>> = {
  'forged code': 403,
  'wrong site': 403,
  'site closed': 409,
  'car already parked': 409,
  'site full': 409,
  'attendant not clocked in at this site': 403,
  'car not registered to this driver': 403,
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
    path: '/tickets',
    allowedRoles: ['driver'],
    bodySchema: { fields: { siteId: 'string', carRef: 'string', entryCode: 'string' } },
    examples: { valid: { siteId: SAMPLE_SITE, carRef: SAMPLE_CAR, entryCode: SAMPLE_ENTRY_CODE }, invalid: { siteId: 7 } },
    async handle({ actor, requestId, body, transaction }) {
      const opened = await opening.openTicket(transaction, {
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
 * What the one audit entry of a close says about the fee: when a lookup the fee depends on failed (residency, a free
 * period), the entry's reason names it, so the normal fee charged under a failed check is traceable (accountability).
 */
export function feeAuditDetail(ticket: Ticket): AuditDetail {
  return ticket.feeWarnings === undefined ? {} : { reason: ticket.feeWarnings.join('; ') };
}

/**
 * A driver scans the exit code. Only the driver who holds the ticket may close it. The exit time is the server
 * clock's; a refusal rolls the unit of work back, so it leaves no audit entry and no event. A success leaves one audit
 * entry (appended by the entry point) and one "ticket closed" event, stored only when the unit of work commits.
 */
export function createCloseTicketOperation(closing: TicketClosing, store: TicketStore, seedSampleTicket: SampleSeeder): Operation {
  const operation: WriteOperation = {
    kind: 'write',
    name: 'ticketing.closeTicket',
    method: 'POST',
    path: '/tickets/:ticketId/closure',
    allowedRoles: ['driver'],
    bodySchema: { fields: { ticketId: 'string', exitCode: 'string' } },
    examples: { valid: { ticketId: SAMPLE_TICKET, exitCode: SAMPLE_EXIT_CODE }, invalid: { ticketId: 7 } },
    fixture: seedSampleTicket,
    async handle({ actor, requestId, body, events, transaction }) {
      const ticketId = String(body['ticketId']);
      const held = await store.findById(transaction, ticketId);
      if (held !== undefined && held.driverRef !== actor.personId) {
        return { response: refuse(403, 'not your ticket') };
      }
      const closed = await closing.closeTicket(transaction, requestId, ticketId, String(body['exitCode']));
      if (!closed.ok) {
        return { response: refuse(STATUS_FOR_CLOSE_REFUSAL[closed.error], closed.error) };
      }
      const { value } = closed;
      events.publish({
        topic: TICKET_CLOSED_TOPIC,
        payload: { ticketId: value.ticketId, siteId: value.siteId, driverRef: value.driverRef, closedAt: value.closedAt, fee: value.fee },
      });
      return { response: respond(200, { ticket: value }), audit: feeAuditDetail(value) };
    },
  };
  return operation;
}

const STATUS_FOR_REASON: Readonly<Record<TicketReadReason, number>> = {
  'unknown ticket': 404,
  'ticket not closed': 409,
};

/**
 * The reads (tasks B11 to B13), each with its scope (P10). A driver's tickets, one of their tickets and the receipt are
 * `own` reads: the role table applies and the handler answers from the actor's own records; a ticket that belongs to
 * someone else answers "not found", so nobody learns that it exists. The receipt shows a plate, so it is a logged read
 * (P9, P28 #33): the pipeline writes the one audit entry naming the reader, the request and the ticket's driver. The
 * free-space count is site configuration and open to any valid token.
 */
export function createReadOperations(reading: TicketReading, counts: TicketCounts): readonly Operation[] {
  return [history(reading), status(reading), receipt(reading), freeSpaces(counts)];
}

function history(reading: TicketReading): ReadOperation {
  return {
    kind: 'read',
    name: 'ticketing.ticketHistory',
    method: 'GET',
    path: '/tickets',
    allowedRoles: ['driver'],
    scope: 'own',
    async handle({ actor, database }) {
      return { response: respond(200, { tickets: await reading.ticketHistory(database, actor.personId) }) };
    },
  };
}

function status(reading: TicketReading): ReadOperation {
  return {
    kind: 'read',
    name: 'ticketing.ticketStatus',
    method: 'GET',
    path: '/tickets/:ticketId',
    allowedRoles: ['driver'],
    scope: 'own',
    async handle(context) {
      return answer(async () => {
        const ticket = await ownTicket(reading, context);
        return { response: respond(200, { ticket }) };
      });
    },
  };
}

function receipt(reading: TicketReading): ReadOperation {
  return {
    kind: 'read',
    name: 'ticketing.receipt',
    method: 'GET',
    path: '/tickets/:ticketId/receipt',
    allowedRoles: ['driver', 'attendant'],
    scope: 'own',
    logged: true,
    audit: { touchesPersonalData: true },
    async handle(context) {
      return answer(async () => {
        const ticket = await ownTicket(reading, context);
        const printed = await reading.receipt(context.database, ticket.ticketId, context.actor.personId);
        return { response: respond(200, { receipt: printed }), audit: { subjectPersonIds: [ticket.driverRef] } };
      });
    },
  };
}

function freeSpaces(counts: TicketCounts): ReadOperation {
  return {
    kind: 'read',
    name: 'ticketing.freeSpaces',
    method: 'GET',
    path: '/sites/:siteId/free-spaces',
    allowedRoles: ALL_ROLES,
    scope: 'open',
    async handle({ query, database }) {
      const siteId = query['siteId'] ?? '';
      return { response: respond(200, { siteId, freeSpaces: await counts.freeSpaces(database, siteId) }) };
    },
  };
}

async function ownTicket(reading: TicketReading, { actor, query, database }: ReadContext) {
  const ticket = await reading.ticketStatus(database, query['ticketId'] ?? '');
  if (actor.role === 'driver' && ticket.driverRef !== actor.personId) {
    throw new TicketReadRefusal('unknown ticket');
  }
  return ticket;
}

async function answer(read: () => Promise<ReadOutcome>): Promise<ReadOutcome> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof TicketReadRefusal) {
      return { response: refuse(STATUS_FOR_REASON[error.reason], error.reason) };
    }
    throw error;
  }
}
