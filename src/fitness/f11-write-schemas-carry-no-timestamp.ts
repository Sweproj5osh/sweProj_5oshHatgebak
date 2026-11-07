import { LOCAL_DATE_TIME_KIND } from '../shared/body-schema';
import { COMMITTEE_ROLES } from '../shared/identifiers';
import { looksLikeTimestampKey } from '../shared/timestamp-fields';
import { fieldNamesOf, loadComposedOperations, type DeclaredOperation } from './support/composed-operations';
import { defineFitnessFunction } from './support/fitness-result';
import { runWhenInvokedDirectly } from './support/run-as-script';

/**
 * F11 (ADR-08, Rule I, P6): no declared body schema in the composed registry has a field whose name looks like a
 * timestamp, and a `localDateTime` field appears only on operations whose roles are all committee roles. A field
 * declared `localDateTime` is exempt from the name rule (Q7): its kind already says what it is and the committee rule
 * already fences it, so `closedFrom: 'localDateTime'` and `startDate: 'localDateTime'` pass while `startDate: 'number'`
 * still fails.
 */
export const f11WriteSchemasCarryNoTimestamp = defineFitnessFunction(
  'F11',
  'no write schema field is a timestamp; localDateTime only on committee operations',
  async (repositoryRoot) => {
    const writes = (await loadComposedOperations(repositoryRoot)).filter(declaresABody);
    const violations = writes.flatMap((write) => [...timestampKeyViolations(write), ...calendarOutsideCommitteeViolations(write)]);
    const checked = writes.reduce((count, write) => count + fieldNamesOf(write).length, 0);
    return { violations, checked };
  },
);

function declaresABody(operation: DeclaredOperation): boolean {
  return operation.bodySchema !== undefined;
}

function timestampKeyViolations(write: DeclaredOperation): string[] {
  return Object.entries(write.bodySchema?.fields ?? {})
    .filter(([field, kind]) => kind !== LOCAL_DATE_TIME_KIND && looksLikeTimestampKey(field))
    .map(([field]) => `${write.name} declares the field "${field}", which looks like a timestamp`);
}

function calendarOutsideCommitteeViolations(write: DeclaredOperation): string[] {
  if (isCommitteeOnly(write)) {
    return [];
  }
  return Object.entries(write.bodySchema?.fields ?? {})
    .filter(([, kind]) => kind === LOCAL_DATE_TIME_KIND)
    .map(
      ([field]) =>
        `${write.name} declares the ${LOCAL_DATE_TIME_KIND} field "${field}", but only committee operations (roles ${COMMITTEE_ROLES.join(', ')}) may take a calendar time`,
    );
}

function isCommitteeOnly(write: DeclaredOperation): boolean {
  const roles = write.allowedRoles ?? [];
  return roles.length > 0 && roles.every((role) => (COMMITTEE_ROLES as readonly string[]).includes(role));
}

runWhenInvokedDirectly(import.meta.url, f11WriteSchemasCarryNoTimestamp);
