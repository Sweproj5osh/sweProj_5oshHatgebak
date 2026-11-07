import type { Actor } from '../shared/identifiers';
import { refuse, type HttpResponse, type RoleGuardedOperation } from '../shared/operation-contract';
import { authenticate, type AuthenticationDependencies } from './auth/authenticate';
import type { PermissionTable } from './auth/permission-table';
import type { HttpRequest } from './http';
import type { OperationRegistry } from './operations/registry';
import { handleRead, type ReadDependencies } from './reads';
import { handleTelemetry } from './telemetry';
import { handlePublicWrite, handleWrite, type WriteDependencies } from './writes';

export interface RequestHandlerDependencies extends WriteDependencies, ReadDependencies, AuthenticationDependencies {
  readonly registry: OperationRegistry;
  readonly permissions: PermissionTable;
}

export type RequestHandler = (request: HttpRequest) => Promise<HttpResponse>;

export { REQUEST_ID_REUSED_WITH_DIFFERENT_CONTENT, TIMESTAMPS_ARE_SET_BY_THE_SERVER } from './intake';

/**
 * The single entry point. Every request passes, in order: route → token and expiry → live status → permission table
 * → the operation's own pipeline (writes: request id → server clock rule → body schema → repeat check → the module, inside one unit of work).
 * A public operation has no token and no permission row; the rate limits stand in for them (ADR-15).
 */
export function createRequestHandler(dependencies: RequestHandlerDependencies): RequestHandler {
  return async (request) => {
    const operation = dependencies.registry.find(request.method, request.path);
    if (operation === undefined) {
      return refuse(404, `no operation at ${request.method} ${request.path}`);
    }
    if (operation.kind === 'public') {
      return handlePublicWrite(operation, request, dependencies);
    }
    const actor = await authenticate(request, dependencies);
    if (!actor.ok) {
      return actor.error;
    }
    if (!isPermitted(operation, actor.value, dependencies.permissions)) {
      return refuse(403, `role ${actor.value.role} may not call ${operation.name}`);
    }
    return dispatch(operation, request, actor.value, dependencies);
  };
}

/** An open read (P10) needs only a valid token; every other operation needs its row in the permission table. */
function isPermitted(operation: RoleGuardedOperation, actor: Actor, permissions: PermissionTable): boolean {
  if (operation.kind === 'read' && operation.scope === 'open') {
    return true;
  }
  return permissions.allows(actor.role, operation.name);
}

function dispatch(
  operation: RoleGuardedOperation,
  request: HttpRequest,
  actor: Actor,
  dependencies: RequestHandlerDependencies,
): Promise<HttpResponse> {
  switch (operation.kind) {
    case 'read':
      return handleRead(operation, request, actor, dependencies);
    case 'telemetry':
      return handleTelemetry(operation, request, actor, dependencies);
    case 'write':
      return handleWrite(operation, request, actor, dependencies);
  }
}
