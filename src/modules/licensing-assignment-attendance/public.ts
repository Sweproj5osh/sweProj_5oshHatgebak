/**
 * Licensing, Assignment & Attendance — owner: Teammate A (Area 2). May-fail set.
 * Attendant licences (state changed only through Approvals), site and shift assignment, inspector to zone,
 * clock in and out, location readings and off-site flags. Imports the two must-stay-on modules above it, never the reverse.
 */
import type { Clock } from '../../shared/clock';
import type { EventPublisher } from '../../shared/events/event';
import type { ApprovalRequestId, DistrictId, LicenceId, PersonId, SiteId, ZoneId } from '../../shared/identifiers';
import type { Result } from '../../shared/result';
import type { TableAccess, Transaction } from '../../shared/unit-of-work';
import type { AccessFacts, Authorization, LicenceLiveState } from '../accounts-and-access-control/public';
import type { GeoPoint, SiteRegistry } from '../sites-and-areas/public';
import { TableAssignmentsStore, TableAttendanceStore, TableLicencesStore, TableOffSiteStore } from './internal/adapters/table-stores';
import { AssignmentsService } from './internal/assignments-service';
import { AttendanceService } from './internal/attendance-service';
import { LicencesService } from './internal/licences-service';
import type { AssignmentsStore, AttendanceStore, LicencesStore, OffSiteStore } from './internal/ports';

export type LicenceState = LicenceLiveState;

export type LicenceRefusal =
  | 'needs an approved request'
  | 'not a permitted change'
  | 'unknown licence'
  | 'already licensed'
  | 'not an attendant'
  | 'not allowed here';

/** One move of a licence, kept forever with the approved request that ordered it (null only for the issue). */
export interface LicenceStateChange {
  readonly licenceId: LicenceId;
  readonly from: LicenceState | null;
  readonly to: LicenceState;
  readonly approvalRequestId: ApprovalRequestId | null;
  readonly changedAt: string;
}

/**
 * The approving request's unit of work (ADR-13): the licence change, the attendant's closed shift, the access fact and
 * the event all go into it, so they commit or roll back with the approval itself (Rule E).
 */
export interface ApprovalUnitOfWork {
  readonly transaction: Transaction;
  readonly events: EventPublisher;
}

/** Published inside the approving request's unit of work for every approved licence move. */
export const LICENCE_STATE_CHANGED_TOPIC = 'LicenceStateChanged';

export interface LicenceStateChangedEvent {
  readonly licenceId: LicenceId;
  readonly attendantId: PersonId;
  readonly from: LicenceState;
  readonly to: LicenceState;
  readonly approvalRequestId: ApprovalRequestId;
  /** The open shift the change closed, or null when the attendant was not clocked in. */
  readonly closedAttendanceId: string | null;
}

/**
 * Attendant licences (task A11). The committee issues one licence per attendant: the Chair anywhere, a Member only
 * for an attendant assigned inside the own district; an attendant with no assignment is the Chair's alone (P24).
 * Suspension and revocation happen only through applyApprovedStateChange, which Approvals calls inside the transaction
 * that approves the request; "revoked" is final, and return to work is a new licence through a reinstate request (P24).
 */
export interface LicenceStatus {
  /** undefined when the attendant has never been licensed. */
  statusOf(attendantId: PersonId): Promise<LicenceState | undefined>;
  licenceOf(attendantId: PersonId): Promise<LicenceId | undefined>;
  issueLicence(actor: PersonId, attendantId: PersonId): Promise<Result<LicenceId, LicenceRefusal>>;
  applyApprovedStateChange(unitOfWork: ApprovalUnitOfWork, licenceId: LicenceId, to: LicenceState, approvalRequestId: ApprovalRequestId): Promise<Result<void, LicenceRefusal>>;
  /** Oldest first; empty for a licence nobody issued (no history is a valid answer). */
  history(licenceId: LicenceId): Promise<readonly LicenceStateChange[]>;
}

/**
 * Port: confirms that an approval request exists, was approved by the Chair, and orders exactly this licence move. The
 * composition root fills it from Approvals (Teammate C), which this module may not import because Approvals imports it.
 */
export interface ApprovalVerifier {
  isApproved(approvalRequestId: ApprovalRequestId, change: { readonly licenceId: LicenceId; readonly to: LicenceState }): Promise<boolean>;
}

export type AssignmentRefusal =
  | 'one site per attendant'
  | 'members are managed by the Chair only'
  | 'not allowed here'
  | 'not an attendant'
  | 'not an inspector'
  | 'not a member'
  | 'not assigned'
  | 'unknown site'
  | 'unknown zone'
  | 'unknown district'
  | 'invalid shift';

/**
 * Who works where (task A12). Every write takes the acting person: a member of the district or the Chair assigns
 * attendants and inspectors; only the Chair appoints members.
 */
