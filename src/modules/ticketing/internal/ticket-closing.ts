import type { PersonId } from '../../../shared/identifiers';
import { fail, succeed, type Result } from '../../../shared/result';
import type { CloseRefusal, Ticket, TicketClosing, TicketClosingDependencies } from '../public';

/**
 * Checks in a fixed order: an open ticket exists, the exit code is genuine and belongs to its site, the exit is not
 * before the entry, a price was in force when the ticket opened. Then the fee is asked of the fee calculator and the
 * ticket is closed in one indivisible step. The exit time is the server clock's, frozen here.
 *
 * An assisted ticket (task B10) is closed by an attendant assigned to its site, who also names the car seen at the
 * exit; it must be the car that came in.
 */
export function createTicketClosingService(dependencies: TicketClosingDependencies): TicketClosing {
  const { sites, store, clock, prices, fees, assignments } = dependencies;

  async function close(
    requestId: string,
    ticketId: string,
    exitCode: string,
    assisted?: { readonly attendantId: PersonId; readonly carRef: string },
  ): Promise<Result<Ticket, CloseRefusal>> {
    const requestKey = `close:${requestId}:${ticketId}`;
    const earlier = await store.findByRequestKey(requestKey);
    if (earlier !== undefined) {
      return succeed(earlier);
    }
    const ticket = await store.findById(ticketId);
    if (ticket === undefined || ticket.state !== 'open') {
      return fail('no open ticket');
    }
    if (assisted !== undefined) {
      if (!ticket.assisted) {
        return fail('not an assisted ticket');
      }
      if (!(await assignments?.isAssignedTo(assisted.attendantId, ticket.siteId))) {
        return fail('attendant not assigned to this site');
      }
    }
    const code = await sites.verifyExitCode(exitCode, ticket.siteId);
    if (!code.ok) {
      return fail(code.error === 'wrong site' ? 'wrong site' : 'forged code');
    }
    if (assisted !== undefined && assisted.carRef !== ticket.carRef) {
      return fail('car does not match');
    }
    const entry = new Date(ticket.openedAt);
    const exit = clock.now();
    if (exit.getTime() < entry.getTime()) {
      return fail('exit before entry');
    }
    const price = await prices.versionValidAt(ticket.siteId, entry);
    if (!price.found) {
      return fail('no price known');
    }
    const fee = await fees.computeFeeForCar({ carRef: ticket.carRef }, entry, exit, price.version);
    return store.closeIfOpen({ requestKey, ticketId, closedAt: exit.toISOString(), fee });
  }

  return {
    closeTicket: (requestId, ticketId, exitCode) => close(requestId, ticketId, exitCode),
    closeAssistedTicket: (requestId, ticketId, exitCode, attendantId, carRef) => close(requestId, ticketId, exitCode, { attendantId, carRef }),
  };
}
