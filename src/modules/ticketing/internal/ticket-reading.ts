import type { SiteId } from '../../../shared/identifiers';
import type { ClosedTicketSummary, Receipt, Ticket, TicketReading, TicketReadingDependencies } from '../public';

export type TicketReadReason = 'unknown ticket' | 'ticket not closed';

/** Why a read could not be answered; the entry point turns the reason into a status code. */
export class TicketReadRefusal extends Error {
  constructor(readonly reason: TicketReadReason) {
    super(reason);
    this.name = 'TicketReadRefusal';
  }
}

/**
 * Shown on a receipt in place of the plate when the identity area cannot resolve it (its owner was erased, task A5) or
 * refuses this reader. The receipt itself is still issued: the fee, the hours and the times are the driver's to see.
 */
export const PLATE_UNAVAILABLE = 'unavailable';

export function createTicketReadingService(dependencies: TicketReadingDependencies): TicketReading {
  const { store, plates, fees } = dependencies;

  return {
    async ticketStatus(tables, ticketId) {
      const ticket = await store.findById(tables, ticketId);
      if (ticket === undefined) {
        throw new TicketReadRefusal('unknown ticket');
      }
      return ticket;
    },

    ticketHistory: (tables, driverRef) => store.listByDriver(tables, driverRef),

    async frequentSites(tables, driverRef) {
      return sitesByVisits(await store.listByDriver(tables, driverRef));
    },

    async closedTicketsBetween(tables, siteId, from, to) {
      return (await store.listClosedAt(tables, siteId, from, to)).flatMap(summaryOf);
    },

    async receipt(tables, ticketId, reader): Promise<Receipt> {
      const ticket = await store.findById(tables, ticketId);
      if (ticket === undefined) {
        throw new TicketReadRefusal('unknown ticket');
      }
      if (ticket.state !== 'closed' || ticket.closedAt === undefined || ticket.fee === undefined) {
        throw new TicketReadRefusal('ticket not closed');
      }
      const looked = await plates.readPlate({ carRef: ticket.carRef, reader, purpose: 'receipt', siteId: ticket.siteId });
      return {
        ticketId: ticket.ticketId,
        siteId: ticket.siteId,
        openedAt: ticket.openedAt,
        closedAt: ticket.closedAt,
        hours: fees.startedHours(new Date(ticket.openedAt), new Date(ticket.closedAt)),
        fee: ticket.fee,
        plate: looked.ok ? looked.value : PLATE_UNAVAILABLE,
      };
    },
  };
}

/** Sites by number of visits, most visited first; the list arrives newest first, so equally visited sites keep the most recent first. */
function sitesByVisits(ticketsNewestFirst: readonly Ticket[]): readonly SiteId[] {
  const visits = new Map<SiteId, number>();
  for (const ticket of ticketsNewestFirst) {
    visits.set(ticket.siteId, (visits.get(ticket.siteId) ?? 0) + 1);
  }
  return [...visits.entries()].sort((a, b) => b[1] - a[1]).map(([siteId]) => siteId);
}

/** A closed ticket always carries its exit time and fee; the type leaves them optional because an open ticket has none. */
function summaryOf(ticket: Ticket): ClosedTicketSummary[] {
  if (ticket.closedAt === undefined || ticket.fee === undefined) {
    return [];
  }
  return [{ ticketId: ticket.ticketId, closedAt: ticket.closedAt, fee: ticket.fee, paymentStatus: ticket.paymentStatus, assisted: ticket.assisted }];
}
