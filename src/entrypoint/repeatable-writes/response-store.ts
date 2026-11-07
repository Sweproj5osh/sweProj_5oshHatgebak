import { createHash } from 'node:crypto';
import { canonicalJson } from '../../shared/canonical-json';
import type { HttpResponse } from '../../shared/operation-contract';
import type { RequestId } from '../../shared/request-id';

/** The first response of a write beside the hash of the body that produced it, so a reused id with other content is caught (P19). */
export interface StoredResponse {
  readonly response: HttpResponse;
  readonly bodyHash: string;
}

/** The first response of every committed write, keyed by owner (person or address) and request id (Rule H). */
export interface ResponseStore {
  find(responseKey: string): Promise<StoredResponse | undefined>;
  save(responseKey: string, stored: StoredResponse): Promise<void>;
}

export function responseKeyFor(owner: string, requestId: RequestId): string {
  return `${owner}/${requestId}`;
}

/** SHA-256 of the canonical JSON, so the same content in another key order hashes the same. */
export function bodyHashOf(body: unknown): string {
  return createHash('sha256').update(canonicalJson(body ?? null)).digest('hex');
}
