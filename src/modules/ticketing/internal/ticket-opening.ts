import { randomUUID } from 'node:crypto';
import { fail, succeed, type Result } from '../../../shared/result';
import type { OpenRefusal, OpenTicketCommand, Ticket, TicketOpening, TicketOpeningDependencies } from '../public';

/**
 * The checks run in a fixed order, so a driver who fails several always sees the same reason first:
 * code, site open, car already parked, site full. The last two are decided together with the insert (the store).
 */
export function createTicketOpeningService(dependencies: TicketOpeningDependencies): TicketOpening {
  const { sites, store, clock } = dependencies;
  const newTicketId = dependencies.newTicketId ?? randomUUID;

  return {
    async openTicket(command: OpenTicketCommand): Promise<Result<Ticket, OpenRefusal>> {
      const requestKey = `${command.driverRef}:${command.requestId}`;
      const earlier = await store.findByRequestKey(requestKey);
      if (earlier !== undefined) {
        return succeed(earlier);
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
        assisted: false,
      };
      return store.openIfPossible({ requestKey, ticket, capacity });
    },
  };
}
