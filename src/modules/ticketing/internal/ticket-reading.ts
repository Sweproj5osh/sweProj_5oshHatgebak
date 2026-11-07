import type { Receipt, TicketReading, TicketReadingDependencies } from '../public';

export type TicketReadReason = 'unknown ticket' | 'ticket not closed' | 'plate read refused';

/** Why a read could not be answered; the entry point turns the reason into a status code. */
export class TicketReadRefusal extends Error {
  constructor(readonly reason: TicketReadReason) {
    super(reason);
    this.name = 'TicketReadRefusal';
  }
}

/** Shown on a receipt when the plate cannot be resolved, for example because its owner was erased (task A5). */
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

    async receipt(tables, ticketId, reader): Promise<Receipt> {
      const ticket = await store.findById(tables, ticketId);
      if (ticket === undefined) {
        throw new TicketReadRefusal('unknown ticket');
      }
      if (ticket.state !== 'closed' || ticket.closedAt === undefined || ticket.fee === undefined) {
        throw new TicketReadRefusal('ticket not closed');
      }
      const looked = await plates.readPlate({ carRef: ticket.carRef, reader, purpose: 'receipt', siteId: ticket.siteId });
      if (!looked.ok && looked.error === 'refused') {
        throw new TicketReadRefusal('plate read refused');
      }
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
