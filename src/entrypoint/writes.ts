import type { ValidBody } from '../shared/body-schema';
import type { Actor } from '../shared/identifiers';
import type { KeyedSerialQueue } from '../shared/keyed-serial-queue';
import { refuse, type HttpResponse, type PublicWriteOperation, type WriteOperation } from '../shared/operation-contract';
import type { RateLimiter, RateLimitVerdict } from '../shared/rate-limiter';
import type { RequestId } from '../shared/request-id';
import { runAudited } from './audited-execution';
import type { HttpRequest } from './http';
import { admitRequestId, admitWrite, rememberIfCommitted } from './intake';
import { PUBLIC_ATTEMPTS_PER_ADDRESS, PUBLIC_ATTEMPTS_PER_KEY, TOO_MANY_ATTEMPTS } from './rate-limits';
import { responseKeyFor, type ResponseStore } from './repeatable-writes/response-store';
import type { UnitOfWorkResourcesFactory } from './unit-of-work-resources';

export interface WriteDependencies {
  readonly resources: UnitOfWorkResourcesFactory;
  readonly responses: ResponseStore;
  /**
   * One lock per response key (owner + request id), held from the repeat lookup to the store of the response, so two
   * concurrent sends of one id commit once and the second receives the stored answer (Rule H). Per process; across
   * server copies the UNIQUE (request_id) constraint of the owning table is the second guard (P19).
   */
  readonly writeLocks: KeyedSerialQueue;
  readonly rateLimiter: RateLimiter;
}

/** A signed-in person's write: repeats are keyed by person and request id (Rule H). */
export async function handleWrite(
  operation: WriteOperation,
  request: HttpRequest,
  actor: Actor,
  dependencies: WriteDependencies,
): Promise<HttpResponse> {
  const requestId = admitRequestId(request, 'every write');
  if (!requestId.ok) {
    return requestId.error;
  }
  const responseKey = responseKeyFor(actor.personId, requestId.value);
  return dependencies.writeLocks.run(responseKey, () => performWrite(operation, request, actor, requestId.value, responseKey, dependencies));
}

async function performWrite(
  operation: WriteOperation,
  request: HttpRequest,
  actor: Actor,
  requestId: RequestId,
  responseKey: string,
  dependencies: WriteDependencies,
): Promise<HttpResponse> {
  const admitted = await admitWrite(request, requestId, operation.bodySchema, responseKey, dependencies.responses);
  if (!admitted.ok) {
    return admitted.error;
  }
  const { body } = admitted.value;
  const response = await runAudited(
    {
      operationName: operation.name,
      actor: { kind: 'person', personId: actor.personId, role: actor.role },
      requestId,
      input: body,
      redaction: operation.audit,
      run: (resources) => operation.handle({ actor, requestId, body, transaction: resources.transaction, events: resources.events }),
    },
    dependencies.resources,
  );
  return rememberIfCommitted(admitted.value, response, dependencies.responses);
}

/** An anonymous caller's write (ADR-15): repeats are keyed by address and request id; the rate limits apply first. */
export async function handlePublicWrite(
  operation: PublicWriteOperation,
  request: HttpRequest,
  dependencies: WriteDependencies,
): Promise<HttpResponse> {
  const address = request.address;
  if (address === undefined) {
    return refuse(400, 'the client address is unknown, so this public operation cannot be rate-limited');
  }
  const requestId = admitRequestId(request, 'every write');
  if (!requestId.ok) {
    return requestId.error;
  }
  const responseKey = responseKeyFor(address, requestId.value);
  return dependencies.writeLocks.run(responseKey, () => performPublicWrite(operation, request, address, requestId.value, responseKey, dependencies));
}

async function performPublicWrite(
  operation: PublicWriteOperation,
  request: HttpRequest,
  address: string,
  requestId: RequestId,
  responseKey: string,
  dependencies: WriteDependencies,
): Promise<HttpResponse> {
  const admitted = await admitWrite(request, requestId, operation.bodySchema, responseKey, dependencies.responses);
  if (!admitted.ok) {
    return admitted.error;
  }
  const { body } = admitted.value;
  if ((await publicRateLimitVerdict(operation, address, body, dependencies.rateLimiter)) === 'over limit') {
    return refuse(429, TOO_MANY_ATTEMPTS);
  }
  const response = await runAudited(
    {
      operationName: operation.name,
      actor: { kind: 'anonymous', address },
      requestId,
      input: body,
      redaction: operation.audit,
      run: (resources) =>
        operation.handle({ address, requestId, body, transaction: resources.transaction, events: resources.events }),
    },
    dependencies.resources,
  );
  return rememberIfCommitted(admitted.value, response, dependencies.responses);
}

async function publicRateLimitVerdict(
  operation: PublicWriteOperation,
  address: string,
  body: ValidBody,
  limiter: RateLimiter,
): Promise<RateLimitVerdict> {
  const byAddress = await limiter.attempt(`public/address/${address}`, PUBLIC_ATTEMPTS_PER_ADDRESS);
  if (byAddress === 'over limit' || operation.rateLimitKey === undefined) {
    return byAddress;
  }
  return limiter.attempt(`public/${operation.rateLimitKey}/${String(body[operation.rateLimitKey])}`, PUBLIC_ATTEMPTS_PER_KEY);
}
