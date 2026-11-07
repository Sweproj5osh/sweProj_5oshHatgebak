import { fieldNamesOf, loadComposedOperations, type DeclaredOperation } from './support/composed-operations';
import { defineFitnessFunction } from './support/fitness-result';
import { runWhenInvokedDirectly } from './support/run-as-script';

/** The words that name personal data in a body field, matched case-insensitively as a whole word or a word part. */
export const PERSONAL_FIELD_WORDS: readonly string[] = ['plate', 'phone', 'name', 'password', 'latitude', 'longitude'];

/** A measurement leaves no audit entry at all (P7), so there is nothing for a redaction rule to redact. */
const TELEMETRY_KIND = 'telemetry';

/**
 * F12: every personal field of a write or public schema is covered by an `audit.omit` or `audit.replace` rule, so the
 * hash-chained log never keeps a plate, phone, name, password or coordinate for ever (P2, ADR-14, Rule F).
 */
export const f12PersonalFieldsHaveARedactionRule = defineFitnessFunction(
  'F12',
  'every personal field in a write schema has a redaction rule',
  async (repositoryRoot) => {
    const writes = (await loadComposedOperations(repositoryRoot)).filter(
      (operation) => operation.bodySchema !== undefined && operation.kind !== TELEMETRY_KIND,
    );
    const violations = writes.flatMap((write) =>
      fieldNamesOf(write)
        .filter((field) => namesPersonalData(field) && !isRedacted(write, field))
        .map((field) => `${write.name} declares the personal field "${field}" with no audit.omit or audit.replace rule covering it`),
    );
    const checked = writes.reduce((count, write) => count + fieldNamesOf(write).length, 0);
    return { violations, checked };
  },
);

export function namesPersonalData(fieldName: string): boolean {
  const lowered = fieldName.toLowerCase();
  const words = fieldName.split(/[_\s]+|(?<=[a-z0-9])(?=[A-Z])/).map((word) => word.toLowerCase());
  return PERSONAL_FIELD_WORDS.some(
    (word) => words.includes(word) || lowered.startsWith(word) || lowered.endsWith(word),
  );
}

function isRedacted(operation: DeclaredOperation, field: string): boolean {
  const omitted = operation.audit?.omit ?? [];
  const replaced = Object.keys(operation.audit?.replace ?? {});
  return omitted.includes(field) || replaced.includes(field);
}

runWhenInvokedDirectly(import.meta.url, f12PersonalFieldsHaveARedactionRule);
