import { ALL_ROLES } from '../../../shared/identifiers';
import { refuse, respond, type Operation, type ReadContext, type ReadOperation, type ReadOutcome } from '../../../shared/operation-contract';
import type { TicketCounts, TicketReading } from '../public';
import { TicketReadRefusal, type TicketReadReason } from './ticket-reading';

const STATUS_FOR_REASON: Readonly<Record<TicketReadReason, number>> = {
  'unknown ticket': 404,
  'ticket not closed': 409,
  'plate read refused': 403,
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
    path: '/tickets/status',
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
    path: '/tickets/receipt',
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
    path: '/tickets/free-spaces',
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
