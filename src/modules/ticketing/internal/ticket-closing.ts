import { fail, succeed, type Result } from '../../../shared/result';
import type { SiteId, TicketId } from '../../../shared/identifiers';
import type { Transaction } from '../../../shared/unit-of-work';
import type { ClockedInAttendant, CloseRefusal, StaleTicketSweep, Ticket, TicketClosing, TicketClosingDependencies } from '../public';

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/**
 * Checks in a fixed order: an open ticket exists, the exit code is genuine and belongs to its site, the exit is not
 * before the entry, a price was in force when the ticket opened. Then the fee is asked of the fee calculator and the
 * ticket is closed in one indivisible step. The exit time is the server clock's, frozen here.
 *
 * An assisted ticket (task B10) is closed by an attendant clocked in at its site, who also names the car seen at the
 * exit; it must be the car that came in.
 *
 * A stale ticket (open for the caller's maximum or longer, nobody scanned out) is closed by the same settlement
 * without a scan: the exit time is the server's now, the fee is the normal, capped fee at the price of its opening.
 */
export function createTicketClosingService(dependencies: TicketClosingDependencies): TicketClosing {
  const { sites, store, clock, prices, fees } = dependencies;

  async function close(
    unitOfWork: Transaction,
    requestId: string,
    ticketId: string,
    exitCode: string,
    assisted?: { readonly attendant: ClockedInAttendant; readonly carRef: string },
  ): Promise<Result<Ticket, CloseRefusal>> {
    const requestKey = `close:${requestId}:${ticketId}`;
    const earlier = await store.findByRequestKey(unitOfWork, requestKey);
    if (earlier !== undefined) {
      return succeed(earlier);
    }
    const ticket = await store.findById(unitOfWork, ticketId);
    if (ticket === undefined || ticket.state !== 'open') {
      return fail('no open ticket');
    }
    if (assisted !== undefined) {
      if (!ticket.assisted) {
        return fail('not an assisted ticket');
      }
      if (assisted.attendant.boundSiteId !== ticket.siteId) {
        return fail('attendant not clocked in at this site');
      }
    }
    const code = await sites.verifyExitCode(exitCode, ticket.siteId);
    if (!code.ok) {
      return fail(code.error === 'wrong site' ? 'wrong site' : 'forged code');
    }
    if (assisted !== undefined && assisted.carRef !== ticket.carRef) {
      return fail('car does not match');
    }
    return settle(unitOfWork, requestKey, ticket, clock.now());
  }

  /** Freezes the exit time, asks the fee of the price in force at the entry (FR4.3, Rule C) and closes in one step. */
  async function settle(unitOfWork: Transaction, requestKey: string, ticket: Ticket, exit: Date): Promise<Result<Ticket, CloseRefusal>> {
    const entry = new Date(ticket.openedAt);
    if (exit.getTime() < entry.getTime()) {
      return fail('exit before entry');
    }
    const price = await prices.versionValidAt(ticket.siteId, entry);
    if (!price.found) {
      return fail('no price known');
    }
    const fee = await fees.computeFeeForCar({ carRef: ticket.carRef }, entry, exit, price.version);
    return store.closeIfOpen(unitOfWork, { requestKey, ticketId: ticket.ticketId, closedAt: exit.toISOString(), fee });
  }

  async function closeStaleTickets(unitOfWork: Transaction, siteId: SiteId, maximumHours: number): Promise<StaleTicketSweep> {
    const now = clock.now();
    const openedAtOrBefore = now.getTime() - maximumHours * MILLISECONDS_PER_HOUR;
    const stale = (await store.listOpenAt(unitOfWork, siteId)).filter((ticket) => Date.parse(ticket.openedAt) <= openedAtOrBefore);
    const closed: TicketId[] = [];
    const leftOpen: { ticketId: TicketId; reason: CloseRefusal }[] = [];
    for (const ticket of stale) {
      const outcome = await settle(unitOfWork, `stale:${ticket.ticketId}`, ticket, now);
      if (outcome.ok) {
        closed.push(ticket.ticketId);
      } else {
        leftOpen.push({ ticketId: ticket.ticketId, reason: outcome.error });
      }
    }
    return { closed, leftOpen };
  }

  return {
    closeTicket: (unitOfWork, requestId, ticketId, exitCode) => close(unitOfWork, requestId, ticketId, exitCode),
    closeAssistedTicket: (unitOfWork, requestId, ticketId, exitCode, attendant, carRef) =>
      close(unitOfWork, requestId, ticketId, exitCode, { attendant, carRef }),
    closeStaleTickets,
  };
}
