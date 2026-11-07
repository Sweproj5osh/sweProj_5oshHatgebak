import type { AuditLogStore, AuditRecord, ChainHead } from '../../modules/audit-log/public';
import { AUDIT_LOG_HEAD_TABLE, AUDIT_LOG_TABLE, type RowTables } from './in-memory-database';

const THE_ONE_HEAD_ROW = 'head';

/**
 * Append-only by construction: the store exposes no way to change or remove a record, and the module-facing
 * TableAccess refuses the audit tables altogether, so this store is the only way in. The head row is the one row that
 * moves: every append points it at the new last record, in the same transaction.
 */
export class InMemoryAuditLogStore implements AuditLogStore {
  constructor(private readonly tables: RowTables) {}

  async appendRecord(record: AuditRecord): Promise<void> {
    this.tables.insert(AUDIT_LOG_TABLE, String(record.id), record);
    this.moveHeadTo(record);
  }

  async lastRecord(): Promise<AuditRecord | undefined> {
    const all = this.tables.list<AuditRecord>(AUDIT_LOG_TABLE);
    return all[all.length - 1];
  }

  async readAll(): Promise<readonly AuditRecord[]> {
    return this.tables.list<AuditRecord>(AUDIT_LOG_TABLE);
  }

  async head(): Promise<ChainHead | undefined> {
    return this.tables.find<ChainHead>(AUDIT_LOG_HEAD_TABLE, THE_ONE_HEAD_ROW);
  }

  private moveHeadTo(record: AuditRecord): void {
    const head: ChainHead = { lastId: record.id, lastHash: record.hash };
    if (this.tables.find(AUDIT_LOG_HEAD_TABLE, THE_ONE_HEAD_ROW) === undefined) {
      this.tables.insert(AUDIT_LOG_HEAD_TABLE, THE_ONE_HEAD_ROW, head);
    } else {
      this.tables.replace(AUDIT_LOG_HEAD_TABLE, THE_ONE_HEAD_ROW, head);
    }
  }
}
