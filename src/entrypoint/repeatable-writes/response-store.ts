import type { PersonId } from '../../shared/identifiers';
import type { RequestId } from '../../shared/request-id';
import type { HttpResponse } from '../http';

export type StoredResponse = HttpResponse;

/** The first response of every write, keyed by person and request id, so a repeat returns the same answer (Rule H). */
export interface ResponseStore {
  find(responseKey: string): Promise<StoredResponse | undefined>;
  save(responseKey: string, response: StoredResponse): Promise<void>;
}

export function responseKeyFor(personId: PersonId, requestId: RequestId): string {
  return `${personId}/${requestId}`;
}
