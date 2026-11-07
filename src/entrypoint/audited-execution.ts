import type { AuditActor, AuditEntry } from '../modules/audit-log/public';
import type { AuditRedaction, HttpResponse, WriteOutcome } from '../shared/operation-contract';
import type { RequestId } from '../shared/request-id';
import { redactForAudit, type AuditInput } from './audit-redaction';
import { internalFailure } from './internal-failure';
import type { UnitOfWorkResources, UnitOfWorkResourcesFactory } from './unit-of-work-resources';

/** One action that changes state and must leave exactly one audit entry: a write, a public write, a logged read. */
export interface AuditedExecution {
  readonly operationName: string;
  readonly actor: AuditActor;
  readonly requestId: RequestId;
  readonly input: AuditInput;
  readonly redaction: AuditRedaction | undefined;
  run(resources: UnitOfWorkResources): Promise<WriteOutcome>;
}

/**
 * The handler runs, then the pipeline appends the one redacted audit entry, then everything commits. A refusal
 * (status 400 or above) or a thrown error rolls the unit of work back, so a failed action leaves no entry and no event.
 */
export async function runAudited(execution: AuditedExecution, factory: UnitOfWorkResourcesFactory): Promise<HttpResponse> {
  const resources = factory.begin();
  try {
    const outcome = await execution.run(resources);
    return await settle(execution, outcome, resources);
  } catch (error) {
    await resources.transaction.rollback();
    return internalFailure(execution.operationName, error);
  }
}

async function settle(execution: AuditedExecution, outcome: WriteOutcome, resources: UnitOfWorkResources): Promise<HttpResponse> {
  if (outcome.response.status >= 400) {
    await resources.transaction.rollback();
    return outcome.response;
  }
  await resources.audit.append(auditEntryFor(execution, outcome));
  await resources.transaction.commit();
  return outcome.response;
}

function auditEntryFor(execution: AuditedExecution, outcome: WriteOutcome): AuditEntry {
  const { references, ...detail } = outcome.audit ?? {};
  return {
    actor: execution.actor,
    operation: execution.operationName,
    input: redactForAudit(execution.operationName, execution.input, execution.redaction, references),
    requestId: execution.requestId,
    ...detail,
  };
}
