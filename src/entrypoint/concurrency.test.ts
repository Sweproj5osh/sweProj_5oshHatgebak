import { describe, expect, it } from 'vitest';
import { testApplication, writeRequest } from './test-helpers';

const approval = { approvalRequestId: 'request-1', reason: 'Within budget' };
const asChair = () => ({ personId: 'chair-1', role: 'chair' as const });

describe('concurrent writes through the entry point (integrity, rank 1)', () => {
  it('50 parallel writes give audit ids 1..50 and an intact chain', async () => {
    const { handle, audit } = testApplication();
    const responses = await Promise.all(
      Array.from({ length: 50 }, (_unused, index) => handle(writeRequest('/example/approvals', 'chair', `parallel-request-${index}`, approval))),
    );
    expect(responses.every((response) => response.status === 201)).toBe(true);
    const rows = await audit.readByScope(asChair());
    expect(rows.map((row) => row.id).sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_unused, index) => index + 1));
    expect(new Set(rows.map((row) => row.prevHash)).size).toBe(50);
    expect(await audit.verifyChain()).toBe(true);
  });

  it('two concurrent sends of one request id give identical bodies, one audit entry and one event (Rule H)', async () => {
    const { handle, audit, outbox } = testApplication();
    const request = writeRequest('/example/approvals', 'chair', 'same-request-id-0001', approval);
    const [first, second] = await Promise.all([handle(request), handle(request)]);
    expect(first.status).toBe(201);
    expect(second).toEqual(first);
    expect(await audit.readByScope(asChair())).toHaveLength(1);
    expect(outbox.allEvents()).toHaveLength(1);
  });
});
