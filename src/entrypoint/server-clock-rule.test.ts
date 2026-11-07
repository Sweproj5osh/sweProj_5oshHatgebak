import { describe, expect, it } from 'vitest';
import { respond, type WriteOperation } from '../shared/operation-contract';
import { TIMESTAMPS_ARE_SET_BY_THE_SERVER } from './handle-request';
import { testApplication, writeRequest } from './test-helpers';

/** A write whose schema declares a time-named field as a plain number: the server clock rule must still refuse it (Rule I). */
const declaresAnEpoch: WriteOperation = {
  kind: 'write',
  name: 'test.declaresAnEpoch',
  method: 'POST',
  path: '/test/epochs',
  allowedRoles: ['chair'],
  bodySchema: { fields: { created_at: 'number', PAID_AT: 'number', paidAt: 'number' } },
  examples: { valid: { created_at: 1, PAID_AT: 1, paidAt: 1 }, invalid: {} },
  async handle() {
    return { response: respond(201, {}) };
  },
};

describe('server clock rule through the entry point (Rule I)', () => {
  it.each([
    { name: 'created_at', body: { created_at: 1762538400, PAID_AT: 0, paidAt: 0 } },
    { name: 'PAID_AT', body: { created_at: 0, PAID_AT: 1762538400000, paidAt: 0 } },
    { name: 'paidAt', body: { created_at: 0, PAID_AT: 0, paidAt: 1762538400 } },
  ])('refuses an epoch number under the declared numeric field $name', async ({ body, name }) => {
    const { handle, audit } = testApplication({ additionalOperations: [declaresAnEpoch] });
    const response = await handle(writeRequest('/test/epochs', 'chair', 'request-0001', body));
    expect(response.status).toBe(400);
    expect((response.body as { error: string; details: { fields: string[] } }).error).toBe(TIMESTAMPS_ARE_SET_BY_THE_SERVER);
    expect((response.body as { details: { fields: string[] } }).details.fields).toContain(name);
    expect(await audit.readByScope({ personId: 'chair-1', role: 'chair' })).toHaveLength(0);
  });
});
