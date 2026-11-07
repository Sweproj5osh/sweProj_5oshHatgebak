import type { Operation, ReadOperation } from '../../../shared/operation-contract';
import { respond } from '../../../shared/operation-contract';
import type { AuditTrail } from '../public';

export interface AuditLogOperationsDependencies {
  /** The audit trail read outside any transaction. */
  readonly audit: AuditTrail;
}

/** The two reads this module exposes through the entry point: the log by the reader's scope, and the chain check. */
export function auditLogOperations(dependencies: AuditLogOperationsDependencies): readonly Operation[] {
  return [readAuditLogByScope(dependencies.audit), verifyAuditChain(dependencies.audit)];
}

function readAuditLogByScope(audit: AuditTrail): ReadOperation {
  return {
    kind: 'read',
    name: 'audit.readByScope',
    method: 'GET',
    path: '/audit-log',
    allowedRoles: ['attendant', 'inspector', 'member', 'chair'],
    async handle(context) {
      return respond(200, { entries: await audit.readByScope(context.actor) });
    },
  };
}

function verifyAuditChain(audit: AuditTrail): ReadOperation {
  return {
    kind: 'read',
    name: 'audit.verifyChain',
    method: 'GET',
    path: '/audit-log/verification',
    allowedRoles: ['chair'],
    async handle() {
      return respond(200, { chainIntact: await audit.verifyChain() });
    },
  };
}
