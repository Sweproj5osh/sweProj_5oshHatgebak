import { describe, expect, it } from 'vitest';
import { FixedClock } from '../shared/clock';
import { REQUEST_ID_HEADER } from '../shared/request-id';
import { REQUEST_ID_REUSED_WITH_DIFFERENT_CONTENT, TIMESTAMPS_ARE_SET_BY_THE_SERVER } from './handle-request';
import { requiresARole, respond, type WriteOperation } from '../shared/operation-contract';
import { readRequest, TEST_ADDRESS, testApplication, tokenFor, writeRequest } from './test-helpers';

function application() {
  return testApplication({ clock: new FixedClock(new Date('2026-11-04T10:00:00Z')),
  });
}

const chairApproval = { approvalRequestId: 'request-1', reason: 'Within budget' };

function auditedWriteInDistrict(path: string, districtId: string): WriteOperation {
  return {
    kind: 'write',
    name: `test.actIn.${districtId}`,
    method: 'POST',
    path,
    allowedRoles: ['chair'],
    bodySchema: { fields: {} },
    examples: { valid: {}, invalid: [] },
    async handle() {
      return { response: respond(201, {}), audit: { districtId } };
    },
  };
}

describe('entry point: token and permission table (Z4)', () => {
  it('refuses a request without a token with 401', async () => {
    const { handle } = application();
    const started = performance.now();
    const response = await handle({ method: 'POST', path: '/example/approvals', query: {}, headers: {}, address: TEST_ADDRESS, body: chairApproval });
    console.log(`Z4 report: refused-request latency ${(performance.now() - started).toFixed(2)} ms`);
    expect(response.status).toBe(401);
  });

  it('refuses a forged token with 401', async () => {
    const { handle } = application();
    const response = await handle({
      method: 'POST',
      path: '/example/approvals',
      query: {},
      headers: { authorization: 'Bearer forged.token' },
      address: TEST_ADDRESS,
      body: chairApproval,
    });
    expect(response.status).toBe(401);
  });

  it('refuses an attendant calling a committee operation with 403 before any module runs', async () => {
    const { handle, audit } = application();
    const response = await handle(writeRequest('/example/approvals', 'attendant', 'request-0001', chairApproval));
    expect(response.status).toBe(403);
    expect(await audit.readByScope({ personId: 'chair-1', role: 'chair' })).toHaveLength(0);
  });

  it('lets the Chair through to the module', async () => {
    const { handle } = application();
    const response = await handle(writeRequest('/example/approvals', 'chair', 'request-0001', chairApproval));
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ operation: 'example.chair.approveRequest', requestId: 'request-0001' });
  });

  it('answers 404 for an unknown route only to a valid token', async () => {
    const { handle } = application();
    const response = await handle(readRequest('/nowhere', tokenFor('chair')));
    expect(response.status).toBe(404);
  });

  it('checks the token before the route: an unknown route without a token is 401, so the route table is not discoverable', async () => {
    const { handle } = application();
    const response = await handle({ method: 'GET', path: '/does-not-exist', query: {}, headers: {}, address: TEST_ADDRESS });
    expect(response.status).toBe(401);
  });

  it('holds one row per registered operation in the permission table, and none for the public ones (ADR-15)', () => {
    const { permissions, registry } = application();
    expect(permissions.operationCount()).toBe(registry.all().filter(requiresARole).length);
    console.log(`Z4 report: permission table holds ${permissions.operationCount()} operations`);
  });

  it('serves the audit log read by the scope of the token', async () => {
    const { handle } = application();
    await handle(writeRequest('/example/approvals', 'chair', 'request-0001', chairApproval));
    await handle(writeRequest('/example/cash-ticks', 'attendant', 'request-0002', { ticketId: 't-1' }));

    const asChair = await handle(readRequest('/audit-log', tokenFor('chair')));
    const asAttendant = await handle(readRequest('/audit-log', tokenFor('attendant')));
    const asDriver = await handle(readRequest('/audit-log', tokenFor('driver')));

    expect((asChair.body as { entries: unknown[] }).entries).toHaveLength(2);
    expect((asAttendant.body as { entries: unknown[] }).entries).toHaveLength(1);
    expect(asDriver.status).toBe(403);
  });

  it('takes a member\'s district from the signed token only, never from the query string', async () => {
    const districtOne = testApplication({ additionalOperations: [
        auditedWriteInDistrict('/district-one-action', 'district-1'),
        auditedWriteInDistrict('/district-two-action', 'district-2'),
      ],
    });
    await districtOne.handle(writeRequest('/district-one-action', 'chair', 'request-0001', {}));
    await districtOne.handle(writeRequest('/district-two-action', 'chair', 'request-0002', {}));

    const memberOfDistrictOne = tokenFor('member', { districtId: 'district-1' });
    const response = await districtOne.handle(readRequest('/audit-log', memberOfDistrictOne, { districtId: 'district-2' }));

    const entries = (response.body as { entries: { districtId: string }[] }).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.districtId).toBe('district-1');
  });
});

