import { refuse, respond, type Operation, type ReadContext, type ReadOperation } from '../../../shared/operation-contract';
import type { TicketReading } from '../public';
import { TicketReadRefusal, type TicketReadReason } from './ticket-reading';

const STATUS_FOR_REASON: Readonly<Record<TicketReadReason, number>> = {
  'unknown ticket': 404,
  'ticket not closed': 409,
  'plate read refused': 403,
};

/**
 * What a driver may see (tasks B12 and B13): their own tickets, one of their own tickets, the receipt of a closed
 * one. A ticket that belongs to someone else answers "not found", so nobody learns that it exists. A receipt asks the
 * identity area for the plate, which logs the read and decides whether this reader may see it.
 */
export function createReadOperations(reading: TicketReading): readonly Operation[] {
  return [history(reading), status(reading), receipt(reading)];
}

function history(reading: TicketReading): ReadOperation {
  return {
    kind: 'read',
    name: 'ticketing.ticketHistory',
    method: 'GET',
    path: '/tickets',
    allowedRoles: ['driver'],
    async handle({ actor, database }) {
      return respond(200, { tickets: await reading.ticketHistory(database, actor.personId) });
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
    async handle(context) {
      return answer(async () => {
        const ticket = await ownTicket(reading, context);
        return respond(200, { ticket });
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
    async handle(context) {
      return answer(async () => {
        const ticket = await ownTicket(reading, context);
        return respond(200, { receipt: await reading.receipt(context.database, ticket.ticketId, context.actor.personId) });
      });
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

async function answer(read: () => Promise<ReturnType<typeof respond>>) {
  try {
    return await read();
  } catch (error) {
    if (error instanceof TicketReadRefusal) {
      return refuse(STATUS_FOR_REASON[error.reason], error.reason);
    }
    throw error;
  }
}
