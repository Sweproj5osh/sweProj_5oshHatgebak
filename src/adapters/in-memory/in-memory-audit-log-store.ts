import type { AuditLogStore, AuditRecord } from '../../modules/audit-log/public';
import type { TableAccess } from './in-memory-database';

export const AUDIT_LOG_TABLE = 'audit_log';

/** Append-only by construction: the store exposes no way to change or remove a record. */
export class InMemoryAuditLogStore implements AuditLogStore {
  constructor(private readonly access: TableAccess) {}

  async appendRecord(record: AuditRecord): Promise<void> {
    this.access.insert(AUDIT_LOG_TABLE, record);
  }

  async lastRecord(): Promise<AuditRecord | undefined> {
    const all = this.access.rows<AuditRecord>(AUDIT_LOG_TABLE);
    return all[all.length - 1];
  }

  async readAll(): Promise<readonly AuditRecord[]> {
    return this.access.rows<AuditRecord>(AUDIT_LOG_TABLE);
  }
}
