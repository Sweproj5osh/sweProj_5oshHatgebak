import { randomUUID } from 'node:crypto';
import { respond, type HttpResponse } from '../shared/operation-contract';

export const INTERNAL_ERROR = 'internal error';

/**
 * A handler that threw was rolled back; what it threw stays on the server. The client gets a plain message and a
 * correlation id, and the server log gets the same id with the cause, so an operator can join the two without the
 * client ever seeing a host name, a query or a secret.
 */
export function internalFailure(operationName: string, error: unknown): HttpResponse {
  const correlationId = randomUUID();
  console.error(`[${correlationId}] ${operationName} failed and was rolled back: ${describe(error)}`);
  return respond(500, { error: INTERNAL_ERROR, correlationId });
}

function describe(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
