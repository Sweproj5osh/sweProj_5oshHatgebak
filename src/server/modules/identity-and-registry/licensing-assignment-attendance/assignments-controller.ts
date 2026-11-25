import type { BodySchema, ValidBody } from '../../../shared/body-schema';
import type { DistrictId, PersonId, Role } from '../../../shared/identifiers';
import { respond, type WriteContext, type WriteOperation } from '../../../shared/operation-contract';
import type { Result } from '../../../shared/result';
import type { TableAccess } from '../../../shared/unit-of-work';
import type { AssignmentRefusal, LicensingAssignmentAttendance } from './index';
import { SAMPLE, refused, seedAssignedAttendant, seedMemberAndAttendantAtSiteOne, seedMemberAndPlaces, seedPerson } from './controller-support';

/**
 * The five assignment endpoints (task A12), built over the module's assignments and the two district look-ups the
 * list above shares with the licence and attendance endpoints; the list places each one in its registration order.
 */
export function assignmentEndpoints(
  assignments: LicensingAssignmentAttendance['assignments'],
  districtOfSite: (siteId: unknown) => Promise<DistrictId | undefined>,
  districtOfZone: (zoneId: unknown) => Promise<DistrictId | undefined>,
): Readonly<Record<'assignAttendant' | 'changeShift' | 'releaseAttendant' | 'assignInspector' | 'appointMember', WriteOperation>> {
  return {
    assignAttendant: assignmentWrite({
      name: 'assignments.assignAttendant',
      method: 'POST',
      path: '/attendant-assignments',
      allowedRoles: ['member', 'chair'],
      fields: { attendantId: 'string', siteId: 'string', shiftId: 'string' },
      example: { attendantId: SAMPLE.attendant, siteId: SAMPLE.siteId, shiftId: 'morning' },
      fixture: seedMemberAndAttendantAtSiteOne,
      subject: 'attendantId',
      change: ({ actor, body }) => assignments.assignAttendantToSite(actor.personId, String(body['attendantId']), String(body['siteId']), String(body['shiftId'])),
      district: ({ body }) => districtOfSite(body['siteId']),
    }),
    changeShift: assignmentWrite({
      name: 'assignments.changeShift',
      method: 'PATCH',
      path: '/attendant-assignments/:attendantId',
      allowedRoles: ['member', 'chair'],
      fields: { attendantId: 'string', shiftId: 'string' },
      example: { attendantId: SAMPLE.attendant, shiftId: 'evening' },
      fixture: seedAssignedAttendant,
      subject: 'attendantId',
      change: ({ actor, body }) => assignments.changeShift(actor.personId, String(body['attendantId']), String(body['shiftId'])),
      district: async ({ body }) => districtOfSite(await assignments.siteOf(String(body['attendantId']))),
    }),
    releaseAttendant: assignmentWrite({
      name: 'assignments.releaseAttendant',
      method: 'POST',
      path: '/attendant-releases',
      allowedRoles: ['member', 'chair'],
      fields: { attendantId: 'string' },
      example: { attendantId: SAMPLE.attendant },
      fixture: seedAssignedAttendant,
      subject: 'attendantId',
      change: ({ actor, body }) => assignments.releaseAttendant(actor.personId, String(body['attendantId'])),
      district: async ({ body }) => districtOfSite(await assignments.siteOf(String(body['attendantId']))),
    }),
    assignInspector: assignmentWrite({
      name: 'assignments.assignInspector',
      method: 'PUT',
      path: '/inspector-assignments/:inspectorId',
      allowedRoles: ['member', 'chair'],
      fields: { inspectorId: 'string', zoneId: 'string' },
      example: { inspectorId: SAMPLE.inspector, zoneId: SAMPLE.zoneId },
      fixture: async (database) => {
        await seedMemberAndPlaces(database);
        await seedPerson(database, SAMPLE.inspector, 'inspector');
      },
      subject: 'inspectorId',
      change: ({ actor, body }) => assignments.assignInspectorToZone(actor.personId, String(body['inspectorId']), String(body['zoneId'])),
      district: ({ body }) => districtOfZone(body['zoneId']),
    }),
    appointMember: assignmentWrite({
      name: 'assignments.appointMember',
      method: 'PUT',
      path: '/member-appointments/:memberId',
      allowedRoles: ['chair'],
      fields: { memberId: 'string', districtId: 'string' },
      example: { memberId: SAMPLE.member, districtId: SAMPLE.districtId },
      fixture: async (database) => {
        await seedPerson(database, SAMPLE.chair, 'chair');
        await seedMemberAndPlaces(database);
      },
      subject: 'memberId',
      change: ({ actor, body }) => assignments.appointMemberToDistrict(actor.personId, String(body['memberId']), String(body['districtId'])),
      district: async ({ body }) => String(body['districtId']),
    }),
  };
}

interface AssignmentWriteSpec {
  readonly name: string;
  readonly method: WriteOperation['method'];
  readonly path: string;
  readonly allowedRoles: readonly Role[];
  readonly fields: BodySchema['fields'];
  readonly example: ValidBody;
  fixture(database: TableAccess): Promise<void>;
  /** The body field naming the person the change is about. */
  readonly subject: string;
  change(context: WriteContext): Promise<Result<void, AssignmentRefusal>>;
  /** The district the change belongs to, read before the change, while a release still names the site. */
  district(context: WriteContext): Promise<DistrictId | undefined>;
}

function assignmentWrite(spec: AssignmentWriteSpec): WriteOperation {
  return {
    kind: 'write',
    name: spec.name,
    method: spec.method,
    path: spec.path,
    allowedRoles: spec.allowedRoles,
    bodySchema: { fields: spec.fields },
    examples: { valid: spec.example, invalid: {} },
    fixture: spec.fixture,
    async handle(context) {
      const districtId = await spec.district(context);
      const changed = await spec.change(context);
      if (!changed.ok) {
        return refused(changed.error);
      }
      const subject: PersonId = String(context.body[spec.subject]);
      return {
        response: respond(200, { done: spec.name }),
        audit: districtId === undefined ? { subjectPersonIds: [subject] } : { subjectPersonIds: [subject], districtId },
      };
    },
  };
}
