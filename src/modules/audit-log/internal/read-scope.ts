import type { AuditReader, AuditRecord } from '../public';

/** Member: own district. Chair: everything. Everyone else: entries they made or entries naming them (ADR-10). */
export function isVisibleTo(reader: AuditReader, record: AuditRecord): boolean {
  switch (reader.role) {
    case 'chair':
      return true;
    case 'member':
      return reader.districtId !== undefined && record.districtId === reader.districtId;
    default:
      return isActionOf(reader, record) || (record.subjectPersonIds ?? []).includes(reader.personId);
  }
}

function isActionOf(reader: AuditReader, record: AuditRecord): boolean {
  return record.actor.kind === 'person' && record.actor.personId === reader.personId;
}
