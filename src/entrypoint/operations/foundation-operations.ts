import { respond } from '../http';
import type { Operation, ReadOperation, WriteContext, WriteOperation } from './operation';

/**
 * The foundation's own operations. The two audit reads are real. The five example writes, one per role, exist so
 * that the entry-point, repeatable-write and audit-coverage tests mean something before the module owners register
 * their real operations; each one publishes one event and returns its audit detail, nothing more.
 */
export const readAuditLogByScope: ReadOperation = {
  kind: 'read',
  name: 'audit.readByScope',
  method: 'GET',
  path: '/audit-log',
  allowedRoles: ['attendant', 'inspector', 'member', 'chair'],
  async handle(context) {
    return respond(200, { entries: await context.audit.readByScope(context.actor) });
  },
};

export const verifyAuditChain: ReadOperation = {
  kind: 'read',
  name: 'audit.verifyChain',
  method: 'GET',
  path: '/audit-log/verification',
  allowedRoles: ['chair'],
  async handle(context) {
    return respond(200, { chainIntact: await context.audit.verifyChain() });
  },
};

export const exampleDriverOpensTicket = exampleWrite({
  name: 'example.driver.openTicket',
  path: '/example/tickets',
  allowedRoles: ['driver'],
  fields: { siteId: 'string', entryCode: 'string' },
  validBody: { siteId: 'site-1', entryCode: 'ENTRY-1' },
  eventTopic: 'ExampleTicketOpened',
});

export const exampleAttendantTicksCash = exampleWrite({
  name: 'example.attendant.tickCash',
  path: '/example/cash-ticks',
  allowedRoles: ['attendant'],
  fields: { ticketId: 'string' },
  validBody: { ticketId: 'ticket-1' },
  eventTopic: 'ExampleCashTicked',
});

export const exampleInspectorConfirmsDeposit = exampleWrite({
  name: 'example.inspector.confirmDeposit',
  path: '/example/deposit-confirmations',
  allowedRoles: ['inspector'],
  fields: { depositId: 'string' },
  validBody: { depositId: 'deposit-1' },
  eventTopic: 'ExampleDepositConfirmed',
});

export const exampleMemberFilesRequest = exampleWrite({
  name: 'example.member.fileRequest',
  path: '/example/requests',
  allowedRoles: ['member'],
  fields: { kind: 'string', reason: 'string' },
  validBody: { kind: 'price change', reason: 'Prices unchanged since 2024' },
  eventTopic: 'ExampleRequestAwaitingChair',
});

export const exampleChairApprovesRequest = exampleWrite({
  name: 'example.chair.approveRequest',
  path: '/example/approvals',
  allowedRoles: ['chair'],
  fields: { approvalRequestId: 'string', reason: 'string' },
  validBody: { approvalRequestId: 'request-1', reason: 'Within the committee budget' },
  eventTopic: 'ExampleRequestApproved',
});

export const foundationOperations: readonly Operation[] = [
  readAuditLogByScope,
  verifyAuditChain,
  exampleDriverOpensTicket,
  exampleAttendantTicksCash,
  exampleInspectorConfirmsDeposit,
  exampleMemberFilesRequest,
  exampleChairApprovesRequest,
];

interface ExampleWriteSpec {
  readonly name: string;
  readonly path: string;
  readonly allowedRoles: WriteOperation['allowedRoles'];
  readonly fields: WriteOperation['bodySchema']['fields'];
  readonly validBody: WriteOperation['examples']['valid'];
  readonly eventTopic: string;
}

function exampleWrite(spec: ExampleWriteSpec): WriteOperation {
  return {
    kind: 'write',
    name: spec.name,
    method: 'POST',
    path: spec.path,
    allowedRoles: spec.allowedRoles,
    bodySchema: { fields: spec.fields },
    examples: { valid: spec.validBody, invalid: {} },
    async handle(context: WriteContext) {
      context.events.publish({ topic: spec.eventTopic, payload: context.body });
      const reason = context.body['reason'];
      return {
        response: respond(201, { operation: spec.name, requestId: context.requestId }),
        audit: typeof reason === 'string' ? { reason } : {},
      };
    },
  };
}
