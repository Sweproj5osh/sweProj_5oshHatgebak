import type { AuditEntry } from '../modules/audit-log/public';
import type { Actor } from '../shared/identifiers';
import { isWellFormedRequestId, REQUEST_ID_HEADER, type RequestId } from '../shared/request-id';
import { findTimestampFields } from '../shared/timestamp-fields';
import type { PermissionTable } from './auth/permission-table';
import { verifyToken } from './auth/token';
import { validateBody } from '../shared/body-schema';
import { refuse, type HttpResponse, type Operation, type ReadOperation, type WriteOperation, type WriteOutcome } from '../shared/operation-contract';
import { redactForAudit } from './audit-redaction';
import type { HttpRequest } from './http';
import type { OperationRegistry } from './operations/registry';
import { responseKeyFor, type ResponseStore } from './repeatable-writes/response-store';
import type { WriteResources, WriteResourcesFactory } from './write-resources';

export interface RequestHandlerDependencies {
  readonly registry: OperationRegistry;
  readonly permissions: PermissionTable;
  readonly tokenSecret: string;
  readonly writeResources: WriteResourcesFactory;
  readonly responses: ResponseStore;
}

export type RequestHandler = (request: HttpRequest) => Promise<HttpResponse>;

export const TIMESTAMPS_ARE_SET_BY_THE_SERVER = 'timestamps are set by the server';

/**
 * The single entry point. Every request passes, in order: route → token → permission table → (writes only)
 * request id → server clock rule → body schema → repeat check → the module, inside one unit of work.
 * Only a committed write's response is stored for repeats: a refusal or a rolled-back failure is re-evaluated when
 * the client retries, so a transient failure never becomes permanent.
 */
export function createRequestHandler(dependencies: RequestHandlerDependencies): RequestHandler {
  return async (request) => {
    const operation = dependencies.registry.find(request.method, request.path);
    if (operation === undefined) {
      return refuse(404, `no operation at ${request.method} ${request.path}`);
    }
    const actor = authenticate(request, dependencies.tokenSecret);
    if (!actor.ok) {
      return refuse(401, actor.error);
    }
    if (!dependencies.permissions.allows(actor.value.role, operation.name)) {
      return refuse(403, `role ${actor.value.role} may not call ${operation.name}`);
    }
    return dispatch(operation, request, actor.value, dependencies);
  };
}

function authenticate(request: HttpRequest, secret: string) {
  const header = request.headers['authorization'];
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : header;
  return verifyToken(token, secret);
}

function dispatch(
  operation: Operation,
  request: HttpRequest,
  actor: Actor,
  dependencies: RequestHandlerDependencies,
): Promise<HttpResponse> {
  if (operation.kind === 'read') {
    return handleRead(operation, request, actor);
  }
  return handleWrite(operation, request, actor, dependencies);
}

function handleRead(operation: ReadOperation, request: HttpRequest, actor: Actor): Promise<HttpResponse> {
  return operation.handle({ actor, query: request.query });
}

async function handleWrite(
  operation: WriteOperation,
  request: HttpRequest,
  actor: Actor,
  dependencies: RequestHandlerDependencies,
): Promise<HttpResponse> {
  const requestId = request.headers[REQUEST_ID_HEADER];
  if (!isWellFormedRequestId(requestId)) {
    return refuse(400, `every write needs a well-formed ${REQUEST_ID_HEADER} header (8 to 128 letters, digits, - or _)`);
  }
  const timestampFields = findTimestampFields(request.body);
  if (timestampFields.length > 0) {
    return refuse(400, TIMESTAMPS_ARE_SET_BY_THE_SERVER, { fields: timestampFields });
  }
  const body = validateBody(operation.bodySchema, request.body);
  if (!body.ok) {
    return refuse(400, 'body does not match the operation schema', { problems: body.error });
  }
  const responseKey = responseKeyFor(actor.personId, requestId);
  const earlier = await dependencies.responses.find(responseKey);
  if (earlier !== undefined) {
    return earlier;
  }
  const response = await executeInUnitOfWork(operation, { actor, requestId, body: body.value }, dependencies);
  if (response.status < 400) {
    await dependencies.responses.save(responseKey, response);
  }
  return response;
}

interface WriteInput {
  readonly actor: Actor;
  readonly requestId: RequestId;
  readonly body: Readonly<Record<string, unknown>>;
}

/**
 * The handler runs, then the pipeline appends the one audit entry, then everything commits. A refusal (status 400 or
 * above) or a thrown error rolls the unit of work back, so a failed write leaves no entry and no event.
 */
async function executeInUnitOfWork(
  operation: WriteOperation,
  input: WriteInput,
  dependencies: RequestHandlerDependencies,
): Promise<HttpResponse> {
  const resources = dependencies.writeResources.begin();
  try {
    const outcome = await operation.handle({ ...input, transaction: resources.transaction, events: resources.events });
    return await settle(operation, input, outcome, resources);
  } catch (error) {
    await resources.transaction.rollback();
    return refuse(500, `${operation.name} failed and was rolled back`, { cause: describe(error) });
  }
}

async function settle(
  operation: WriteOperation,
  input: WriteInput,
  outcome: WriteOutcome,
  resources: WriteResources,
): Promise<HttpResponse> {
  if (outcome.response.status >= 400) {
    await resources.transaction.rollback();
    return outcome.response;
  }
  await resources.audit.append(auditEntryFor(operation, input, outcome));
  await resources.transaction.commit();
  return outcome.response;
}

function auditEntryFor(operation: WriteOperation, input: WriteInput, outcome: WriteOutcome): AuditEntry {
  const { references, ...detail } = outcome.audit ?? {};
  return {
    personId: input.actor.personId,
    role: input.actor.role,
    operation: operation.name,
    input: redactForAudit(operation.name, input.body, operation.audit, references),
    requestId: input.requestId,
    ...detail,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
