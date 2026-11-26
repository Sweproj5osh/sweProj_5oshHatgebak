/**
 * Complaints, Inspections & Ratings — owner: Teammate D (Area 5). May-fail set.
 * Complaints up the hierarchy, inspection reports, road-block confirmations, ratings, disputes.
 * Needs TicketQuery, EvidenceStore, AuditTrail.
 */
import type { PersonId, PhotoId, SiteId, TicketId } from '../../shared/identifiers';
import type { RequestId } from '../../shared/request-id';
import type { Result } from '../../shared/result';

export type ComplaintRefusal = 'cannot complain upward' | 'reason required';

export interface Complaints {
  file(requestId: RequestId, filerId: PersonId, aboutPersonId: PersonId, text: string, photos: readonly PhotoId[]): Promise<Result<string, ComplaintRefusal>>;
  assign(requestId: RequestId, complaintId: string, toPersonId: PersonId): Promise<void>;
  decide(requestId: RequestId, complaintId: string, deciderId: PersonId, reason: string): Promise<Result<void, ComplaintRefusal>>;
  escalateToChair(requestId: RequestId, complaintId: string): Promise<void>;
}

export interface Inspections {
  fileReport(requestId: RequestId, inspectorId: PersonId, siteId: SiteId, text: string, photos: readonly PhotoId[]): Promise<string>;
  confirmRoadBlock(requestId: RequestId, reportId: string, inspectorId: PersonId): Promise<void>;
  rejectRoadBlock(requestId: RequestId, reportId: string, inspectorId: PersonId, reason: string): Promise<void>;
}

export type DisputeDecision = 'waive' | 'back to unpaid';

export interface Scores {
  rate(requestId: RequestId, ticketId: TicketId, driverId: PersonId, stars: number): Promise<Result<void, 'already rated'>>;
  averageFor(attendantId: PersonId): Promise<number>;
  dispute(requestId: RequestId, ticketId: TicketId, driverId: PersonId, text: string): Promise<void>;
  decideDispute(requestId: RequestId, ticketId: TicketId, memberId: PersonId, decision: DisputeDecision, reason: string): Promise<void>;
}
