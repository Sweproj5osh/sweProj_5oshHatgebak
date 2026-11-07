import { fail, succeed, type Result } from './result';

/**
 * The declared shape of a request body. Deliberately no instant or timestamp kind exists: the server is the only
 * clock (ADR-08, Rule I). The one calendar kind, `localDateTime`, is allowed only on committee operations (P6), and
 * fitness function F11 scans these schemas for both rules.
 */
export type ScalarKind = 'string' | 'number' | 'boolean';
export type ListElementKind = ScalarKind | 'point';
export type FieldKind = ScalarKind | 'localDateTime' | { readonly list: ListElementKind };

export const LOCAL_DATE_TIME_KIND = 'localDateTime';

export interface BodySchema {
  readonly fields: Readonly<Record<string, FieldKind>>;
}

export type ValidBody = Readonly<Record<string, unknown>>;

/** A place on the map: two numbers, nothing else. */
export interface Point {
  readonly latitude: number;
  readonly longitude: number;
}

/** A calendar time in Cairo local time as the committee writes it: no seconds, no zone (P6). */
export interface LocalDateTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

const POINT_PROBLEM = 'must be a point: { latitude, longitude } numbers within -90..90 and -180..180';
const LOCAL_DATE_TIME_PROBLEM = `must be a ${LOCAL_DATE_TIME_KIND}: { year, month, day, hour, minute } integers in Cairo local time`;

export function validateBody(schema: BodySchema, body: unknown): Result<ValidBody, string[]> {
  if (!isPlainObject(body)) {
    return fail(['body must be a JSON object']);
  }
  const problems = [...declaredFieldProblems(schema, body), ...unknownFields(schema, body)];
  return problems.length === 0 ? succeed(body) : fail(problems);
}

function declaredFieldProblems(schema: BodySchema, body: Record<string, unknown>): string[] {
  return Object.entries(schema.fields).flatMap(([field, kind]) => {
    const value = body[field];
    if (value === undefined) {
      return [`field "${field}" is required`];
    }
    return problemsWith(field, kind, value);
  });
}

function unknownFields(schema: BodySchema, body: Record<string, unknown>): string[] {
  return Object.keys(body)
    .filter((field) => !(field in schema.fields))
    .map((field) => `field "${field}" is not part of this operation`);
}

function problemsWith(field: string, kind: FieldKind, value: unknown): string[] {
  if (typeof kind === 'object') {
    return listProblems(field, kind.list, value);
  }
  const problem = kind === LOCAL_DATE_TIME_KIND ? localDateTimeProblem(value) : scalarProblem(kind, value);
  return problem === undefined ? [] : [`field "${field}" ${problem}`];
}

function listProblems(field: string, elementKind: ListElementKind, value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [`field "${field}" must be a list of ${elementKind}`];
  }
  return value.flatMap((element, index) => {
    const problem = elementKind === 'point' ? pointProblem(element) : scalarProblem(elementKind, element);
    return problem === undefined ? [] : [`field "${field}[${index}]" ${problem}`];
  });
}

function scalarProblem(kind: ScalarKind, value: unknown): string | undefined {
  return typeof value === kind ? undefined : `must be a ${kind}`;
}

function pointProblem(value: unknown): string | undefined {
  return isPoint(value) ? undefined : POINT_PROBLEM;
}

function localDateTimeProblem(value: unknown): string | undefined {
  return isLocalDateTime(value) ? undefined : LOCAL_DATE_TIME_PROBLEM;
}

export function isPoint(value: unknown): value is Point {
  return (
    hasExactlyKeys(value, ['latitude', 'longitude']) &&
    isNumberWithin(value['latitude'], -90, 90) &&
    isNumberWithin(value['longitude'], -180, 180)
  );
}

export function isLocalDateTime(value: unknown): value is LocalDateTime {
  return (
    hasExactlyKeys(value, ['year', 'month', 'day', 'hour', 'minute']) &&
    isIntegerWithin(value['year'], 1, 9999) &&
    isIntegerWithin(value['month'], 1, 12) &&
    isIntegerWithin(value['day'], 1, 31) &&
    isIntegerWithin(value['hour'], 0, 23) &&
    isIntegerWithin(value['minute'], 0, 59)
  );
}

function hasExactlyKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isPlainObject(value)) {
    return false;
  }
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => key in value);
}

function isNumberWithin(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isIntegerWithin(value: unknown, minimum: number, maximum: number): boolean {
  return Number.isInteger(value) && isNumberWithin(value, minimum, maximum);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
