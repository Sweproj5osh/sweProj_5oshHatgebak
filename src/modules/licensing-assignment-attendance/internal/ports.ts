import type { DistrictId, LicenceId, PersonId, SiteId, ZoneId } from '../../../shared/identifiers';
import type { TableAccess } from '../../../shared/unit-of-work';
import type { LicenceStateChange } from '../public';

/**
 * Storage ports owned by this module. Every method takes the tables it works on (ADR-13): the committed tables for a
 * read outside a request, the request's unit of work for a write. The adapters in `adapters/` work over any
 * TableAccess, over the tables of `db/migrations/0002_identity_and_registry.sql`.
 */

/** One row of `licensing_assignment_attendance.attendant_assignments`: an attendant's one fixed site and shift. */
export interface AttendantAssignment {
  readonly attendantId: PersonId;
  readonly siteId: SiteId;
  readonly shiftId: string;
  readonly assignedBy: PersonId;
  /** Set from the server clock (Rule I). */
  readonly assignedAt: string;
}

export interface InspectorAssignment {
  readonly inspectorId: PersonId;
  readonly zoneId: ZoneId;
  readonly assignedBy: PersonId;
  readonly assignedAt: string;
}

export interface MemberAppointment {
  readonly memberId: PersonId;
  readonly districtId: DistrictId;
  readonly appointedBy: PersonId;
  readonly appointedAt: string;
}

export interface AssignmentsStore {
  attendant(tables: TableAccess, attendantId: PersonId): Promise<AttendantAssignment | undefined>;
  saveAttendant(tables: TableAccess, assignment: AttendantAssignment): Promise<void>;
  removeAttendant(tables: TableAccess, attendantId: PersonId): Promise<void>;
  inspector(tables: TableAccess, inspectorId: PersonId): Promise<InspectorAssignment | undefined>;
  saveInspector(tables: TableAccess, assignment: InspectorAssignment): Promise<void>;
  member(tables: TableAccess, memberId: PersonId): Promise<MemberAppointment | undefined>;
  saveMember(tables: TableAccess, appointment: MemberAppointment): Promise<void>;
  count(tables: TableAccess): Promise<number>;
}

/** One row of `licensing_assignment_attendance.licences`. The current state is the last change's target state. */
export interface LicenceRow {
  readonly licenceId: LicenceId;
  readonly attendantId: PersonId;
  readonly issuedBy: PersonId;
  readonly issuedAt: string;
}

/** One row of `licensing_assignment_attendance.licence_state_changes`: insert-only, every move with its approval. */
export type LicenceStateChangeRow = LicenceStateChange;

export interface LicencesStore {
  add(tables: TableAccess, licence: LicenceRow): Promise<void>;
  find(tables: TableAccess, licenceId: LicenceId): Promise<LicenceRow | undefined>;
  ofAttendant(tables: TableAccess, attendantId: PersonId): Promise<LicenceRow | undefined>;
  appendChange(tables: TableAccess, change: LicenceStateChangeRow): Promise<void>;
  /** Oldest first; empty for a licence that does not exist. */
  changesOf(tables: TableAccess, licenceId: LicenceId): Promise<readonly LicenceStateChangeRow[]>;
}

/** One row of `licensing_assignment_attendance.attendance`: one clock-in, closed by its clock-out. */
export interface AttendanceRow {
  readonly attendanceId: string;
  readonly attendantId: PersonId;
  readonly siteId: SiteId;
  readonly shiftId: string;
  /** Both set from the server clock (Rule I). */
  readonly clockedInAt: string;
  readonly clockedOutAt?: string;
}

export interface AttendanceStore {
  open(tables: TableAccess, attendantId: PersonId): Promise<AttendanceRow | undefined>;
  /** The attendant's most recent clock-in, open or closed; undefined when they never clocked in. */
  latest(tables: TableAccess, attendantId: PersonId): Promise<AttendanceRow | undefined>;
  add(tables: TableAccess, row: AttendanceRow): Promise<void>;
  close(tables: TableAccess, attendanceId: string, clockedOutAt: string): Promise<void>;
  all(tables: TableAccess): Promise<readonly AttendanceRow[]>;
}

/**
 * One location reading during a shift. Only its distance from the site is kept, never the coordinates: the rule needs
 * nothing more, and personal data is collected minimally (Law 151 of 2020).
 */
export interface LocationReading {
  readonly attendanceId: string;
  readonly distanceMeters: number;
  readonly recordedAt: string;
}

export interface OffSiteFlagRow {
  readonly flagId: string;
  readonly attendanceId: string;
  readonly attendantId: PersonId;
  readonly siteId: SiteId;
  readonly zoneId: ZoneId;
  readonly raisedAt: string;
}

export interface OffSiteStore {
  addReading(tables: TableAccess, reading: LocationReading): Promise<void>;
  /** Oldest first. */
  readingsOf(tables: TableAccess, attendanceId: string): Promise<readonly LocationReading[]>;
  flagOf(tables: TableAccess, attendanceId: string): Promise<OffSiteFlagRow | undefined>;
  addFlag(tables: TableAccess, flag: OffSiteFlagRow): Promise<void>;
  flagsIn(tables: TableAccess, zoneId: ZoneId): Promise<readonly OffSiteFlagRow[]>;
}
