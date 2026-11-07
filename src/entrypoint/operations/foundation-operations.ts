import type { Operation, WriteContext, WriteOperation } from '../../shared/operation-contract';
import { respond } from '../../shared/operation-contract';

/**
 * The foundation's own operations: five example writes, one per role. They exist so that the entry-point,
 * repeatable-write and audit-coverage tests mean something before the module owners register their real operations;
 * each one writes one row through the unit of work, publishes one event and returns its audit detail, nothing more.
 */
export const EXAMPLE_ACTIONS_TABLE = 'foundation_example_actions';

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
      await context.transaction.insert(EXAMPLE_ACTIONS_TABLE, context.requestId, { operation: spec.name, ...context.body });
      context.events.publish({ topic: spec.eventTopic, payload: context.body });
      const reason = context.body['reason'];
      return {
        response: respond(201, { operation: spec.name, requestId: context.requestId }),
        audit: typeof reason === 'string' ? { reason } : {},
      };
    },
  };
}
