import { randomUUID } from 'node:crypto';
import type { PersonId } from '../../../shared/identifiers';
import { fail, succeed, type Result } from '../../../shared/result';
import type { OpenRefusal, OpenTicketCommand, Ticket, TicketOpening, TicketOpeningDependencies } from '../public';

/**
 * The checks run in a fixed order, so a driver who fails several always sees the same reason first:
 * code, site open, car already parked, site full. The last two are decided together with the insert (the store).
 * An assisted ticket (task B10) first needs an attendant assigned to the site, then goes through the same checks.
 */
export function createTicketOpeningService(dependencies: TicketOpeningDependencies): TicketOpening {
  const { sites, store, clock, assignments } = dependencies;
  const newTicketId = dependencies.newTicketId ?? randomUUID;

  async function open(command: OpenTicketCommand, requestKey: string, attendantId?: PersonId): Promise<Result<Ticket, OpenRefusal>> {
    const earlier = await store.findByRequestKey(requestKey);
    if (earlier !== undefined) {
      return succeed(earlier);
    }
    if (attendantId !== undefined && !(await assignments?.isAssignedTo(attendantId, command.siteId))) {
      return fail('attendant not assigned to this site');
    }
    const code = await sites.verifyEntryCode(command.entryCode, command.siteId);
    if (!code.ok) {
      return fail(code.error === 'wrong site' ? 'wrong site' : 'forged code');
    }
    const now = clock.now();
    if (!(await sites.isOpenAt(command.siteId, now))) {
      return fail('site closed');
    }
    const capacity = (await sites.capacityOf(command.siteId)) ?? 0;
    const ticket: Ticket = {
      ticketId: newTicketId(),
      siteId: command.siteId,
      driverRef: command.driverRef,
      carRef: command.carRef,
      state: 'open',
      paymentStatus: 'unpaid',
      openedAt: now.toISOString(),
      assisted: attendantId !== undefined,
    };
    return store.openIfPossible({ requestKey, ticket, capacity });
  }

  return {
    openTicket: (command) => open(command, `${command.driverRef}:${command.requestId}`),
    openAssistedTicket: (command, attendantId) => open(command, `assisted:${attendantId}:${command.requestId}`, attendantId),
  };
}
