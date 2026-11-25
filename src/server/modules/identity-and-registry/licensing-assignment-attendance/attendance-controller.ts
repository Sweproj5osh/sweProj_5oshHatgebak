import type { DistrictId, PersonId } from '../../../shared/identifiers';
import { refuse, respond, type ReadOperation, type TelemetryOperation, type WriteOperation, type WriteOutcome } from '../../../shared/operation-contract';
import { createLicensingStores, type ClockInRefusal, type ClockOutRefusal, type LicensingAssignmentAttendance } from './index';
import { SAMPLE, seedLicensedAttendantAtSiteOne } from './controller-support';

/** The attendant scans the code printed at their own site; the token says who they are, the code where they stand. */
export function clockIn(module: LicensingAssignmentAttendance, districtOfSite: (siteId: unknown) => Promise<DistrictId | undefined>, sampleEntryCode: string): WriteOperation {
  return {
    kind: 'write',
    name: 'attendance.clockIn',
    method: 'POST',
    path: '/attendances',
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

export function clockOut(module: LicensingAssignmentAttendance, districtOfSite: (siteId: unknown) => Promise<DistrictId | undefined>, sampleExitCode: string): WriteOperation {
  return {
    kind: 'write',
    name: 'attendance.clockOut',
    method: 'PATCH',
    path: '/attendances/current',
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
export function recordLocation(module: LicensingAssignmentAttendance): TelemetryOperation {
  return {
    kind: 'telemetry',
    name: 'attendance.recordLocation',
    method: 'POST',
    path: '/location-readings',
    allowedRoles: ['attendant'],
    bodySchema: { fields: { latitude: 'number', longitude: 'number' } },
    examples: { valid: { latitude: 30.0626, longitude: 31.2197 }, invalid: { latitude: 'north' } },
    async handle({ actor, body }) {
      await module.attendance.recordLocationPoint(actor.personId, { latitude: Number(body['latitude']), longitude: Number(body['longitude']) });
    },
  };
}

/** The inspector's priority list: GET /attendance/off-site-flags?zoneId=… for someone with scope over the zone. */
export function readOffSiteFlags(module: LicensingAssignmentAttendance): ReadOperation {
  return {
    kind: 'read',
    name: 'attendance.offSiteFlags',
    method: 'GET',
    path: '/off-site-flags',
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
