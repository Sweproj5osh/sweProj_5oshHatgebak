/**
 * Audit Log — owner: Zeyad (Area 1). Must-stay-on set.
 * Append-only, hash-chained record of every action (ADR-10). Needs nothing from other modules.
 */
import type { DistrictId, PersonId, Role } from '../../shared/identifiers';
import type { RequestId } from '../../shared/request-id';

/** A signed-in person acting through the entry point. */
export interface PersonAuditActor {
  readonly kind: 'person';
  readonly personId: PersonId;
  readonly role: Role;
}

/** A caller of a public operation (sign-in, ADR-15): nobody is signed in yet, so the client address stands for them. */
export interface AnonymousAuditActor {
  readonly kind: 'anonymous';
  readonly address: string;
}

/** The system itself, for the few actions no person triggers (the one-time bootstrap of the first Chair). */
export interface SystemAuditActor {
  readonly kind: 'system';
}

export type AuditActor = PersonAuditActor | AnonymousAuditActor | SystemAuditActor;

/** What the pipeline hands to the audit log for one action: who, what, inputs (redacted), why, approver, request id. */
export interface AuditEntry {
  readonly actor: AuditActor;
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

/**
 * A stored entry: the entry's fields with the actor laid flat as the table holds it (a person's `personId` and `role`,
 * or an anonymous caller's `address`), plus the server time and the hash chain fields.
 */
export interface AuditRecord extends Omit<AuditEntry, 'actor'> {
  readonly id: number;
  readonly actorKind: AuditActor['kind'];
  readonly personId?: PersonId;
  readonly role?: Role;
  readonly address?: string;
  readonly recordedAt: string;
  readonly prevHash: string;
  readonly hash: string;
}

export interface AuditReader {
  readonly personId: PersonId;
  readonly role: Role;
  readonly districtId?: DistrictId;
}

/** The last id and hash, kept beside the log and moved by every append, so a log cut at its tail no longer verifies. */
export interface ChainHead {
  readonly lastId: number;
  readonly lastHash: string;
}

export interface AuditTrail {
  append(entry: AuditEntry): Promise<AuditRecord>;
  /** True when every record chains to the one before it and the head names the last record. */
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
  /** Stores the record and moves the head to it, in the same transaction. */
  appendRecord(record: AuditRecord): Promise<void>;
  lastRecord(): Promise<AuditRecord | undefined>;
  readAll(): Promise<readonly AuditRecord[]>;
  head(): Promise<ChainHead | undefined>;
}

export { createHashChainedAuditTrail, GENESIS_HASH } from './internal/hash-chained-audit-trail';

/** The operations this module registers with the entry point; the composition root calls this once (P4). */
export { auditLogOperations as operations, type AuditLogOperationsDependencies } from './internal/audit-operations';
