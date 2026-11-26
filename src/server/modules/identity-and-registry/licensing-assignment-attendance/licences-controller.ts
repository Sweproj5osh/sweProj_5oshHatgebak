import type { DistrictId } from '../../../shared/identifiers';
import { refuse, respond, type ReadOperation, type WriteOperation } from '../../../shared/operation-contract';
import type { Authorization } from '../accounts-and-access-control/index';
import type { LicenceRefusal, LicensingAssignmentAttendance } from './index';
import { SAMPLE, seedAssignedAttendant } from './controller-support';

/**
 * Issuing is the only licence change reachable by request. Suspension and revocation have no route of their own: they
 * arrive through the Chair's approval, whose request writes the audit entry naming requester and approver.
 */
export function issueLicence(module: LicensingAssignmentAttendance, districtOfSite: (siteId: unknown) => Promise<DistrictId | undefined>): WriteOperation {
  return {
    kind: 'write',
    name: 'licences.issue',
    method: 'POST',
    path: '/licences',
    allowedRoles: ['member', 'chair'],
    bodySchema: { fields: { attendantId: 'string' } },
    examples: { valid: { attendantId: SAMPLE.attendant }, invalid: { attendantId: 1 } },
    fixture: seedAssignedAttendant,
    async handle({ actor, body }) {
      const attendantId = String(body['attendantId']);
      const issued = await module.licences.issueLicence(actor.personId, attendantId);
      if (!issued.ok) {
        return { response: refuse(LICENCE_REFUSAL_STATUS[issued.error], issued.error) };
      }
      const districtId = await districtOfSite(await module.assignments.siteOf(attendantId));
      return {
        response: respond(201, { licenceId: issued.value }),
        audit: districtId === undefined ? { subjectPersonIds: [attendantId] } : { subjectPersonIds: [attendantId], districtId },
      };
    },
  };
}

const LICENCE_REFUSAL_STATUS: Readonly<Record<LicenceRefusal, number>> = {
  'needs an approved request': 403,
  'not a permitted change': 409,
  'unknown licence': 404,
  'already licensed': 409,
  'not an attendant': 400,
  'not allowed here': 403,
};

const LICENCE_STATUS_OPERATION = 'licences.status';

/**
 * GET /licences/status?attendantId=…&siteId=…: an attendant never licensed is a valid answer, with no state and no
 * history (P23 #10). Staff-scoped twice over (P10): the pipeline checks the place the query names, and the handler
 * checks the attendant's own assigned site, so a reader cannot name a place inside their scope to read an attendant
 * outside it; an unknown or unassigned attendant is a system-wide matter, the Chair's alone, with the one refusal.
 */
export function readLicenceStatus(module: LicensingAssignmentAttendance, authorization: Authorization): ReadOperation {
  return {
    kind: 'read',
    name: LICENCE_STATUS_OPERATION,
    method: 'GET',
    path: '/attendants/:attendantId/licence',
    allowedRoles: ['inspector', 'member', 'chair'],
    scope: 'staff-scoped',
    async handle({ actor, query }) {
      const attendantId = query['attendantId'] ?? '';
      const attendantSiteId = await module.assignments.siteOf(attendantId);
      if (!(await authorization.may(actor.personId, LICENCE_STATUS_OPERATION, attendantSiteId === undefined ? {} : { siteId: attendantSiteId }))) {
        return { response: refuse(403, 'not allowed here') };
      }
      const licenceId = await module.licences.licenceOf(attendantId);
      const state = (await module.licences.statusOf(attendantId)) ?? null;
      const history = licenceId === undefined ? [] : await module.licences.history(licenceId);
      return { response: respond(200, { attendantId, licenceId: licenceId ?? null, state, history }) };
    },
  };
}
