import type { BodySchema, ValidBody } from '../../../shared/body-schema';
import type { DistrictId, PersonId, Role } from '../../../shared/identifiers';
import {
  refuse,
  respond,
  type Operation,
  type ReadOperation,
  type TelemetryOperation,
  type WriteContext,
  type WriteOperation,
  type WriteOutcome,
} from '../../../shared/operation-contract';
import type { Result } from '../../../shared/result';
import type { TableAccess } from '../../../shared/unit-of-work';
import { createAccountsStores } from '../../accounts-and-access-control/public';
import { createSitesStores, signedSiteCodes, type SiteRegistry } from '../../sites-and-areas/public';
import {
  createLicensingStores,
  type AssignmentRefusal,
  type ClockInRefusal,
  type ClockOutRefusal,
  type LicenceRefusal,
  type LicensingAssignmentAttendance,
} from '../public';

export interface LicensingOperationsDependencies {
  readonly licensing: LicensingAssignmentAttendance;
  readonly siteRegistry: SiteRegistry;
  /** The secret the site codes are signed with; the clock-in and clock-out sample bodies carry a code signed the same way. */
  readonly siteCodeSecret: string;
}

/**
 * The requests this module answers, for the composition root to register (P4). The entry point writes the one audit
 * entry after a handler succeeds; the handler names the person the change is about, so that person can read the entry,
 * and the district, so its members can (ADR-10). A location reading is a measurement, not an action (P7): it is the one
 * telemetry operation, with no request id, no audit entry and no event; the flag it may raise stays an audited fact.
 */
