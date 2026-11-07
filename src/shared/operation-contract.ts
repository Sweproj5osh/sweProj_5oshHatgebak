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
 * One operation = one route + who may call it + a handler. Module owners register their operations through their
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

/** What a public operation receives: nobody is signed in, so the client address stands for the caller (ADR-15). */
export interface PublicWriteContext {
  readonly address: string;
  readonly requestId: RequestId;
  readonly body: ValidBody;
  readonly transaction: Transaction;
  readonly events: EventPublisher;
}

/** What a telemetry handler receives: the measurement goes into the owning module's tables and nowhere else (P7). */
export interface TelemetryContext {
  readonly actor: Actor;
  readonly body: ValidBody;
  readonly transaction: Transaction;
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

interface RouteBase {
  readonly name: string;
  readonly path: string;
}

export interface OperationBase extends RouteBase {
  readonly allowedRoles: readonly Role[];
}

/** What every operation that takes a body declares, so the pipeline validates it and the F5 harness can call it. */
export interface BodyDeclaration {
  readonly bodySchema: BodySchema;
  /** Sample bodies for the audit-coverage harness (F5): one that passes validation, one that does not. */
  readonly examples: { readonly valid: ValidBody; readonly invalid: unknown };
  /** Seeds whatever rows `examples.valid` needs to succeed; the F5 harness runs it before the sample request. */
  fixture?(database: TableAccess): Promise<void>;
}

export interface ReadOperation extends OperationBase {
  readonly kind: 'read';
  readonly method: 'GET';
  handle(context: ReadContext): Promise<HttpResponse>;
}

export interface WriteOperation extends OperationBase, BodyDeclaration {
  readonly kind: 'write';
  readonly method: Exclude<HttpMethod, 'GET'>;
  readonly audit?: AuditRedaction;
  handle(context: WriteContext): Promise<WriteOutcome>;
}

/**
 * A write accepted without a token (P3, ADR-15): request id, server-clock rule, body validation, unit of work,
 * redacted audit entry and events as for every write, plus the rate limits only this kind has. Fitness function F13
 * keeps the list of public operations at `requestSignInCode` and `signIn`.
 */
export interface PublicWriteOperation extends RouteBase, BodyDeclaration {
  readonly kind: 'public';
  readonly method: Exclude<HttpMethod, 'GET'>;
  readonly audit?: AuditRedaction;
  /** The body field whose value is rate-limited beside the client address (for sign-in: the phone). */
  readonly rateLimitKey?: string;
  handle(context: PublicWriteContext): Promise<WriteOutcome>;
}

/**
 * A measurement, not an action (P7): token checked, rate-limited to one reading per person per minute, body validated,
 * no request id, no audit entry, no event. The handler writes through the unit of work into its module's tables; the
 * answer is 204. The decision a measurement may lead to (an off-site flag) is an ordinary audited write.
 */
export interface TelemetryOperation extends OperationBase, BodyDeclaration {
  readonly kind: 'telemetry';
  readonly method: 'POST';
  handle(context: TelemetryContext): Promise<void>;
}

export type Operation = ReadOperation | WriteOperation | PublicWriteOperation | TelemetryOperation;

/** Every kind but `public` names the roles that may call it; the permission table holds exactly those. */
export type RoleGuardedOperation = Exclude<Operation, PublicWriteOperation>;

export function requiresARole(operation: Operation): operation is RoleGuardedOperation {
  return operation.kind !== 'public';
}
