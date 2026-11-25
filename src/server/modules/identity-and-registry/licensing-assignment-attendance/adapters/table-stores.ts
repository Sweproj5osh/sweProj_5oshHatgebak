import type { LicenceId, PersonId, ZoneId } from '../../../../shared/identifiers';
import type { Row, TableAccess } from '../../../../shared/unit-of-work';
import type {
  AttendanceRow,
  AttendanceStore,
  AssignmentsStore,
  AttendantAssignment,
  InspectorAssignment,
  LicenceRow,
  LicencesStore,
  LicenceStateChangeRow,
  LocationReading,
  MemberAppointment,
  OffSiteFlagRow,
  OffSiteStore,
} from '../ports';

/**
 * This module's stores over the shared TableAccess (ADR-13): the same adapters serve the in-memory database of every
 * test and a PostgreSQL unit of work later. Table names follow `db/migrations/0002_identity_and_registry.sql`.
 */
export const ATTENDANT_ASSIGNMENTS_TABLE = 'licensing_assignment_attendance.attendant_assignments';
export const INSPECTOR_ASSIGNMENTS_TABLE = 'licensing_assignment_attendance.inspector_assignments';
export const MEMBER_APPOINTMENTS_TABLE = 'licensing_assignment_attendance.member_appointments';
export const LICENCES_TABLE = 'licensing_assignment_attendance.licences';
export const LICENCE_STATE_CHANGES_TABLE = 'licensing_assignment_attendance.licence_state_changes';
export const ATTENDANCE_TABLE = 'licensing_assignment_attendance.attendance';
export const LOCATION_READINGS_TABLE = 'licensing_assignment_attendance.location_readings';
export const OFF_SITE_FLAGS_TABLE = 'licensing_assignment_attendance.off_site_flags';

export class TableAssignmentsStore implements AssignmentsStore {
  attendant(tables: TableAccess, attendantId: PersonId): Promise<AttendantAssignment | undefined> {
    return tables.read<AttendantAssignment>(ATTENDANT_ASSIGNMENTS_TABLE, attendantId);
  }

  saveAttendant(tables: TableAccess, assignment: AttendantAssignment): Promise<void> {
    return upsert(tables, ATTENDANT_ASSIGNMENTS_TABLE, assignment.attendantId, assignment);
  }

  async removeAttendant(tables: TableAccess, attendantId: PersonId): Promise<void> {
    if ((await this.attendant(tables, attendantId)) !== undefined) {
      await tables.remove(ATTENDANT_ASSIGNMENTS_TABLE, attendantId);
    }
  }

  inspector(tables: TableAccess, inspectorId: PersonId): Promise<InspectorAssignment | undefined> {
    return tables.read<InspectorAssignment>(INSPECTOR_ASSIGNMENTS_TABLE, inspectorId);
  }

  saveInspector(tables: TableAccess, assignment: InspectorAssignment): Promise<void> {
    return upsert(tables, INSPECTOR_ASSIGNMENTS_TABLE, assignment.inspectorId, assignment);
  }

  member(tables: TableAccess, memberId: PersonId): Promise<MemberAppointment | undefined> {
    return tables.read<MemberAppointment>(MEMBER_APPOINTMENTS_TABLE, memberId);
  }

  saveMember(tables: TableAccess, appointment: MemberAppointment): Promise<void> {
    return upsert(tables, MEMBER_APPOINTMENTS_TABLE, appointment.memberId, appointment);
  }

  async count(tables: TableAccess): Promise<number> {
    const [attendants, inspectors, members] = await Promise.all([
      tables.list(ATTENDANT_ASSIGNMENTS_TABLE),
      tables.list(INSPECTOR_ASSIGNMENTS_TABLE),
      tables.list(MEMBER_APPOINTMENTS_TABLE),
    ]);
    return attendants.length + inspectors.length + members.length;
  }
}

/** The insert order, kept in the row so a history reads oldest first whatever the storage returns. */
interface Sequenced {
  readonly sequence: number;
}

export class TableLicencesStore implements LicencesStore {
  async add(tables: TableAccess, licence: LicenceRow): Promise<void> {
    await tables.insert(LICENCES_TABLE, licence.licenceId, licence);
  }

  find(tables: TableAccess, licenceId: LicenceId): Promise<LicenceRow | undefined> {
    return tables.read<LicenceRow>(LICENCES_TABLE, licenceId);
  }