export interface Assignments {
  assignAttendantToSite(actor: PersonId, attendantId: PersonId, siteId: SiteId, shiftId: string): Promise<Result<void, AssignmentRefusal>>;
  changeShift(actor: PersonId, attendantId: PersonId, shiftId: string): Promise<Result<void, AssignmentRefusal>>;
  releaseAttendant(actor: PersonId, attendantId: PersonId): Promise<Result<void, AssignmentRefusal>>;
  assignInspectorToZone(actor: PersonId, inspectorId: PersonId, zoneId: ZoneId): Promise<Result<void, AssignmentRefusal>>;
  appointMemberToDistrict(actor: PersonId, memberId: PersonId, districtId: DistrictId): Promise<Result<void, AssignmentRefusal>>;
  siteOf(attendantId: PersonId): Promise<SiteId | undefined>;
  shiftOf(attendantId: PersonId): Promise<string | undefined>;
  zoneOf(inspectorId: PersonId): Promise<ZoneId | undefined>;
}

export type ClockInRefusal = 'wrong site' | 'forged code' | 'not assigned' | 'licence not live' | 'already clocked in';
/** Three distinct answers (P23 #16): never clocked in, the last shift already closed, or the code of another site. */
export type ClockOutRefusal = 'not clocked in' | 'already clocked out' | 'wrong site' | 'forged code';
export type LocationRefusal = 'not clocked in' | 'invalid point';

/** A flag on the inspector's list: an attendant away from their site for a sustained part of a shift (task A14). */
export interface OffSiteFlag {
  readonly flagId: string;
  readonly attendantId: PersonId;
  readonly siteId: SiteId;
  readonly raisedAt: string;
}

/**
 * Clock in and out by scanning the own site's code (task A13). Clock-in binds the attendant's session to the site in
 * access control; clock-out releases it. Times come from the server clock. One open shift per person, in every path.
 */
export interface Attendance {
  clockIn(attendantId: PersonId, scannedSiteCode: string): Promise<Result<SiteId, ClockInRefusal>>;
  clockOut(attendantId: PersonId, scannedSiteCode: string): Promise<Result<SiteId, ClockOutRefusal>>;
  isClockedIn(attendantId: PersonId): Promise<boolean>;
  /** A reading from the phone during a shift (P7): only its distance from the site is kept. At most one flag per shift. */
  recordLocationPoint(attendantId: PersonId, point: GeoPoint): Promise<Result<{ flagRaised: boolean }, LocationRefusal>>;
  offSiteFlags(actor: PersonId, zoneId: ZoneId): Promise<Result<readonly OffSiteFlag[], 'not allowed here'>>;
}

/** The off-site rule's numbers (P11): readings beyond the radius for at least the minutes, unbroken, raise the flag. */
export { OFF_SITE_POLICY } from './internal/off-site-rule-constants';

export interface LicensingAssignmentAttendanceStores {
  readonly assignments: AssignmentsStore;
  readonly licences: LicencesStore;
  readonly attendance: AttendanceStore;
  readonly offSite: OffSiteStore;
}

export interface LicensingAssignmentAttendanceDependencies {
  /** The committed tables (ADR-13): reads outside a request, and the writes that do not arrive with a unit of work yet. */
  readonly database: TableAccess;
  readonly stores: LicensingAssignmentAttendanceStores;
  readonly authorization: Authorization;
  readonly accessFacts: AccessFacts;
  readonly registry: SiteRegistry;
  readonly approvals: ApprovalVerifier;
  readonly clock: Clock;
}

export interface LicensingAssignmentAttendance {
  readonly assignments: Assignments;
  readonly licences: LicenceStatus;
  readonly attendance: Attendance;
}

/** The composition root builds this module through this one function; nothing else constructs its internals. */
export function createLicensingAssignmentAttendance(dependencies: LicensingAssignmentAttendanceDependencies): LicensingAssignmentAttendance {
  const { database, stores, authorization, accessFacts, registry, approvals, clock } = dependencies;
  const attendance = new AttendanceService({
    database,
    attendance: stores.attendance,
    offSite: stores.offSite,
    assignments: stores.assignments,
    authorization,
    registry,
    clock,
  });
  return {
    assignments: new AssignmentsService({ database, assignments: stores.assignments, authorization, accessFacts, registry, clock }),
    licences: new LicencesService({ database, licences: stores.licences, assignments: stores.assignments, attendance, authorization, accessFacts, approvals, clock }),
    attendance,
  };
}

/** The stores over the shared TableAccess (ADR-13): the same adapters serve the in-memory database and PostgreSQL later. */
export function createLicensingStores(): LicensingAssignmentAttendanceStores {
  return {
    assignments: new TableAssignmentsStore(),
    licences: new TableLicencesStore(),
    attendance: new TableAttendanceStore(),
    offSite: new TableOffSiteStore(),
  };
}

/** The operations this module registers with the entry point; the composition root calls this once (P4). */
export { licensingOperations as operations, type LicensingOperationsDependencies } from './internal/operations';