describe('entry point: repeatable writes (Z5)', () => {
  it('refuses a write without a request id', async () => {
    const { handle } = application();
    const response = await handle({
      method: 'POST',
      path: '/example/approvals',
      query: {},
      headers: { authorization: `Bearer ${tokenFor('chair')}` },
      address: TEST_ADDRESS,
      body: chairApproval,
    });
    expect(response.status).toBe(400);
    expect(String((response.body as { error: string }).error)).toContain(REQUEST_ID_HEADER);
  });

  it('returns the identical stored response on a repeat and changes state once', async () => {
    const { handle, audit, outbox } = application();
    const first = await handle(writeRequest('/example/approvals', 'chair', 'request-0001', chairApproval));
    const second = await handle(writeRequest('/example/approvals', 'chair', 'request-0001', chairApproval));

    expect(first.status).toBe(201);
    expect(second).toEqual(first);
    expect(await audit.readByScope({ personId: 'chair-1', role: 'chair' })).toHaveLength(1);
    expect(outbox.allEvents()).toHaveLength(1);
  });

  it('does not store a rolled-back failure: the same request id succeeds on retry and changes state once', async () => {
    let attempts = 0;
    const { handle, audit } = testApplication({ additionalOperations: [
        {
          kind: 'write',
          name: 'test.failsOnce',
          method: 'POST',
          path: '/fails-once',
          allowedRoles: ['chair'],
          bodySchema: { fields: {} },
          examples: { valid: {}, invalid: [] },
          async handle() {
            attempts += 1;
            if (attempts === 1) {
              throw new Error('database connection dropped');
            }
            return { response: respond(201, { attempts }) };
          },
        },
      ],
    });
    const first = await handle(writeRequest('/fails-once', 'chair', 'request-0001', {}));
    const second = await handle(writeRequest('/fails-once', 'chair', 'request-0001', {}));
    const third = await handle(writeRequest('/fails-once', 'chair', 'request-0001', {}));

    expect(first.status).toBe(500);
    expect(second.status).toBe(201);
    expect(third).toEqual(second);
    expect(attempts).toBe(2);
    expect(await audit.readByScope({ personId: 'chair-1', role: 'chair' })).toHaveLength(1);
  });

  it('refuses the same request id with a different body with 409 and writes nothing (P19)', async () => {
    const { handle, audit, outbox } = application();
    const first = await handle(writeRequest('/example/approvals', 'chair', 'request-0001', chairApproval));
    const reused = await handle(writeRequest('/example/approvals', 'chair', 'request-0001', { ...chairApproval, reason: 'Changed my mind' }));
    expect(first.status).toBe(201);
    expect(reused).toEqual({ status: 409, body: { error: REQUEST_ID_REUSED_WITH_DIFFERENT_CONTENT } });
    expect(await audit.readByScope({ personId: 'chair-1', role: 'chair' })).toHaveLength(1);
    expect(outbox.allEvents()).toHaveLength(1);
  });

  it('treats the same body with its keys in another order as the same content', async () => {
    const { handle } = application();
    const first = await handle(writeRequest('/example/approvals', 'chair', 'request-0001', { approvalRequestId: 'request-1', reason: 'Within budget' }));
    const reordered = await handle(writeRequest('/example/approvals', 'chair', 'request-0001', { reason: 'Within budget', approvalRequestId: 'request-1' }));
    expect(reordered).toEqual(first);
  });

  it('treats a different request id as a new write', async () => {
    const { handle, audit } = application();
    await handle(writeRequest('/example/approvals', 'chair', 'request-0001', chairApproval));
    await handle(writeRequest('/example/approvals', 'chair', 'request-0002', chairApproval));
    expect(await audit.readByScope({ personId: 'chair-1', role: 'chair' })).toHaveLength(2);
  });
});

describe('entry point: server clock rule (Z6)', () => {
  it.each([
    { reason: 'key ending in At', body: { ...chairApproval, approvedAt: 1 } },
    { reason: 'key ending in time', body: { ...chairApproval, entryTime: '10:00' } },
    { reason: 'key ending in date', body: { ...chairApproval, startDate: 'tomorrow' } },
    { reason: 'ISO-8601 value', body: { ...chairApproval, reason: '2026-11-04T10:00:00Z' } },
    { reason: 'nested timestamp', body: { ...chairApproval, extra: { closedAt: 1 } } },
  ])('rejects a body with a $reason with 400 "timestamps are set by the server"', async ({ body }) => {
    const { handle, audit } = application();
    const response = await handle(writeRequest('/example/approvals', 'chair', 'request-0001', body));
    expect(response.status).toBe(400);
    expect((response.body as { error: string }).error).toBe(TIMESTAMPS_ARE_SET_BY_THE_SERVER);
    expect(await audit.readByScope({ personId: 'chair-1', role: 'chair' })).toHaveLength(0);
  });
});

describe('entry point: audit entry and events commit together', () => {
  it('records exactly one audit entry and one event for a successful write', async () => {
    const { handle, audit, outbox } = application();
    await handle(writeRequest('/example/requests', 'member', 'request-0001', { kind: 'price change', reason: 'Old prices' }));
    const [entry] = await audit.readByScope({ personId: 'chair-1', role: 'chair' });
    expect(entry).toMatchObject({
      personId: 'member-1',
      role: 'member',
      operation: 'example.member.fileRequest',
      requestId: 'request-0001',
      reason: 'Old prices',
      input: { kind: 'price change', reason: 'Old prices' },
    });
    expect(outbox.allEvents()).toHaveLength(1);
    expect(await audit.verifyChain()).toBe(true);
  });

  it('rolls everything back when the handler throws', async () => {
    const { handle, audit, outbox } = testApplication({ additionalOperations: [
        {
          kind: 'write',
          name: 'test.explodes',
          method: 'POST',
          path: '/explode',
          allowedRoles: ['chair'],
          bodySchema: { fields: {} },
          examples: { valid: {}, invalid: [] },
          async handle(context) {
            context.events.publish({ topic: 'NeverDelivered', payload: {} });
            throw new Error('database unreachable');
          },
        },
      ],
    });
    const response = await handle(writeRequest('/explode', 'chair', 'request-0001', {}));
    expect(response.status).toBe(500);
    expect(await audit.readByScope({ personId: 'chair-1', role: 'chair' })).toHaveLength(0);
    expect(outbox.allEvents()).toHaveLength(0);
  });
});
