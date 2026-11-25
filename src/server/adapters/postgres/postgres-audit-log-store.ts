import type pg from 'pg';
import type { AuditLogStore, AuditRecord, ChainHead } from '../../modules/foundation/audit-log/index';
import type { PostgresTransaction, Queryable } from './postgres-database';

/**
 * The advisory lock every append takes inside its transaction before it reads the last record (ADR-10): two server
 * copies never chain two records onto the same predecessor. Any fixed number works; this one spells "sayes" in ASCII.
 */
export const AUDIT_APPEND_LOCK = 0x7361796573;

interface AuditRow extends pg.QueryResultRow {
  readonly id: string;
  readonly prev_hash: string;
  readonly hash: string;
  readonly actor_kind: AuditRecord['actorKind'];
  readonly person_id: string | null;
  readonly role: NonNullable<AuditRecord['role']> | null;
  readonly address: string | null;
  readonly operation: string;
  readonly input: unknown;
  readonly reason: string | null;
  readonly approver_id: string | null;
  readonly request_id: string;
  readonly recorded_at: Date;
  readonly district_id: string | null;
  readonly subject_person_ids: string[] | null;
}

const COLUMNS =
  'id, prev_hash, hash, actor_kind, person_id, role, address, operation, input, reason, approver_id, request_id, recorded_at, district_id, subject_person_ids';

/**
 * The append-only audit log over `audit_log.audit_log` and its one-row `audit_log.head` (migrations 0001, 0003, 0005).
 * It has no update or delete path for the log; only the head row moves. The record read back is exactly the record
 * that was hashed: an absent field stays absent and the time keeps its ISO text, so the chain verifies.
 */
export class PostgresAuditLogStore implements AuditLogStore {
  private locked = false;

  /** `through` is a unit of work for appends, or the committed tables for reads. */
  constructor(private readonly through: Queryable | PostgresTransaction) {}

  async appendRecord(record: AuditRecord): Promise<void> {
    await this.lockAppends();
    await this.through.query(
      `INSERT INTO audit_log.audit_log (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15)`,
      [
        record.id,
        record.prevHash,
        record.hash,
        record.actorKind,
        record.personId ?? null,
        record.role ?? null,
        record.address ?? null,
        record.operation,
        JSON.stringify(record.input),
        record.reason ?? null,
        record.approverId ?? null,
        record.requestId,
        record.recordedAt,
        record.districtId ?? null,
        record.subjectPersonIds ?? null,
      ],
    );
    await this.through.query(
      `INSERT INTO audit_log.head (one_row, last_id, last_hash) VALUES (true, $1, $2)
       ON CONFLICT (one_row) DO UPDATE SET last_id = EXCLUDED.last_id, last_hash = EXCLUDED.last_hash`,
      [record.id, record.hash],
    );
  }

  async lastRecord(): Promise<AuditRecord | undefined> {
    await this.lockAppends();
    const result = await this.through.query<AuditRow>(`SELECT ${COLUMNS} FROM audit_log.audit_log ORDER BY id DESC LIMIT 1`);
    const row = result.rows[0];
    return row === undefined ? undefined : recordFrom(row);
  }

  async readAll(): Promise<readonly AuditRecord[]> {
    const result = await this.through.query<AuditRow>(`SELECT ${COLUMNS} FROM audit_log.audit_log ORDER BY id`);
    return result.rows.map(recordFrom);
  }

  async head(): Promise<ChainHead | undefined> {
    const result = await this.through.query<{ last_id: string; last_hash: string }>('SELECT last_id, last_hash FROM audit_log.head');
    const row = result.rows[0];
    return row === undefined ? undefined : { lastId: Number(row.last_id), lastHash: row.last_hash };
  }

  /** Inside a unit of work, once: the transaction-scoped advisory lock, released by COMMIT or ROLLBACK. */
  private async lockAppends(): Promise<void> {
    if (this.locked || !('whenDone' in this.through)) {
      return;
    }
    this.locked = true;
    this.through.whenDone(() => {
      this.locked = false;
    });
    await this.through.query('SELECT pg_advisory_xact_lock($1)', [AUDIT_APPEND_LOCK]);
  }
}

/** The record in the shape the trail built it: absent fields stay absent. */
function recordFrom(row: AuditRow): AuditRecord {
  return {
    operation: row.operation,
    input: row.input,
    requestId: row.request_id,
    ...(row.reason === null ? {} : { reason: row.reason }),
    ...(row.approver_id === null ? {} : { approverId: row.approver_id }),
    ...(row.district_id === null ? {} : { districtId: row.district_id }),
    ...(row.subject_person_ids === null ? {} : { subjectPersonIds: row.subject_person_ids }),
    actorKind: row.actor_kind,
    ...(row.person_id === null ? {} : { personId: row.person_id }),
    ...(row.role === null ? {} : { role: row.role }),
    ...(row.address === null ? {} : { address: row.address }),
    id: Number(row.id),
    recordedAt: row.recorded_at.toISOString(),
    prevHash: row.prev_hash,
    hash: row.hash,
  };
}
