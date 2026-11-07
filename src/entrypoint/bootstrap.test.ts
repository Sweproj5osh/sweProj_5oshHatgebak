import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_CHAIR_NAME_VARIABLE, BOOTSTRAP_CHAIR_PHONE_VARIABLE } from './bootstrap';
import { composeInMemoryServer } from './composition';
import { TEST_TOKEN_SECRET } from './test-helpers';

const configured = { [BOOTSTRAP_CHAIR_PHONE_VARIABLE]: '01000000001', [BOOTSTRAP_CHAIR_NAME_VARIABLE]: 'First Chair' };
const asChair = { personId: 'reader', role: 'chair' as const };

describe('bootstrapping the first Chair (Q2)', () => {
  it('with an empty store and both variables set: one Chair exists and one audit entry names the system as the actor', async () => {
    const server = composeInMemoryServer({ tokenSecret: TEST_TOKEN_SECRET });
    const outcome = await server.bootstrapFirstChair(configured);
    expect(outcome.kind).toBe('bootstrapped');
    const chairId = outcome.kind === 'bootstrapped' ? outcome.chairId : '';
    expect(await server.accounts.authorization.roleOf(chairId)).toBe('chair');
    expect(await server.accounts.authorization.liveStatus(chairId)).toBe('active');
    const entries = await server.audit.readByScope(asChair);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorKind: 'system', operation: 'accounts.bootstrapChair', subjectPersonIds: [chairId], input: {} });
    expect(JSON.stringify(entries[0])).not.toContain('01000000001');
    expect(JSON.stringify(entries[0])).not.toContain('First Chair');
  });

  it('with a store that already holds people: nothing happens, no second Chair, no second entry', async () => {
    const server = composeInMemoryServer({ tokenSecret: TEST_TOKEN_SECRET });
    await server.bootstrapFirstChair(configured);
    const again = await server.bootstrapFirstChair({ ...configured, [BOOTSTRAP_CHAIR_PHONE_VARIABLE]: '01000000009' });
    expect(again.kind).toBe('already bootstrapped');
    expect(await server.audit.readByScope(asChair)).toHaveLength(1);
    expect(await server.accounts.personalData.createPerson('self registration', 'driver', '01000000009', 'Someone')).toMatchObject({ ok: true });
  });

  it('without the variables: nothing happens and the server says so', async () => {
    const server = composeInMemoryServer({ tokenSecret: TEST_TOKEN_SECRET });
    expect(await server.bootstrapFirstChair({})).toEqual({ kind: 'not configured' });
    expect(await server.audit.readByScope(asChair)).toHaveLength(0);
  });
});
