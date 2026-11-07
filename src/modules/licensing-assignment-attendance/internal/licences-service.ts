import { randomUUID } from 'node:crypto';
import type { Clock } from '../../../shared/clock';
import type { ApprovalRequestId, LicenceId, PersonId } from '../../../shared/identifiers';
import { fail, succeed, type Result } from '../../../shared/result';
import type { TableAccess } from '../../../shared/unit-of-work';
import type { AccessFacts, Authorization } from '../../accounts-and-access-control/public';
import {
  LICENCE_STATE_CHANGED_TOPIC,
  type ApprovalUnitOfWork,
  type ApprovalVerifier,
  type LicenceRefusal,
  type LicenceState,
  type LicenceStateChangedEvent,
  type LicenceStatus,
} from '../public';
import type { AttendanceService } from './attendance-service';
import { isPermittedMove } from './domain/licence-transitions';
import type { AssignmentsStore, LicencesStore, LicenceStateChangeRow } from './ports';

export interface LicencesDependencies {
  /** The committed tables, for every call that does not arrive with a unit of work (see QUESTIONS.md item 23). */
  readonly database: TableAccess;
  readonly licences: LicencesStore;
  readonly assignments: AssignmentsStore;
  readonly attendance: AttendanceService;
  readonly authorization: Authorization;
  readonly accessFacts: AccessFacts;
  readonly approvals: ApprovalVerifier;
  readonly clock: Clock;
}

/**
 * Attendant licences (task A11). The committee issues a licence; it moves valid → suspended → revoked only when an
 * approved request says so, checked through the ApprovalVerifier port, and revoked is final (P24). Every move is kept
 * with its approval, mirrored into access control so the attendant is refused on the very next request, and closes
 * the attendant's open shift in the same unit of work.
 */
export class LicencesService implements LicenceStatus {
  constructor(private readonly dependencies: LicencesDependencies) {}

  async statusOf(attendantId: PersonId): Promise<LicenceState | undefined> {
    const licence = await this.dependencies.licences.ofAttendant(this.database, attendantId);
    return licence === undefined ? undefined : this.currentState(this.database, licence.licenceId);
  }

  async licenceOf(attendantId: PersonId): Promise<LicenceId | undefined> {
    return (await this.dependencies.licences.ofAttendant(this.database, attendantId))?.licenceId;
  }

  /** The scope is the attendant's site; an attendant with no site is a system-wide matter, so only the Chair (P23 #10, P24). */
  async issueLicence(actor: PersonId, attendantId: PersonId): Promise<Result<LicenceId, LicenceRefusal>> {
    if ((await this.dependencies.authorization.roleOf(attendantId)) !== 'attendant') {
      return fail('not an attendant');
    }
    const siteId = (await this.dependencies.assignments.attendant(this.database, attendantId))?.siteId;
    const scope = siteId === undefined ? {} : { siteId };
    if (!(await this.dependencies.authorization.may(actor, 'licences.issue', scope))) {
      return fail('not allowed here');
    }
    if ((await this.dependencies.licences.ofAttendant(this.database, attendantId)) !== undefined) {
      return fail('already licensed');
    }
    const licenceId = `licence-${randomUUID()}`;
    const now = this.now();
    await this.dependencies.licences.add(this.database, { licenceId, attendantId, issuedBy: actor, issuedAt: now });
    await this.dependencies.licences.appendChange(this.database, { licenceId, from: null, to: 'valid', approvalRequestId: null, changedAt: now });
    await this.dependencies.accessFacts.recordLicenceState(this.database, attendantId, 'valid');
    return succeed(licenceId);
  }

  async applyApprovedStateChange(
    unitOfWork: ApprovalUnitOfWork,
    licenceId: LicenceId,
    to: LicenceState,
    approvalRequestId: ApprovalRequestId,
  ): Promise<Result<void, LicenceRefusal>> {
    const { transaction } = unitOfWork;
    const licence = await this.dependencies.licences.find(transaction, licenceId);
    if (licence === undefined) {
      return fail('unknown licence');
    }
    const from = await this.currentState(transaction, licenceId);
    if (!isPermittedMove(from, to)) {
      return fail('not a permitted change');
    }
    if (!(await this.dependencies.approvals.isApproved(approvalRequestId, { licenceId, to }))) {
      return fail('needs an approved request');
    }
    await this.dependencies.licences.appendChange(transaction, { licenceId, from, to, approvalRequestId, changedAt: this.now() });
    await this.dependencies.accessFacts.recordLicenceState(transaction, licence.attendantId, to);
    const closedAttendanceId = await this.dependencies.attendance.closeOpenShiftOf(transaction, licence.attendantId);
    const event: LicenceStateChangedEvent = { licenceId, attendantId: licence.attendantId, from, to, approvalRequestId, closedAttendanceId: closedAttendanceId ?? null };
    unitOfWork.events.publish({ topic: LICENCE_STATE_CHANGED_TOPIC, payload: event });
    return succeed(undefined);
  }

  /** Empty for a licence that does not exist: no history is a valid answer (P23 #10). */
  history(licenceId: LicenceId): Promise<readonly LicenceStateChangeRow[]> {
    return this.dependencies.licences.changesOf(this.database, licenceId);
  }

  private get database(): TableAccess {
    return this.dependencies.database;
  }

  /** The last change's target; a licence row always has its issue as the first change. */
  private async currentState(tables: TableAccess, licenceId: LicenceId): Promise<LicenceState> {
    const changes = await this.dependencies.licences.changesOf(tables, licenceId);
    const last = changes[changes.length - 1];
    if (last === undefined) {
      throw new Error(`Licence ${licenceId} has no state change, not even its issue`);
    }
    return last.to;
  }

  private now(): string {
    return this.dependencies.clock.now().toISOString();
  }
}
