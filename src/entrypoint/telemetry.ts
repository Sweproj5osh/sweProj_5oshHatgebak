import type { Actor } from '../shared/identifiers';
import { refuse, respond, type HttpResponse, type TelemetryOperation } from '../shared/operation-contract';
import type { RateLimiter } from '../shared/rate-limiter';
import type { HttpRequest } from './http';
import { internalFailure } from './internal-failure';
import { TELEMETRY_READINGS_PER_PERSON, TOO_MANY_ATTEMPTS } from './rate-limits';
import type { UnitOfWorkResourcesFactory } from './unit-of-work-resources';
import { admitBody } from './intake';

export interface TelemetryDependencies {
  readonly resources: UnitOfWorkResourcesFactory;
  readonly rateLimiter: RateLimiter;
}

/**
 * A measurement (P7): server clock rule → body schema → rate limit → the module's handler inside a unit of work that
 * commits without an audit entry or an event. The answer is 204 with no body. A reading refused for its body does not
 * use up the person's one slot per minute.
 */
export async function handleTelemetry(
  operation: TelemetryOperation,
  request: HttpRequest,
  actor: Actor,
  dependencies: TelemetryDependencies,
): Promise<HttpResponse> {
  const body = admitBody(request, operation.bodySchema);
  if (!body.ok) {
    return body.error;
  }
  const key = `telemetry/${operation.name}/person/${actor.personId}`;
  if ((await dependencies.rateLimiter.attempt(key, TELEMETRY_READINGS_PER_PERSON)) === 'over limit') {
    return refuse(429, TOO_MANY_ATTEMPTS);
  }
  const { transaction } = dependencies.resources.begin();
  try {
    await operation.handle({ actor, body: body.value, transaction });
    await transaction.commit();
    return respond(204, undefined);
  } catch (error) {
    await transaction.rollback();
    return internalFailure(operation.name, error);
  }
}
