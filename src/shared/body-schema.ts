import { fail, succeed, type Result } from './result';

/**
 * The declared shape of a write body. Deliberately no date or timestamp type exists: the server is the only clock
 * (ADR-08), and fitness function F11 scans these schemas.
 */
export type FieldType = 'string' | 'number' | 'boolean';

export interface BodySchema {
  readonly fields: Readonly<Record<string, FieldType>>;
}

export type ValidBody = Readonly<Record<string, unknown>>;

export function validateBody(schema: BodySchema, body: unknown): Result<ValidBody, string[]> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail(['body must be a JSON object']);
  }
  const candidate = body as Record<string, unknown>;
  const problems = [...missingOrMistypedFields(schema, candidate), ...unknownFields(schema, candidate)];
  return problems.length === 0 ? succeed(candidate) : fail(problems);
}

function missingOrMistypedFields(schema: BodySchema, body: Record<string, unknown>): string[] {
  return Object.entries(schema.fields).flatMap(([field, expectedType]) => {
    const value = body[field];
    if (value === undefined) {
      return [`field "${field}" is required`];
    }
    if (typeof value !== expectedType) {
      return [`field "${field}" must be a ${expectedType}`];
    }
    return [];
  });
}

function unknownFields(schema: BodySchema, body: Record<string, unknown>): string[] {
  return Object.keys(body)
    .filter((field) => !(field in schema.fields))
    .map((field) => `field "${field}" is not part of this operation`);
}
