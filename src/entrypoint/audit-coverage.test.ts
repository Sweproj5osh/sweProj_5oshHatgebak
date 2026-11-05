import { describe, expect, it } from 'vitest';
import { composeInMemoryApplication } from './composition';
import { TEST_TOKEN_SECRET, writeRequest } from './test-helpers';

/**
 * Fitness function F5 (task Z9): every registered write operation leaves exactly one audit row when called with a
 * valid payload and zero rows when called with an invalid one. Owners register their operations; this harness grows.
 */
describe('F5 audit coverage over every registered write operation', () => {
  const { registry } = composeInMemoryApplication({ tokenSecret: TEST_TOKEN_SECRET });
  const writes = registry.writes();

  it('has at least one write operation registered', () => {
    expect(writes.length).toBeGreaterThan(0);
    console.log(`Z9 report: operations covered ${writes.length} / ${writes.length}`);
  });

  for (const operation of writes) {
    const role = operation.allowedRoles[0];
    if (role === undefined) {
      throw new Error(`${operation.name} allows no role, so nobody can ever call it`);
    }

    it(`${operation.name}: a valid payload leaves exactly one audit row`, async () => {
      const { handle, audit } = composeInMemoryApplication({ tokenSecret: TEST_TOKEN_SECRET });
      const response = await handle(writeRequest(operation.path, role, 'request-valid-1', operation.examples.valid));
      expect(response.status).toBeLessThan(400);
      const rows = await audit.readByScope({ personId: 'chair-1', role: 'chair' });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.operation).toBe(operation.name);
    });

    it(`${operation.name}: an invalid payload leaves zero audit rows`, async () => {
      const { handle, audit } = composeInMemoryApplication({ tokenSecret: TEST_TOKEN_SECRET });
      const response = await handle(writeRequest(operation.path, role, 'request-invalid-1', operation.examples.invalid));
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await audit.readByScope({ personId: 'chair-1', role: 'chair' })).toHaveLength(0);
    });
  }
});