export function licensingOperations({ licensing, siteRegistry, siteCodeSecret }: LicensingOperationsDependencies): readonly Operation[] {
  const { assignments } = licensing;
  const districtOfSite = async (siteId: unknown) => (await siteRegistry.locateSite(String(siteId)))?.districtId;
  const districtOfZone = async (zoneId: unknown) => (await siteRegistry.locateZone(String(zoneId)))?.districtId;
  const sampleCodes = signedSiteCodes(siteCodeSecret, SAMPLE.siteId);
  return [
    assignmentWrite({
      name: 'assignments.assignAttendant',
      path: '/assignments/attendants',
      allowedRoles: ['member', 'chair'],
      fields: { attendantId: 'string', siteId: 'string', shiftId: 'string' },
      example: { attendantId: SAMPLE.attendant, siteId: SAMPLE.siteId, shiftId: 'morning' },
      fixture: seedMemberAndAttendantAtSiteOne,
      subject: 'attendantId',
      change: ({ actor, body }) => assignments.assignAttendantToSite(actor.personId, String(body['attendantId']), String(body['siteId']), String(body['shiftId'])),
      district: ({ body }) => districtOfSite(body['siteId']),
    }),
    assignmentWrite({
      name: 'assignments.changeShift',
      path: '/assignments/attendants/shift',
      allowedRoles: ['member', 'chair'],
      fields: { attendantId: 'string', shiftId: 'string' },
      example: { attendantId: SAMPLE.attendant, shiftId: 'evening' },
      fixture: seedAssignedAttendant,
      subject: 'attendantId',
      change: ({ actor, body }) => assignments.changeShift(actor.personId, String(body['attendantId']), String(body['shiftId'])),
      district: async ({ body }) => districtOfSite(await assignments.siteOf(String(body['attendantId']))),
    }),
    assignmentWrite({
      name: 'assignments.releaseAttendant',
      path: '/assignments/attendants/release',
      allowedRoles: ['member', 'chair'],
      fields: { attendantId: 'string' },
      example: { attendantId: SAMPLE.attendant },
      fixture: seedAssignedAttendant,
      subject: 'attendantId',
      change: ({ actor, body }) => assignments.releaseAttendant(actor.personId, String(body['attendantId'])),
      district: async ({ body }) => districtOfSite(await assignments.siteOf(String(body['attendantId']))),
    }),
    assignmentWrite({
      name: 'assignments.assignInspector',
      path: '/assignments/inspectors',
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
    issueLicence(licensing, districtOfSite),
    readLicenceStatus(licensing),
    clockIn(licensing, districtOfSite, sampleCodes.entryCode),
    clockOut(licensing, districtOfSite, sampleCodes.exitCode),
    recordLocation(licensing),
    readOffSiteFlags(licensing),
    assignmentWrite({
      name: 'assignments.appointMember',
      path: '/assignments/members',
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
  ];
}

/**
 * Issuing is the only licence change reachable by request. Suspension and revocation have no route of their own: they
 * arrive through the Chair's approval, whose request writes the audit entry naming requester and approver.
 */
function issueLicence(module: LicensingAssignmentAttendance, districtOfSite: (siteId: unknown) => Promise<DistrictId | undefined>): WriteOperation {
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

/** GET /licences/status?attendantId=…&siteId=…: an attendant never licensed is a valid answer, with no state and no history (P23 #10). */
function readLicenceStatus(module: LicensingAssignmentAttendance): ReadOperation {
  return {
    kind: 'read',
    name: 'licences.status',
    method: 'GET',
    path: '/licences/status',
    allowedRoles: ['inspector', 'member', 'chair'],
    scope: 'staff-scoped',
    async handle({ query }) {
      const attendantId = query['attendantId'] ?? '';
      const licenceId = await module.licences.licenceOf(attendantId);
      const state = (await module.licences.statusOf(attendantId)) ?? null;
      const history = licenceId === undefined ? [] : await module.licences.history(licenceId);
      return { response: respond(200, { attendantId, licenceId: licenceId ?? null, state, history }) };
    },
  };
}

/** The attendant scans the code printed at their own site; the token says who they are, the code where they stand. */
function clockIn(module: LicensingAssignmentAttendance, districtOfSite: (siteId: unknown) => Promise<DistrictId | undefined>, sampleEntryCode: string): WriteOperation {
  return {
    kind: 'write',
    name: 'attendance.clockIn',
    method: 'POST',
    path: '/attendance/clock-in',
    allowedRoles: ['attendant'],
    bodySchema: { fields: { siteCode: 'string' } },
    examples: { valid: { siteCode: sampleEntryCode }, invalid: {} },
    fixture: (database) => seedLicensedAttendantAtSiteOne(database, 'attendant-1'),
    async handle({ actor, body }) {
      const clockedIn = await module.attendance.clockIn(actor.personId, String(body['siteCode']));
      if (!clockedIn.ok) {
        return { response: refuse(CLOCK_IN_REFUSAL_STATUS[clockedIn.error], clockedIn.error) };
      }
      return attendanceWritten({ siteId: clockedIn.value, clockedIn: true }, actor.personId, await districtOfSite(clockedIn.value));
    },
  };
}

function clockOut(module: LicensingAssignmentAttendance, districtOfSite: (siteId: unknown) => Promise<DistrictId | undefined>, sampleExitCode: string): WriteOperation {
  return {
    kind: 'write',
    name: 'attendance.clockOut',
    method: 'POST',
    path: '/attendance/clock-out',
    allowedRoles: ['attendant'],
    bodySchema: { fields: { siteCode: 'string' } },
    examples: { valid: { siteCode: sampleExitCode }, invalid: {} },
    async fixture(database) {
      await seedLicensedAttendantAtSiteOne(database, 'attendant-1');
      await createLicensingStores().attendance.add(database, {
        attendanceId: 'attendance-sample',
        attendantId: 'attendant-1',
        siteId: SAMPLE.siteId,
        shiftId: 'morning',
        clockedInAt: '2026-11-05T08:00:00.000Z',
      });
    },
    async handle({ actor, body }) {
      const clockedOut = await module.attendance.clockOut(actor.personId, String(body['siteCode']));
      if (!clockedOut.ok) {
        return { response: refuse(CLOCK_OUT_REFUSAL_STATUS[clockedOut.error], clockedOut.error) };
      }
      return attendanceWritten({ siteId: clockedOut.value, clockedIn: false }, actor.personId, await districtOfSite(clockedOut.value));
    },
  };
}

/**
 * A measurement, not an action (P7): one reading per attendant per minute, written into this module's tables with no
 * request id, no audit entry and no event. A reading that measures no shift (the attendant is not clocked in, or the
 * coordinates are impossible) is dropped; the flag the rule may raise is recorded as an audited fact on the shift.
 */
function recordLocation(module: LicensingAssignmentAttendance): TelemetryOperation {
  return {
    kind: 'telemetry',
    name: 'attendance.recordLocation',
    method: 'POST',
    path: '/attendance/location-readings',
    allowedRoles: ['attendant'],
    bodySchema: { fields: { latitude: 'number', longitude: 'number' } },
    examples: { valid: { latitude: 30.0626, longitude: 31.2197 }, invalid: { latitude: 'north' } },
    async handle({ actor, body }) {
      await module.attendance.recordLocationPoint(actor.personId, { latitude: Number(body['latitude']), longitude: Number(body['longitude']) });
    },
  };
}

/** The inspector's priority list: GET /attendance/off-site-flags?zoneId=… for someone with scope over the zone. */
function readOffSiteFlags(module: LicensingAssignmentAttendance): ReadOperation {
  return {
    kind: 'read',
    name: 'attendance.offSiteFlags',
    method: 'GET',
    path: '/attendance/off-site-flags',
    allowedRoles: ['inspector', 'member', 'chair'],
    scope: 'staff-scoped',
    async handle({ actor, query }) {
      const flags = await module.attendance.offSiteFlags(actor.personId, query['zoneId'] ?? '');
      return { response: flags.ok ? respond(200, { flags: flags.value }) : refuse(403, flags.error) };
    },
  };
}

function attendanceWritten(body: unknown, attendantId: PersonId, districtId: DistrictId | undefined): WriteOutcome {
  return {
    response: respond(200, body),
    audit: districtId === undefined ? { subjectPersonIds: [attendantId] } : { subjectPersonIds: [attendantId], districtId },
  };
}

const CLOCK_IN_REFUSAL_STATUS: Readonly<Record<ClockInRefusal, number>> = {
  'wrong site': 403,
  'forged code': 400,
  'not assigned': 409,
  'licence not live': 403,
  'already clocked in': 409,
};

const CLOCK_OUT_REFUSAL_STATUS: Readonly<Record<ClockOutRefusal, number>> = {
  'not clocked in': 409,
  'already clocked out': 409,
  'wrong site': 403,
  'forged code': 400,
};

interface AssignmentWriteSpec {
  readonly name: string;
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
    method: 'POST',
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

const REFUSAL_STATUS: Readonly<Record<AssignmentRefusal, number>> = {
  'one site per attendant': 409,
  'members are managed by the Chair only': 403,
  'not allowed here': 403,
  'not an attendant': 400,
  'not an inspector': 400,
  'not a member': 400,
  'not assigned': 404,
  'unknown site': 404,
  'unknown zone': 404,
  'unknown district': 404,
  'invalid shift': 400,
};

function refused(refusal: AssignmentRefusal): WriteOutcome {
  return { response: refuse(REFUSAL_STATUS[refusal], refusal) };
}

/** The people and places the sample bodies of the F5 harness name, seeded by each write's fixture (P26 Q10). */
const SAMPLE = {
  chair: 'chair-1',
  member: 'member-1',
  attendant: 'person-1',
  inspector: 'person-2',
  districtId: 'district-1',
  zoneId: 'zone-1',
  siteId: 'site-1',
} as const;

const SAMPLE_OUTLINE = [
  { latitude: 30.0624, longitude: 31.2195 },
  { latitude: 30.0624, longitude: 31.2199 },
  { latitude: 30.0628, longitude: 31.2199 },
  { latitude: 30.0628, longitude: 31.2195 },
];

async function seedPerson(database: TableAccess, personId: PersonId, role: Role): Promise<void> {
  await createAccountsStores().people.add(database, { personId, role, status: 'active', erased: false });
}

/** A member of district 1, and district 1 with zone 1 and site 1 inside it, through the owning modules' own stores. */
async function seedMemberAndPlaces(database: TableAccess): Promise<void> {
  const accounts = createAccountsStores();
  await seedPerson(database, SAMPLE.member, 'member');
  await accounts.accessFacts.update(database, SAMPLE.member, (facts) => ({ ...facts, memberDistrictId: SAMPLE.districtId }));
  const sites = createSitesStores();
  await sites.places.addDistrict(database, { districtId: SAMPLE.districtId, label: 'Zamalek' });
  await sites.places.addZone(database, { zoneId: SAMPLE.zoneId, districtId: SAMPLE.districtId, label: 'Zamalek zone 1' });
  await sites.places.addSite(database, { siteId: SAMPLE.siteId, zoneId: SAMPLE.zoneId, label: '26 July Street', outline: SAMPLE_OUTLINE });
}

async function seedMemberAndAttendantAtSiteOne(database: TableAccess): Promise<void> {
  await seedMemberAndPlaces(database);
  await seedPerson(database, SAMPLE.attendant, 'attendant');
}

async function seedAssignedAttendant(database: TableAccess): Promise<void> {
  await seedMemberAndAttendantAtSiteOne(database);
  await assignToSiteOne(database, SAMPLE.attendant);
}

async function seedLicensedAttendantAtSiteOne(database: TableAccess, attendantId: PersonId): Promise<void> {
  await seedMemberAndPlaces(database);
  await seedPerson(database, attendantId, 'attendant');
  await assignToSiteOne(database, attendantId);
  await createAccountsStores().accessFacts.update(database, attendantId, (facts) => ({ ...facts, licenceState: 'valid' }));
}

async function assignToSiteOne(database: TableAccess, attendantId: PersonId): Promise<void> {
  await createLicensingStores().assignments.saveAttendant(database, {
    attendantId,
    siteId: SAMPLE.siteId,
    shiftId: 'morning',
    assignedBy: SAMPLE.member,
    assignedAt: '2026-11-05T08:00:00.000Z',
  });
  await createAccountsStores().accessFacts.update(database, attendantId, (facts) => ({ ...facts, attendantSiteId: SAMPLE.siteId }));
}
