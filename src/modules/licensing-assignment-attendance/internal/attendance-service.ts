import { randomUUID } from 'node:crypto';
import type { Clock } from '../../../shared/clock';
import type { PersonId, SiteId, ZoneId } from '../../../shared/identifiers';
import { fail, succeed, type Result } from '../../../shared/result';
import type { TableAccess } from '../../../shared/unit-of-work';
import type { Authorization } from '../../accounts-and-access-control/public';
import type { GeoPoint, SiteCodeRefusal, SiteRegistry } from '../../sites-and-areas/public';
import type { Attendance, ClockInRefusal, ClockOutRefusal, LocationRefusal, OffSiteFlag } from '../public';
import { isOffSite } from './off-site-rule-constants';
import type { AssignmentsStore, AttendanceRow, AttendanceStore, OffSiteStore } from './ports';

export interface AttendanceDependencies {
  /** The committed tables, for every call that does not arrive with a unit of work (see QUESTIONS.md item 23). */
  readonly database: TableAccess;
  readonly attendance: AttendanceStore;
  readonly offSite: OffSiteStore;
  readonly assignments: AssignmentsStore;
  readonly authorization: Authorization;
  readonly registry: SiteRegistry;
  readonly clock: Clock;
}

/**
 * Clock in and out (task A13). The attendant scans the code printed at their own site; a genuine code proves they
 * stand there, and the session is then bound to that site in access control, so a ticket request already carries its
 * proven site (ADR-02 amendment Q12a). Either of the site's two codes will do. One person has at most one open shift,
 * whichever path tries to open a second (P23 #16).
 */
export class AttendanceService implements Attendance {
  constructor(private readonly dependencies: AttendanceDependencies) {}

  async clockIn(attendantId: PersonId, scannedSiteCode: string): Promise<Result<SiteId, ClockInRefusal>> {
    const assignment = await this.dependencies.assignments.attendant(this.database, attendantId);
    if (assignment === undefined) {
      return fail('not assigned');
    }
    const scanned = await this.verifyEitherCode(scannedSiteCode, assignment.siteId);
    if (!scanned.ok) {
      return scanned;
    }
    if ((await this.dependencies.attendance.open(this.database, attendantId)) !== undefined) {
      return fail('already clocked in');
    }
    const bound = await this.dependencies.authorization.bindSessionToSite(this.database, attendantId, assignment.siteId);
    if (!bound.ok) {
      return fail('licence not live');
    }
    await this.dependencies.attendance.add(this.database, {
      attendanceId: `attendance-${randomUUID()}`,
      attendantId,
      siteId: assignment.siteId,
      shiftId: assignment.shiftId,
      clockedInAt: this.now(),
    });
    return succeed(assignment.siteId);
  }

  /** Three distinct answers (P23 #16): never clocked in, the last shift already closed, or the code of another site. */
  async clockOut(attendantId: PersonId, scannedSiteCode: string): Promise<Result<SiteId, ClockOutRefusal>> {
    const latest = await this.dependencies.attendance.latest(this.database, attendantId);
    if (latest === undefined) {
      return fail('not clocked in');
    }
    if (latest.clockedOutAt !== undefined) {
      return fail('already clocked out');
    }
    const scanned = await this.verifyEitherCode(scannedSiteCode, latest.siteId);
    if (!scanned.ok) {
      return scanned;
    }
    await this.closeShift(this.database, latest);
    return succeed(latest.siteId);
  }

  /** Called by the licence change that suspends or revokes, inside its unit of work: an attendant off the licence is off the shift. */
  async closeOpenShiftOf(transaction: TableAccess, attendantId: PersonId): Promise<string | undefined> {
    const open = await this.dependencies.attendance.open(transaction, attendantId);
    if (open === undefined) {
      return undefined;
    }
    await this.closeShift(transaction, open);
    return open.attendanceId;
  }

  async isClockedIn(attendantId: PersonId): Promise<boolean> {
    return (await this.dependencies.attendance.open(this.database, attendantId)) !== undefined;
  }

  /**
   * A location reading from the attendant's phone during a shift (task A14, P7). The reading's time is the server's;
   * only its distance from the site is kept. Returns whether this reading raised the shift's off-site flag.
   */
  async recordLocationPoint(attendantId: PersonId, point: GeoPoint): Promise<Result<{ flagRaised: boolean }, LocationRefusal>> {
    const open = await this.dependencies.attendance.open(this.database, attendantId);
    if (open === undefined) {
      return fail('not clocked in');
    }
    const distanceMeters = await this.dependencies.registry.distanceFromSite(open.siteId, point);
    if (distanceMeters === undefined) {
      return fail('invalid point');
    }
    const now = this.dependencies.clock.now();
    await this.dependencies.offSite.addReading(this.database, { attendanceId: open.attendanceId, distanceMeters: Math.round(distanceMeters), recordedAt: now.toISOString() });
    if ((await this.dependencies.offSite.flagOf(this.database, open.attendanceId)) !== undefined) {
      return succeed({ flagRaised: false });
    }
    const readings = await this.dependencies.offSite.readingsOf(this.database, open.attendanceId);
    const zoneId = (await this.dependencies.registry.locateSite(open.siteId))?.zoneId;
    if (zoneId === undefined || !isOffSite(readings, now)) {
      return succeed({ flagRaised: false });
    }
    await this.dependencies.offSite.addFlag(this.database, {
      flagId: `off-site-${randomUUID()}`,
      attendanceId: open.attendanceId,
      attendantId,
      siteId: open.siteId,
      zoneId,
      raisedAt: now.toISOString(),
    });
    return succeed({ flagRaised: true });
  }

  /** The inspector's list: off-site flags raised in a zone, for someone with scope over that zone. */
  async offSiteFlags(actor: PersonId, zoneId: ZoneId): Promise<Result<readonly OffSiteFlag[], 'not allowed here'>> {
    if (!(await this.dependencies.authorization.may(actor, 'attendance.offSiteFlags', { zoneId }))) {
      return fail('not allowed here');
    }
    const flags = await this.dependencies.offSite.flagsIn(this.database, zoneId);
    return succeed(flags.map(({ flagId, attendantId, siteId, raisedAt }) => ({ flagId, attendantId, siteId, raisedAt })));
  }

  private async closeShift(tables: TableAccess, shift: AttendanceRow): Promise<void> {
    await this.dependencies.attendance.close(tables, shift.attendanceId, this.now());
    await this.dependencies.authorization.unbindSession(tables, shift.attendantId);
  }

  private get database(): TableAccess {
    return this.dependencies.database;
  }

  private now(): string {
    return this.dependencies.clock.now().toISOString();
  }

  private async verifyEitherCode(code: string, siteId: SiteId): Promise<Result<SiteId, 'wrong site' | 'forged code'>> {
    const asEntry = await this.dependencies.registry.verifyEntryCode(code, siteId);
    const asExit = asEntry.ok ? asEntry : await this.dependencies.registry.verifyExitCode(code, siteId);
    if (asExit.ok) {
      return asExit;
    }
    const refusals: SiteCodeRefusal[] = asEntry.ok ? [] : [asEntry.error, asExit.error];
    return fail(refusals.includes('wrong site') ? 'wrong site' : 'forged code');
  }
}
