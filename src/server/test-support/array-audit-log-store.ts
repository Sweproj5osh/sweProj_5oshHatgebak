import type { AuditLogStore, AuditRecord, ChainHead } from '../modules/foundation/audit-log/index';

/**
 * Test-only (F14): an AuditLogStore over a plain array, for the proofs that edit or cut records underneath the log to
 * show that verification catches it (ADR-10). The real log refuses such edits: the application's database role has no
 * UPDATE or DELETE on `audit_log`, and no code path issues one, so the proofs edit this copy instead.
 */
export class ArrayAuditLogStore implements AuditLogStore {
  readonly records: AuditRecord[];
  chainHead: ChainHead | undefined;

  constructor(records: readonly AuditRecord[] = [], chainHead?: ChainHead) {
    this.records = [...records];
    this.chainHead = chainHead;
  }

  async appendRecord(record: AuditRecord): Promise<void> {
    this.records.push(record);
    this.chainHead = { lastId: record.id, lastHash: record.hash };
  }

  async lastRecord(): Promise<AuditRecord | undefined> {
    return this.records[this.records.length - 1];
  }

  async readAll(): Promise<readonly AuditRecord[]> {
    return [...this.records];
  }

  async head(): Promise<ChainHead | undefined> {
    return this.chainHead;
  }

  /** Removes the record with this id, as someone deleting a row underneath the log would. */
  cut(id: number): void {
    const index = this.records.findIndex((record) => record.id === id);
    if (index >= 0) {
      this.records.splice(index, 1);
    }
  }
}
