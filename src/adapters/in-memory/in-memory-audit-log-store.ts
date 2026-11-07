import type { AuditLogStore, AuditRecord } from '../../modules/audit-log/public';
import { AUDIT_LOG_TABLE, type RowTables } from './in-memory-database';

/**
 * Append-only by construction: the store exposes no way to change or remove a record, and the module-facing
 * TableAccess refuses the audit_log table altogether, so this store is the only way in.
 */
export class InMemoryAuditLogStore implements AuditLogStore {
  constructor(private readonly tables: RowTables) {}

  async appendRecord(record: AuditRecord): Promise<void> {
    this.tables.insert(AUDIT_LOG_TABLE, String(record.id), record);
  }

  async lastRecord(): Promise<AuditRecord | undefined> {
    const all = this.tables.list<AuditRecord>(AUDIT_LOG_TABLE);
    return all[all.length - 1];
  }

  async readAll(): Promise<readonly AuditRecord[]> {
    return this.tables.list<AuditRecord>(AUDIT_LOG_TABLE);
  }
}
