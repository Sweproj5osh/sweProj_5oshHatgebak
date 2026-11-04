/**
 * Licensing, Assignment & Attendance — owner: Teammate A (Area 2). May-fail set.
 * Attendant licences (state changed only through Approvals), site and shift assignment, inspector to zone,
 * clock in and out, off-site flags. Needs AuditTrail.
 */
import type { LicenceId, PersonId, SiteId, ZoneId } from '../../shared/identifiers';
import type { RequestId } from '../../shared/request-id';
import type { Result } from '../../shared/result';

export type LicenceState = 'valid' | 'suspended' | 'revoked';

export interface LicenceStatus {
  statusOf(attendantId: PersonId): Promise<LicenceState>;
  issueLicence(requestId: RequestId, attendantId: PersonId): Promise<LicenceId>;
  applyApprovedStateChange(licenceId: LicenceId, to: LicenceState, approvalRequestId: string): Promise<void>;
}

export type AssignmentRefusal = 'one site per attendant' | 'members are managed by the Chair only';

export interface Assignments {
  assignAttendantToSite(requestId: RequestId, attendantId: PersonId, siteId: SiteId, shiftId: string): Promise<Result<void, AssignmentRefusal>>;
  changeShift(requestId: RequestId, attendantId: PersonId, shiftId: string): Promise<void>;
  assignInspectorToZone(requestId: RequestId, inspectorId: PersonId, zoneId: ZoneId): Promise<void>;
  siteOf(attendantId: PersonId): Promise<SiteId | undefined>;
}

export type ClockInRefusal = 'wrong site' | 'forged code';

export interface Attendance {
  clockIn(requestId: RequestId, attendantId: PersonId, scannedSiteCode: string): Promise<Result<void, ClockInRefusal>>;
  clockOut(requestId: RequestId, attendantId: PersonId): Promise<void>;
  recordLocationPoint(attendantId: PersonId, latitude: number, longitude: number): Promise<void>;
  offSiteFlags(zoneId: ZoneId): Promise<readonly PersonId[]>;
}
