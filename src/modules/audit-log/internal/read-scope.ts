import type { AuditReader, AuditRecord } from '../public';

/** Member: own district. Chair: everything. Everyone else: entries they made or entries naming them (ADR-10). */
export function isVisibleTo(reader: AuditReader, record: AuditRecord): boolean {
  switch (reader.role) {
    case 'chair':
      return true;
    case 'member':
      return reader.districtId !== undefined && record.districtId === reader.districtId;
    default:
      return record.personId === reader.personId || (record.subjectPersonIds ?? []).includes(reader.personId);
  }
}
