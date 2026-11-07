/**
 * Reading the server's JSON answer into the fields a screen shows. An answer that lacks a field the operation file
 * promises is a fault, never silently defaulted: the server is the only truth (Rule G), so the app must not invent one.
 */
export type ServerAnswer = Readonly<Record<string, unknown>>;

export class MalformedServerAnswerError extends Error {
  constructor(field: string) {
    super(`server answer missing ${field}`);
    this.name = 'MalformedServerAnswerError';
  }
}

export function asRecord(value: unknown): ServerAnswer {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as ServerAnswer;
  }
  return {};
}

export function requiredRecord(answer: ServerAnswer, field: string): ServerAnswer {
  const value = answer[field];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new MalformedServerAnswerError(field);
  }
  return value as ServerAnswer;
}

export function requiredList(answer: ServerAnswer, field: string): readonly unknown[] {
  const value = answer[field];
  if (!Array.isArray(value)) {
    throw new MalformedServerAnswerError(field);
  }
  return value;
}

export function requiredString(answer: ServerAnswer, field: string): string {
  const value = answer[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new MalformedServerAnswerError(field);
  }
  return value;
}

export function optionalString(answer: ServerAnswer, field: string): string | undefined {
  return answer[field] === undefined ? undefined : requiredString(answer, field);
}

export function requiredNumber(answer: ServerAnswer, field: string): number {
  const value = answer[field];
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new MalformedServerAnswerError(field);
  }
  return value;
}

export function optionalNumber(answer: ServerAnswer, field: string): number | undefined {
  return answer[field] === undefined ? undefined : requiredNumber(answer, field);
}

/** A number the server may answer as null when its source did not answer (the first-hour fee on the map). */
export function nullableNumber(answer: ServerAnswer, field: string): number | null {
  return answer[field] === null ? null : requiredNumber(answer, field);
}

export function requiredBoolean(answer: ServerAnswer, field: string): boolean {
  const value = answer[field];
  if (typeof value !== 'boolean') {
    throw new MalformedServerAnswerError(field);
  }
  return value;
}

/** A word from a closed set the owner's operation file declares; any other word is a fault, not a new meaning. */
export function requiredWord<Word extends string>(answer: ServerAnswer, field: string, words: readonly Word[]): Word {
  const value = answer[field];
  if (typeof value !== 'string' || !(words as readonly string[]).includes(value)) {
    throw new MalformedServerAnswerError(field);
  }
  return value as Word;
}
