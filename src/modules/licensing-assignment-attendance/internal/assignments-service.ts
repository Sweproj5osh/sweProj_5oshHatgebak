import type { Clock } from '../../../shared/clock';
import type { DistrictId, PersonId, Role, SiteId, ZoneId } from '../../../shared/identifiers';
import { fail, succeed, type Result } from '../../../shared/result';
import type { TableAccess } from '../../../shared/unit-of-work';
import type { AccessFacts, Authorization } from '../../accounts-and-access-control/public';
import type { SiteRegistry } from '../../sites-and-areas/public';
import type { AssignmentRefusal, Assignments } from '../public';
import type { AssignmentsStore } from './ports';

export interface AssignmentsDependencies {
  /** The committed tables, for every call that does not arrive with a unit of work (see QUESTIONS.md item 23). */
  readonly database: TableAccess;
  readonly assignments: AssignmentsStore;
  readonly authorization: Authorization;
  readonly accessFacts: AccessFacts;
  readonly registry: SiteRegistry;
  readonly clock: Clock;
}

const MAXIMUM_SHIFT_LENGTH = 40;

/**
 * Who works where (task A12): an attendant at one fixed site with a changeable shift, an inspector over one zone, a
 * member over one district. Every change is also recorded in access control's facts, through the same tables, so
 * permission answers follow at once without access control ever calling this may-fail module (Rule D).
 */
export class AssignmentsService implements Assignments {
  constructor(private readonly dependencies: AssignmentsDependencies) {}

  async assignAttendantToSite(actor: PersonId, attendantId: PersonId, siteId: SiteId, shiftId: string): Promise<Result<void, AssignmentRefusal>> {
    const shift = validShift(shiftId);
    if (!shift.ok) {
      return shift;
    }
    const checked = await this.checkTarget(attendantId, 'attendant', 'not an attendant');
    if (!checked.ok) {
      return checked;
    }
    if ((await this.dependencies.registry.locateSite(siteId)) === undefined) {
      return fail('unknown site');
    }
    if (!(await this.dependencies.authorization.may(actor, 'assignments.assignAttendant', { siteId }))) {
      return fail('not allowed here');
    }
    const current = await this.dependencies.assignments.attendant(this.database, attendantId);
    if (current !== undefined && current.siteId !== siteId) {
      return fail('one site per attendant');
    }
    await this.dependencies.assignments.saveAttendant(this.database, { attendantId, siteId, shiftId: shift.value, assignedBy: actor, assignedAt: this.now() });
    await this.dependencies.accessFacts.recordAttendantSite(this.database, attendantId, siteId);
    return succeed(undefined);
  }

  async changeShift(actor: PersonId, attendantId: PersonId, shiftId: string): Promise<Result<void, AssignmentRefusal>> {
    const shift = validShift(shiftId);
    if (!shift.ok) {
      return shift;
    }
    const current = await this.dependencies.assignments.attendant(this.database, attendantId);
    if (current === undefined) {
      return fail('not assigned');
    }
    if (!(await this.dependencies.authorization.may(actor, 'assignments.changeShift', { siteId: current.siteId }))) {
      return fail('not allowed here');
    }
    await this.dependencies.assignments.saveAttendant(this.database, { ...current, shiftId: shift.value, assignedBy: actor, assignedAt: this.now() });
    return succeed(undefined);
  }

  /** Frees an attendant from their site, so a later assignment may name another one. */
  async releaseAttendant(actor: PersonId, attendantId: PersonId): Promise<Result<void, AssignmentRefusal>> {
    const current = await this.dependencies.assignments.attendant(this.database, attendantId);
    if (current === undefined) {
      return fail('not assigned');
    }
    if (!(await this.dependencies.authorization.may(actor, 'assignments.releaseAttendant', { siteId: current.siteId }))) {
      return fail('not allowed here');
    }
    await this.dependencies.assignments.removeAttendant(this.database, attendantId);
    await this.dependencies.accessFacts.clearAttendantSite(this.database, attendantId);
    return succeed(undefined);
  }

  async assignInspectorToZone(actor: PersonId, inspectorId: PersonId, zoneId: ZoneId): Promise<Result<void, AssignmentRefusal>> {
    const checked = await this.checkTarget(inspectorId, 'inspector', 'not an inspector');
    if (!checked.ok) {
      return checked;
    }
    if ((await this.dependencies.registry.locateZone(zoneId)) === undefined) {
      return fail('unknown zone');
    }
    if (!(await this.dependencies.authorization.may(actor, 'assignments.assignInspector', { zoneId }))) {
      return fail('not allowed here');
    }
    if (!(await this.mayTakeInspectorFromCurrentZone(actor, inspectorId, zoneId))) {
      return fail('not allowed here');
    }
    await this.dependencies.assignments.saveInspector(this.database, { inspectorId, zoneId, assignedBy: actor, assignedAt: this.now() });
    await this.dependencies.accessFacts.recordInspectorZone(this.database, inspectorId, zoneId);
    return succeed(undefined);
  }

  /** Moving an inspector needs scope over the zone they leave as well as the zone they join (a Member may not pull an
   * inspector out of another district); a first assignment has no zone to leave. */
  private async mayTakeInspectorFromCurrentZone(actor: PersonId, inspectorId: PersonId, zoneId: ZoneId): Promise<boolean> {
    const current = await this.dependencies.assignments.inspector(this.database, inspectorId);
    if (current === undefined || current.zoneId === zoneId) {
      return true;
    }
    return this.dependencies.authorization.may(actor, 'assignments.assignInspector', { zoneId: current.zoneId });
  }

  async appointMemberToDistrict(actor: PersonId, memberId: PersonId, districtId: DistrictId): Promise<Result<void, AssignmentRefusal>> {
    if ((await this.dependencies.authorization.roleOf(actor)) !== 'chair' || (await this.dependencies.authorization.liveStatus(actor)) !== 'active') {
      return fail('members are managed by the Chair only');
    }
    const checked = await this.checkTarget(memberId, 'member', 'not a member');
    if (!checked.ok) {
      return checked;
    }
    if (!(await this.dependencies.registry.districtExists(districtId))) {
      return fail('unknown district');
    }
    await this.dependencies.assignments.saveMember(this.database, { memberId, districtId, appointedBy: actor, appointedAt: this.now() });
    await this.dependencies.accessFacts.recordMemberDistrict(this.database, memberId, districtId);
    return succeed(undefined);
  }

  async siteOf(attendantId: PersonId): Promise<SiteId | undefined> {
    return (await this.dependencies.assignments.attendant(this.database, attendantId))?.siteId;
  }

  async shiftOf(attendantId: PersonId): Promise<string | undefined> {
    return (await this.dependencies.assignments.attendant(this.database, attendantId))?.shiftId;
  }

  async zoneOf(inspectorId: PersonId): Promise<ZoneId | undefined> {
    return (await this.dependencies.assignments.inspector(this.database, inspectorId))?.zoneId;
  }

  private get database(): TableAccess {
    return this.dependencies.database;
  }

  private async checkTarget(personId: PersonId, role: Role, refusal: AssignmentRefusal): Promise<Result<void, AssignmentRefusal>> {
    return (await this.dependencies.authorization.roleOf(personId)) === role ? succeed(undefined) : fail(refusal);
  }

  private now(): string {
    return this.dependencies.clock.now().toISOString();
  }
}

function validShift(shiftId: string): Result<string, AssignmentRefusal> {
  const trimmed = shiftId.trim();
  return trimmed === '' || trimmed.length > MAXIMUM_SHIFT_LENGTH ? fail('invalid shift') : succeed(trimmed);
}
