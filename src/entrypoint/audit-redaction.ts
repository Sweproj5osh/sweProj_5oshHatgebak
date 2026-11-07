import type { AuditRedaction } from '../shared/operation-contract';

export type AuditInput = Readonly<Record<string, unknown>>;

/**
 * Applies an operation's declared redaction before the audit entry is written (P2, ADR-14), so that the stored entry
 * never contains the omitted value. A `replace` rule whose reference the handler did not return is a programming error
 * and throws, which rolls the write back: an entry with the personal value in it is never written by accident.
 */
export function redactForAudit(
  operationName: string,
  input: AuditInput,
  rule: AuditRedaction | undefined,
  references: Readonly<Record<string, string>> | undefined,
): AuditInput {
  if (rule === undefined) {
    return input;
  }
  const dropped = new Set([...(rule.omit ?? []), ...Object.keys(rule.replace ?? {})]);
  const kept = Object.fromEntries(Object.entries(input).filter(([field]) => !dropped.has(field)));
  return { ...kept, ...replacements(operationName, rule.replace ?? {}, references ?? {}) };
}

function replacements(
  operationName: string,
  replace: Readonly<Record<string, string>>,
  references: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(replace).map(([field, referenceName]) => {
      const reference = references[referenceName];
      if (reference === undefined) {
        throw new Error(
          `${operationName} declares audit.replace ${field} -> ${referenceName}, but its handler returned no "${referenceName}" in audit.references`,
        );
      }
      return [referenceName, reference];
    }),
  );
}
