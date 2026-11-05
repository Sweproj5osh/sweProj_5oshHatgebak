/**
 * Cash Custody — owner: Teammate C (Area 4). May-fail set.
 * Deposit record with a system-issued receipt number; the zone's inspector confirms or rejects (ADR-12).
 * Needs Authorization, AuditTrail.
 */
import type { DepositId, PersonId, SiteId } from '../../shared/identifiers';
import type { RequestId } from '../../shared/request-id';
import type { Result } from '../../shared/result';

export type DepositState = 'recorded' | 'confirmed' | 'rejected';

export interface DepositReceipt {
  readonly receiptNumber: string;
  readonly text: string;
}

export interface Deposit {
  readonly depositId: DepositId;
  readonly attendantId: PersonId;
  readonly siteId: SiteId;
  readonly shiftId: string;
  readonly amount: number;
  readonly state: DepositState;
  readonly receipt: DepositReceipt;
}

export type DepositRefusal = 'not this zone' | 'reason required' | 'already decided';

export interface DepositLedger {
  recordDeposit(requestId: RequestId, attendantId: PersonId, siteId: SiteId, shiftId: string, amount: number): Promise<Deposit>;
  confirmDeposit(requestId: RequestId, depositId: DepositId, inspectorId: PersonId): Promise<Result<Deposit, DepositRefusal>>;
  rejectDeposit(requestId: RequestId, depositId: DepositId, inspectorId: PersonId, reason: string): Promise<Result<Deposit, DepositRefusal>>;
  depositsFor(siteId: SiteId, periodStart: Date, periodEnd: Date): Promise<readonly Deposit[]>;
}