  async ofAttendant(tables: TableAccess, attendantId: PersonId): Promise<LicenceRow | undefined> {
    return (await tables.list<LicenceRow>(LICENCES_TABLE)).find((licence) => licence.attendantId === attendantId);
  }

  async appendChange(tables: TableAccess, change: LicenceStateChangeRow): Promise<void> {
    await appendSequenced(tables, LICENCE_STATE_CHANGES_TABLE, change);
  }

  async changesOf(tables: TableAccess, licenceId: LicenceId): Promise<readonly LicenceStateChangeRow[]> {
    return listSequenced<LicenceStateChangeRow>(tables, LICENCE_STATE_CHANGES_TABLE, (change) => change.licenceId === licenceId);
  }
}

export class TableAttendanceStore implements AttendanceStore {
  async open(tables: TableAccess, attendantId: PersonId): Promise<AttendanceRow | undefined> {
    return (await this.ofAttendant(tables, attendantId)).find((row) => row.clockedOutAt === undefined);
  }

  async latest(tables: TableAccess, attendantId: PersonId): Promise<AttendanceRow | undefined> {
    return (await this.ofAttendant(tables, attendantId)).at(-1);
  }

  async add(tables: TableAccess, row: AttendanceRow): Promise<void> {
    await appendSequenced(tables, ATTENDANCE_TABLE, row, row.attendanceId);
  }

  async close(tables: TableAccess, attendanceId: string, clockedOutAt: string): Promise<void> {
    const row = await tables.read<AttendanceRow & Sequenced>(ATTENDANCE_TABLE, attendanceId);
    if (row === undefined) {
      throw new Error(`No attendance with the id ${attendanceId}`);
    }
    await tables.replace(ATTENDANCE_TABLE, attendanceId, { ...row, clockedOutAt });
  }

  all(tables: TableAccess): Promise<readonly AttendanceRow[]> {
    return listSequenced<AttendanceRow>(tables, ATTENDANCE_TABLE, () => true);
  }

  private ofAttendant(tables: TableAccess, attendantId: PersonId): Promise<readonly AttendanceRow[]> {
    return listSequenced<AttendanceRow>(tables, ATTENDANCE_TABLE, (row) => row.attendantId === attendantId);
  }
}

export class TableOffSiteStore implements OffSiteStore {
  async addReading(tables: TableAccess, reading: LocationReading): Promise<void> {
    await appendSequenced(tables, LOCATION_READINGS_TABLE, reading);
  }

  readingsOf(tables: TableAccess, attendanceId: string): Promise<readonly LocationReading[]> {
    return listSequenced<LocationReading>(tables, LOCATION_READINGS_TABLE, (reading) => reading.attendanceId === attendanceId);
  }

  async flagOf(tables: TableAccess, attendanceId: string): Promise<OffSiteFlagRow | undefined> {
    return (await tables.list<OffSiteFlagRow>(OFF_SITE_FLAGS_TABLE)).find((flag) => flag.attendanceId === attendanceId);
  }

  async addFlag(tables: TableAccess, flag: OffSiteFlagRow): Promise<void> {
    await tables.insert(OFF_SITE_FLAGS_TABLE, flag.flagId, flag);
  }

  async flagsIn(tables: TableAccess, zoneId: ZoneId): Promise<readonly OffSiteFlagRow[]> {
    return (await tables.list<OffSiteFlagRow>(OFF_SITE_FLAGS_TABLE)).filter((flag) => flag.zoneId === zoneId);
  }
}

async function upsert(tables: TableAccess, table: string, key: string, row: Row): Promise<void> {
  if ((await tables.read(table, key)) === undefined) {
    await tables.insert(table, key, row);
  } else {
    await tables.replace(table, key, row);
  }
}

/** Appends a row with the next sequence number; the key defaults to the sequence, for insert-only tables without an id. */
async function appendSequenced(tables: TableAccess, table: string, row: Row, key?: string): Promise<void> {
  const sequence = (await tables.list(table)).length + 1;
  await tables.insert(table, key ?? String(sequence), { ...row, sequence });
}

async function listSequenced<Stored extends Row>(tables: TableAccess, table: string, matches: (row: Stored) => boolean): Promise<readonly Stored[]> {
  return (await tables.list<Stored & Sequenced>(table))
    .filter(matches)
    .sort((first, second) => first.sequence - second.sequence)
    .map(({ sequence: _order, ...row }) => row as unknown as Stored);
}
