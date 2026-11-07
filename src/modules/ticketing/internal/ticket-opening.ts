import { randomUUID } from 'node:crypto';
import { fail, succeed, type Result } from '../../../shared/result';
import type { Transaction } from '../../../shared/unit-of-work';
import type { ClockedInAttendant, OpenRefusal, OpenTicketCommand, Ticket, TicketOpening, TicketOpeningDependencies } from '../public';

/**
 * The checks run in a fixed order, so a driver who fails several always sees the same reason first:
 * code, site open, car already parked, site full. The last two are decided together with the insert (the store).
 * An assisted ticket (task B10) first needs an attendant whose session is clocked in at the site, then goes through the
 * same checks.
 */
export function createTicketOpeningService(dependencies: TicketOpeningDependencies): TicketOpening {
  const { sites, store, clock } = dependencies;
  const newTicketId = dependencies.newTicketId ?? randomUUID;

  async function open(
    unitOfWork: Transaction,
    command: OpenTicketCommand,
    requestKey: string,
    attendant?: ClockedInAttendant,
  ): Promise<Result<Ticket, OpenRefusal>> {
    const earlier = await store.findByRequestKey(unitOfWork, requestKey);
    if (earlier !== undefined) {
      return succeed(earlier);
    }
    if (attendant !== undefined && attendant.boundSiteId !== command.siteId) {
      return fail('attendant not clocked in at this site');
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
      assisted: attendant !== undefined,
    };
    return store.openIfPossible(unitOfWork, { requestKey, ticket, capacity });
  }

  return {
    openTicket: (unitOfWork, command) => open(unitOfWork, command, `${command.driverRef}:${command.requestId}`),
    openAssistedTicket: (unitOfWork, command, attendant) => open(unitOfWork, command, `assisted:${attendant.attendantId}:${command.requestId}`, attendant),
  };
}
