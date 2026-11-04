/**
 * Approvals — owner: Teammate C (Area 4). May-fail set.
 * A member requests with a reason, the Chair approves or rejects, the change is applied; nobody approves their own
 * request. Needs PriceList, LicenceStatus, Authorization, AuditTrail.
 */
import type { ApprovalRequestId, PersonId } from '../../shared/identifiers';
import type { RequestId } from '../../shared/request-id';
import type { Result } from '../../shared/result';

export type ApprovableKind = 'price change' | 'licence suspension' | 'licence revocation';
export type ApprovalState = 'pending' | 'approved' | 'rejected';

export interface ApprovalRequest {
  readonly approvalRequestId: ApprovalRequestId;
  readonly kind: ApprovableKind;
  readonly requesterId: PersonId;
  readonly reason: string;
  readonly change: unknown;
  readonly state: ApprovalState;
  readonly approverId?: PersonId;
}

export type ApprovalRefusal = 'reason required' | 'cannot approve own request' | 'only the Chair approves' | 'already decided';

export interface ApprovalDesk {
  fileRequest(requestId: RequestId, requesterId: PersonId, kind: ApprovableKind, change: unknown, reason: string): Promise<Result<ApprovalRequest, ApprovalRefusal>>;
  approve(requestId: RequestId, approvalRequestId: ApprovalRequestId, approverId: PersonId): Promise<Result<ApprovalRequest, ApprovalRefusal>>;
  reject(requestId: RequestId, approvalRequestId: ApprovalRequestId, approverId: PersonId, reason: string): Promise<Result<ApprovalRequest, ApprovalRefusal>>;
  /** The Chair acting directly goes through the same path, so the audit entry has the same shape (C14). */
  actDirectly(requestId: RequestId, chairId: PersonId, kind: ApprovableKind, change: unknown, reason: string): Promise<ApprovalRequest>;
}
