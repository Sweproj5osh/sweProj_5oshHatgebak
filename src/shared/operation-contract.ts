/**
 * The contract between a module's operations and the single entry point (P5). It lives here, outside the entry
 * point, so that modules depend on it without depending on the pipeline that runs them: the entry point imports the
 * modules, never the reverse (fitness function F2).
 */
import type { BodySchema, ValidBody } from './body-schema';
import type { EventPublisher } from './events/event';
import type { Actor, DistrictId, PersonId, Role } from './identifiers';
import type { RequestId } from './request-id';
import type { TableAccess, Transaction } from './unit-of-work';

/** Plain data crossing the boundary between the HTTP adapter and the pipeline. No framework types. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export function respond(status: number, body: unknown): HttpResponse {
  return { status, body };
}

export function refuse(status: number, message: string, details?: unknown): HttpResponse {
  return respond(status, details === undefined ? { error: message } : { error: message, details });
}

/**
 * One operation = one route + the roles allowed + a handler. Module owners register their operations through their
 * module's `operations(dependencies)` export; the pipeline does the token, permission, request-id, clock and repeat
 * checks before the handler runs.
 */
export interface ReadContext {
  readonly actor: Actor;
  readonly query: Readonly<Record<string, string>>;
}

/**
 * A write handler never calls the audit log itself. The pipeline appends exactly one entry per successful write
 * (ARCHITECTURE_RULES.md section 8) inside the same unit of work; the handler only adds the detail the pipeline
 * cannot know.
 */
export interface WriteContext {
  readonly actor: Actor;
  readonly requestId: RequestId;
  readonly body: ValidBody;
  /** The unit of work: the module's own tables, the audit entry and the events commit or roll back together (ADR-13). */
  readonly transaction: Transaction;
  readonly events: EventPublisher;
}

/**
 * What the one audit entry may never carry (P2, ADR-14): `omit` drops a body field; `replace` drops a body field and
 * writes, under the given name, the reference the handler returned in `AuditDetail.references`. For example
 * `{ replace: { plate: 'carRef' } }` drops `plate` and writes `carRef` in its place. Fitness function F12 fails any
 * schema with a personal field that neither rule covers.
 */
export interface AuditRedaction {
  readonly omit?: readonly string[];
  readonly replace?: Readonly<Record<string, string>>;
}

/** What the handler adds to the one audit entry the pipeline writes. */
export interface AuditDetail {
  readonly reason?: string;
  readonly approverId?: PersonId;
  /** The district the action belongs to; members read their district's entries. */
  readonly districtId?: DistrictId;
  /** People the action is about (for example the attendant whose licence changed); they read entries naming them. */
  readonly subjectPersonIds?: readonly PersonId[];
  /** The references that stand in for redacted body fields, by the name the operation's `audit.replace` rule gives. */
  readonly references?: Readonly<Record<string, string>>;
}

export interface WriteOutcome {
  readonly response: HttpResponse;
  readonly audit?: AuditDetail;
}

export interface OperationBase {
  readonly name: string;
  readonly path: string;
  readonly allowedRoles: readonly Role[];
}

export interface ReadOperation extends OperationBase {
  readonly kind: 'read';
  readonly method: 'GET';
  handle(context: ReadContext): Promise<HttpResponse>;
}

export interface WriteOperation extends OperationBase {
  readonly kind: 'write';
  readonly method: Exclude<HttpMethod, 'GET'>;
  readonly bodySchema: BodySchema;
  readonly audit?: AuditRedaction;
  /** Sample bodies for the audit-coverage harness (F5): one that passes validation, one that does not. */
  readonly examples: { readonly valid: ValidBody; readonly invalid: unknown };
  /** Seeds whatever rows `examples.valid` needs to succeed; the F5 harness runs it before the sample request. */
  fixture?(database: TableAccess): Promise<void>;
  handle(context: WriteContext): Promise<WriteOutcome>;
}

export type Operation = ReadOperation | WriteOperation;
