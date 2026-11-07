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
  /** The tables to read: the committed rows for a plain read, the unit of work for a logged read (P9). */
  readonly database: TableAccess;
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

/** The handler's answer plus what it adds to the one audit entry; the same shape for writes and logged reads. */
export interface AuditedOutcome {
  readonly response: HttpResponse;
  readonly audit?: AuditDetail;
}

export type WriteOutcome = AuditedOutcome;
export type ReadOutcome = AuditedOutcome;

/** What a read declares about personal data (Rule F, P9), beside the redaction of the query it logs. */
export interface ReadAuditDeclaration extends AuditRedaction {
  /** True when the schema or the result names a person, a plate or a phone; such a read must be `logged` (F5). */
  readonly touchesPersonalData?: boolean;
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

/**
 * Who may read what (P10). `open`: any valid token, for site configuration that nothing personal lives in. `own`: the
 * role table applies and the handler answers from the actor's own records. `staff-scoped`: the role table applies and
 * then Authorization decides with the same scope ladder writes use (Chair everywhere, Member in the district,
 * Inspector in the zone, Attendant at the own site), for anything naming a person, a plate, a shift or money.
 */
export type ReadScope = 'open' | 'own' | 'staff-scoped';

/**
 * A read. When `logged` is true the pipeline requires a request id, opens a unit of work, runs the handler and writes
 * one redacted audit entry (operation, actor, request id, the subject the handler names), then commits (P9). Modules
 * never append entries themselves.
 */
export interface ReadOperation extends OperationBase {
  readonly kind: 'read';
  readonly method: 'GET';
  /** Absent means `own` (the role table alone), the behaviour reads had before P10; see QUESTIONS.md. */
  readonly scope?: ReadScope;
  readonly logged?: boolean;
  readonly audit?: ReadAuditDeclaration;
  /** A bare HttpResponse is still accepted from reads already on main; new reads return a ReadOutcome. */
  handle(context: ReadContext): Promise<ReadOutcome | HttpResponse>;
}

export function toReadOutcome(answer: ReadOutcome | HttpResponse): ReadOutcome {
  return 'status' in answer ? { response: answer } : answer;
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
