import type { AuditEntry, AuditTrail } from '../../modules/audit-log/public';
import type { EventPublisher } from '../../shared/events/event';
import type { Actor, Role } from '../../shared/identifiers';
import type { RequestId } from '../../shared/request-id';
import type { UnitOfWork } from '../../shared/unit-of-work';
import type { HttpMethod, HttpResponse } from '../http';
import type { BodySchema, ValidBody } from './body-schema';

/**
 * One operation = one route + the roles allowed + a handler. Module owners register their operations here; the
 * pipeline does the token, permission, request-id, clock and repeat checks before the handler runs.
 */
export interface ReadContext {
  readonly actor: Actor;
  readonly query: Readonly<Record<string, string>>;
  readonly audit: AuditTrail;
}

/**
 * A write handler never calls the audit log itself. The pipeline appends exactly one entry per successful write
 * (Rule 3) inside the same unit of work; the handler only adds the detail the pipeline cannot know.
 */
export interface WriteContext {
  readonly actor: Actor;
  readonly requestId: RequestId;
  readonly body: ValidBody;
  readonly transaction: UnitOfWork;
  readonly events: EventPublisher;
}

export type AuditDetail = Pick<AuditEntry, 'reason' | 'approverId' | 'districtId' | 'subjectPersonIds'>;

export interface WriteOutcome {
  readonly response: HttpResponse;
  readonly audit?: AuditDetail;
}

interface OperationBase {
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
  /** Sample bodies for the audit-coverage harness (F5): one that passes validation, one that does not. */
  readonly examples: { readonly valid: ValidBody; readonly invalid: unknown };
  handle(context: WriteContext): Promise<WriteOutcome>;
}

export type Operation = ReadOperation | WriteOperation;
