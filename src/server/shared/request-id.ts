/** The client-generated id that makes a write repeatable (ADR-08, Rule H). */
export type RequestId = string;

export const REQUEST_ID_HEADER = 'x-request-id';

const WELL_FORMED_REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;

export function isWellFormedRequestId(candidate: unknown): candidate is RequestId {
  return typeof candidate === 'string' && WELL_FORMED_REQUEST_ID.test(candidate);
}
