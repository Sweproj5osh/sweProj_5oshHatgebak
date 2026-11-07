/**
 * Stand-in for Lino's `attendance.clockIn` (branch area-a/a13-attendance, not on main yet), for the data-layer tests
 * only (P14). It declares his exact schema, `{ siteCode }`, so a client that sent an attendant id or a site id would
 * be refused by the pipeline's body validation; the attendant comes from the token, the site from the code.
 */
import type { PersonId, SiteId } from '../../shared/identifiers';
import { refuse, respond, type Operation, type WriteOperation } from '../../shared/operation-contract';
import { ATTENDANT_CLOCK_IN_OPERATION, ATTENDANT_CLOCK_IN_PATH } from '../shared-client/attendant-mode/attendant-mode-routes';

export interface StandInAttendanceState {
  /** The signed codes the stand-in accepts, each naming the site printed on it. */
  readonly siteOfCode: ReadonlyMap<string, SiteId>;
  readonly assignedSite: ReadonlyMap<PersonId, SiteId>;
  readonly clockedInAt: Map<PersonId, SiteId>;
}

export function createStandInAttendanceState(siteOfCode: Record<string, SiteId>, assignedSite: Record<PersonId, SiteId>): StandInAttendanceState {
  return { siteOfCode: new Map(Object.entries(siteOfCode)), assignedSite: new Map(Object.entries(assignedSite)), clockedInAt: new Map() };
}

export function createStandInAttendanceOperations(state: StandInAttendanceState): readonly Operation[] {
  return [clockIn(state)];
}

function clockIn(state: StandInAttendanceState): WriteOperation {
  return {
    kind: 'write',
    name: ATTENDANT_CLOCK_IN_OPERATION,
    method: 'POST',
    path: ATTENDANT_CLOCK_IN_PATH,
    allowedRoles: ['attendant'],
    bodySchema: { fields: { siteCode: 'string' } },
    examples: { valid: { siteCode: 'SAYES1.entry.c2l0ZS0x.signature' }, invalid: {} },
    async handle({ actor, body }) {
      const siteId = state.siteOfCode.get(String(body['siteCode']));
      if (siteId === undefined) {
        return { response: refuse(400, 'forged code') };
      }
      const assigned = state.assignedSite.get(actor.personId);
      if (assigned === undefined) {
        return { response: refuse(409, 'not assigned') };
      }
      if (assigned !== siteId) {
        return { response: refuse(403, 'wrong site') };
      }
      state.clockedInAt.set(actor.personId, siteId);
      return { response: respond(200, { siteId, clockedIn: true }), audit: { subjectPersonIds: [actor.personId] } };
    },
  };
}
