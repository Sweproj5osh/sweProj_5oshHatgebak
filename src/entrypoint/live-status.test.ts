import { describe, expect, it } from 'vitest';
import { FixedClock } from '../shared/clock';
import { respond, type ReadOperation } from '../shared/operation-contract';
import type { AccessChecks } from './auth/access-checks';
import { issueToken, STAFF_TOKEN_LIFETIME_MILLISECONDS } from './auth/token';
import { EVERYONE_IS_LIVE } from './auth/access-checks';
import { composeInMemoryServer } from './composition';
import type { HttpRequest } from './http';
import { readRequest, TEST_TOKEN_SECRET, testApplication, tokenFor, writeRequest } from './test-helpers';

const chairApproval = { approvalRequestId: 'request-1', reason: 'Within budget' };

const whoAmI: ReadOperation = {
  kind: 'read',
  name: 'test.whoAmI',
  method: 'GET',
  path: '/who-am-i',
  allowedRoles: ['attendant'],
  scope: 'own',
  async handle(context) {
    return { response: respond(200, context.actor) };
  },
};

function withToken(request: HttpRequest, token: string): HttpRequest {
  return { ...request, headers: { ...request.headers, authorization: `Bearer ${token}` } };
}

describe('live status on every request (P26 Q4)', () => {
  it('refuses a correctly signed token for a person the accounts module does not know', async () => {
    const { handle, audit } = composeInMemoryServer({ tokenSecret: TEST_TOKEN_SECRET });
    const response = await handle(writeRequest('/example/approvals', 'chair', 'request-0001', chairApproval));
    expect(response.status).toBe(403);
    expect((response.body as { error: string }).error).toContain('revoked');
    expect(await audit.readByScope({ personId: 'chair-1', role: 'chair' })).toHaveLength(0);
  });

  it('admits the bootstrapped Chair through the real accounts module', async () => {
    const { handle, accounts } = composeInMemoryServer({ tokenSecret: TEST_TOKEN_SECRET });
    const chair = await accounts.bootstrapChair('01001234567', 'The Chair');
    if (!chair.ok) {
      throw new Error(`could not bootstrap the Chair: ${chair.error}`);
    }
    const token = issueToken({ personId: chair.value, role: 'chair' }, TEST_TOKEN_SECRET, new Date());
    const request = withToken(writeRequest('/example/approvals', 'chair', 'request-0001', chairApproval), token);
    expect((await handle(request)).status).toBe(201);
  });

  it.each(['suspended', 'revoked'] as const)('refuses a %s account with 403 before any module runs', async (status) => {
    const checks: AccessChecks = { ...EVERYONE_IS_LIVE, liveStatus: async () => status };
    const { handle, audit } = testApplication({ accessChecks: checks });
    const response = await handle(writeRequest('/example/approvals', 'chair', 'request-0001', chairApproval));
    expect(response).toEqual({ status: 403, body: { error: `account is ${status}` } });
    expect(await audit.readByScope({ personId: 'chair-1', role: 'chair' })).toHaveLength(0);
  });

  it('attaches the site the session is bound to, so a module can compare sites', async () => {
    const checks: AccessChecks = { ...EVERYONE_IS_LIVE, boundSite: async (personId) => (personId === 'attendant-1' ? 'site-9' : undefined) };
    const { handle } = testApplication({ accessChecks: checks, additionalOperations: [whoAmI] });
    const response = await handle(readRequest('/who-am-i', tokenFor('attendant')));
    expect(response.body).toEqual({ personId: 'attendant-1', role: 'attendant', boundSiteId: 'site-9' });
  });

  it('refuses an expired token with 401', async () => {
    const issuedAt = new Date('2026-11-07T08:00:00Z');
    const clock = new FixedClock(new Date(issuedAt.getTime() + STAFF_TOKEN_LIFETIME_MILLISECONDS + 1));
    const { handle } = testApplication({ clock, additionalOperations: [whoAmI] });
    const token = issueToken({ personId: 'attendant-1', role: 'attendant' }, TEST_TOKEN_SECRET, issuedAt);
    const response = await handle(readRequest('/who-am-i', token));
    expect(response).toEqual({ status: 401, body: { error: 'expired token' } });
  });
});
