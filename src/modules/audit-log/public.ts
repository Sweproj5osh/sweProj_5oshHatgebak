/**
 * Audit Log — owner: Zeyad (Area 1). Must-stay-on set.
 * Append-only, hash-chained record of every action (ADR-10). Needs nothing from other modules.
 */
import type { DistrictId, PersonId, Role } from '../../shared/identifiers';
import type { RequestId } from '../../shared/request-id';

/** What a write operation hands to the audit log: who, role, what, inputs, why, approver, request id. */
export interface AuditEntry {
  readonly personId: PersonId;
  readonly role: Role;
  readonly operation: string;
  readonly input: unknown;
  readonly reason?: string;
  readonly approverId?: PersonId;
  readonly requestId: RequestId;
  /** The district the action belongs to; members read their district's entries. */
  readonly districtId?: DistrictId;
  /** People the action is about (for example the attendant whose licence changed); they read entries naming them. */
  readonly subjectPersonIds?: readonly PersonId[];
}

/** A stored entry: the audit entry plus the server time and the hash chain fields. */
export interface AuditRecord extends AuditEntry {
  readonly id: number;
  readonly recordedAt: string;
  readonly prevHash: string;
  readonly hash: string;
}

export interface AuditReader {
  readonly personId: PersonId;
  readonly role: Role;
  readonly districtId?: DistrictId;
}

export interface AuditTrail {
  append(entry: AuditEntry): Promise<AuditRecord>;
  verifyChain(): Promise<boolean>;
  readByScope(reader: AuditReader): Promise<readonly AuditRecord[]>;
}

/**
 * Storage port. Adapters live in src/adapters; the in-memory one is the default for every test.
 * The chain derives each record's id and prevHash from the last record, so reading the last record and appending the
 * next must be serialized across every running copy of the server: the PostgreSQL adapter takes
 * `pg_advisory_xact_lock(<constant>)` inside the write's transaction before `lastRecord()` and `appendRecord()`.
 */
export interface AuditLogStore {
  appendRecord(record: AuditRecord): Promise<void>;
  lastRecord(): Promise<AuditRecord | undefined>;
  readAll(): Promise<readonly AuditRecord[]>;
}

export { createHashChainedAuditTrail, GENESIS_HASH } from './internal/hash-chained-audit-trail';

/** The operations this module registers with the entry point; the composition root calls this once (P4). */
export { auditLogOperations as operations, type AuditLogOperationsDependencies } from './internal/audit-operations';
