import type { Actor } from '../shared/identifiers';
import { refuse, type HttpResponse, type RoleGuardedOperation } from '../shared/operation-contract';
import type { PermissionTable } from './auth/permission-table';
import { verifyToken } from './auth/token';
import type { HttpRequest } from './http';
import type { OperationRegistry } from './operations/registry';
import { handleRead, type ReadDependencies } from './reads';
import { handleTelemetry } from './telemetry';
import { handlePublicWrite, handleWrite, type WriteDependencies } from './writes';

export interface RequestHandlerDependencies extends WriteDependencies, ReadDependencies {
  readonly registry: OperationRegistry;
  readonly permissions: PermissionTable;
  readonly tokenSecret: string;
}

export type RequestHandler = (request: HttpRequest) => Promise<HttpResponse>;

export { TIMESTAMPS_ARE_SET_BY_THE_SERVER } from './intake';

/**
 * The single entry point. Every request passes, in order: route → token → permission table → the operation's own
 * pipeline (writes: request id → server clock rule → body schema → repeat check → the module, inside one unit of work).
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
    const actor = authenticate(request, dependencies.tokenSecret);
    if (!actor.ok) {
      return refuse(401, actor.error);
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

function authenticate(request: HttpRequest, secret: string) {
  const header = request.headers['authorization'];
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : header;
  return verifyToken(token, secret);
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
