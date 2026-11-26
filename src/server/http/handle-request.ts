import type { Actor } from '../shared/identifiers';
import { refuse, type HttpResponse, type Operation, type RoleGuardedOperation } from '../shared/operation-contract';
import { authenticate, type AuthenticationDependencies } from './auth/authenticate';
import type { PermissionTable } from './auth/permission-table';
import type { HttpRequest } from './http';
import type { OperationRegistry } from './registry';
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
 * The single entry point. Every request passes, in order: token and expiry → live status → route → permission table
 * → the path's values joined to the input (ADR-22) → the operation's own pipeline (writes: request id → server clock rule → body schema → repeat check → the module, inside one unit of work).
 * The token comes before the route, so an unknown path answers 401 without a token and the route table is not
 * discoverable. A public operation has no token and no permission row; the rate limits stand in for them (ADR-15).
 */
export function createRequestHandler(dependencies: RequestHandlerDependencies): RequestHandler {
  return async (request) => {
    const route = dependencies.registry.match(request.method, request.path);
    const operation = route?.operation;
    if (operation?.kind === 'public') {
      return withPathParameters(operation, request, route?.pathParameters ?? {}, (routed) => handlePublicWrite(operation, routed, dependencies));
    }
    const actor = await authenticate(request, dependencies);
    if (!actor.ok) {
      return actor.error;
    }
    if (operation === undefined) {
      return refuse(404, `no operation at ${request.method} ${request.path}`);
    }
    if (!isPermitted(operation, actor.value, dependencies.permissions)) {
      return refuse(403, `role ${actor.value.role} may not call ${operation.name}`);
    }
    return withPathParameters(operation, request, route?.pathParameters ?? {}, (routed) => dispatch(operation, routed, actor.value, dependencies));
  };
}

export const PATH_VALUE_REPEATED_DIFFERENTLY = 'the request repeats a field the path names, with another value';

/**
 * ADR-22: the values a route's path names (`/tickets/:ticketId/closure`) join the input the operation always took, the
 * query of a read and the body of every other kind, before any check reads it. The server-clock rule, the schema, the
 * body hash, the repeat check, the read scope and the audit entry therefore see exactly the input they saw when the id
 * travelled in the body or the query. The body or query may repeat a path field with the same value; another value is
 * refused. A body that is not an object is left as it is, for the schema check to refuse.
 */
function withPathParameters(
  operation: Operation,
  request: HttpRequest,
  pathParameters: Readonly<Record<string, string>>,
  continueWith: (routed: HttpRequest) => Promise<HttpResponse>,
): Promise<HttpResponse> {
  const names = Object.keys(pathParameters);
  if (names.length === 0) {
    return continueWith(request);
  }
  const input: unknown = operation.kind === 'read' ? request.query : (request.body ?? {});
  if (!isPlainObject(input)) {
    return continueWith(request);
  }
  const repeatedDifferently = names.filter((name) => input[name] !== undefined && input[name] !== pathParameters[name]);
  if (repeatedDifferently.length > 0) {
    return Promise.resolve(refuse(400, PATH_VALUE_REPEATED_DIFFERENTLY, { fields: repeatedDifferently }));
  }
  const merged = { ...pathParameters, ...input };
  return continueWith(operation.kind === 'read' ? { ...request, query: merged as Record<string, string> } : { ...request, body: merged });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
