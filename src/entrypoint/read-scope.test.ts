import { describe, expect, it } from 'vitest';
import type { Scope } from '../modules/accounts-and-access-control/public';
import { ALL_ROLES, type PersonId } from '../shared/identifiers';
import { respond, type ReadOperation } from '../shared/operation-contract';
import type { AccessChecks } from './auth/access-checks';
import { readRequest, testApplication, tokenFor } from './test-helpers';

/** A stand-in for Lino's Authorization that remembers what it was asked and answers from one list. */
function accessChecksAllowing(...allowed: readonly PersonId[]) {
  const asked: { personId: PersonId; operation: string; scope: Scope }[] = [];
  const checks: AccessChecks = {
    async may(personId, operation, scope) {
      asked.push({ personId, operation, scope });
      return allowed.includes(personId);
    },
    async liveStatus() {
      return 'active';
    },
    async boundSite() {
      return undefined;
    },
  };
  return { checks, asked };
}

function read(name: string, path: string, scope: ReadOperation['scope'], allowedRoles: ReadOperation['allowedRoles']): ReadOperation {
  return {
    kind: 'read',
    name,
    method: 'GET',
    path,
    allowedRoles,
    scope,
    async handle(context) {
      return { response: respond(200, { seenBy: context.actor.personId }) };
    },
  };
}

const siteConfiguration = read('sites.isOpen', '/sites/open', 'open', ['chair']);
const ownTickets = read('tickets.mine', '/my/tickets', 'own', ['driver']);
const cashDue = read('payments.cashDue', '/cash-due', 'staff-scoped', ['attendant', 'inspector', 'member', 'chair']);

function application(checks: AccessChecks) {
  return testApplication({ accessChecks: checks,
    additionalOperations: [siteConfiguration, ownTickets, cashDue],
  });
}

describe('read scopes (P10)', () => {
  it('open: any valid token reaches the handler, whatever the roles declared', async () => {
    const { handle } = application(accessChecksAllowing().checks);
    for (const role of ALL_ROLES) {
      const response = await handle(readRequest('/sites/open', tokenFor(role)));
      expect(response, role).toEqual({ status: 200, body: { seenBy: `${role}-1` } });
    }
  });

  it('open: still refuses a missing or forged token', async () => {
    const { handle } = application(accessChecksAllowing().checks);
    expect((await handle({ ...readRequest('/sites/open', tokenFor('driver')), headers: {} })).status).toBe(401);
  });

  it('own: the role table applies, the handler receives the actor and nothing else is checked', async () => {
    const { checks, asked } = accessChecksAllowing();
    const { handle } = application(checks);
    const driver = await handle(readRequest('/my/tickets', tokenFor('driver')));
    const attendant = await handle(readRequest('/my/tickets', tokenFor('attendant')));
    expect(driver).toEqual({ status: 200, body: { seenBy: 'driver-1' } });
    expect(attendant.status).toBe(403);
    expect(asked).toEqual([]);
  });

  it('staff-scoped: the role table applies, then Authorization is asked with the place the query names', async () => {
    const { checks, asked } = accessChecksAllowing('inspector-1');
    const { handle } = application(checks);
    const inspector = await handle(readRequest('/cash-due', tokenFor('inspector'), { siteId: 'site-1', shiftId: 'morning' }));
    const attendant = await handle(readRequest('/cash-due', tokenFor('attendant'), { siteId: 'site-1' }));
    const driver = await handle(readRequest('/cash-due', tokenFor('driver'), { siteId: 'site-1' }));
    expect(inspector.status).toBe(200);
    expect(attendant.status).toBe(403);
    expect(driver.status).toBe(403);
    expect(asked).toEqual([
      { personId: 'inspector-1', operation: 'payments.cashDue', scope: { siteId: 'site-1' } },
      { personId: 'attendant-1', operation: 'payments.cashDue', scope: { siteId: 'site-1' } },
    ]);
  });

  it('staff-scoped: a query naming no place asks for the system-wide scope', async () => {
    const { checks, asked } = accessChecksAllowing('chair-1');
    const { handle } = application(checks);
    await handle(readRequest('/cash-due', tokenFor('chair')));
    expect(asked[0]?.scope).toEqual({});
  });
});
