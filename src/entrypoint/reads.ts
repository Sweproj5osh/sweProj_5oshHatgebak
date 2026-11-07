import type { Actor } from '../shared/identifiers';
import type { HttpResponse, ReadOperation } from '../shared/operation-contract';
import type { TableAccess } from '../shared/unit-of-work';
import { runAudited } from './audited-execution';
import type { HttpRequest } from './http';
import { admitRequestId } from './intake';
import type { UnitOfWorkResourcesFactory } from './unit-of-work-resources';

export interface ReadDependencies {
  /** The committed tables, for reads outside any unit of work. */
  readonly database: TableAccess;
  readonly resources: UnitOfWorkResourcesFactory;
}

/** A plain read answers from the committed tables; a logged read (P9) goes through the audited unit of work. */
export async function handleRead(
  operation: ReadOperation,
  request: HttpRequest,
  actor: Actor,
  dependencies: ReadDependencies,
): Promise<HttpResponse> {
  if (operation.logged === true) {
    return handleLoggedRead(operation, request, actor, dependencies.resources);
  }
  const outcome = await operation.handle({ actor, query: request.query, database: dependencies.database });
  return outcome.response;
}

/**
 * Rule F's "role-checked, logged join": request id → the handler inside a unit of work → one redacted audit entry
 * holding the operation, the actor, the request id, the query and the subject the handler names → commit.
 */
async function handleLoggedRead(
  operation: ReadOperation,
  request: HttpRequest,
  actor: Actor,
  resources: UnitOfWorkResourcesFactory,
): Promise<HttpResponse> {
  const requestId = admitRequestId(request, 'a logged read');
  if (!requestId.ok) {
    return requestId.error;
  }
  return runAudited(
    {
      operationName: operation.name,
      actor: { kind: 'person', personId: actor.personId, role: actor.role },
      requestId: requestId.value,
      input: request.query,
      redaction: operation.audit,
      run: (unitOfWork) => operation.handle({ actor, query: request.query, database: unitOfWork.transaction }),
    },
    resources,
  );
}
