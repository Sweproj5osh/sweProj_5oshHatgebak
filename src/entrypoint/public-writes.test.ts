import { describe, expect, it } from 'vitest';
import { FixedClock } from '../shared/clock';
import { respond, type PublicWriteOperation } from '../shared/operation-contract';
import { REQUEST_ID_HEADER } from '../shared/request-id';
import { composeInMemoryApplication } from './composition';
import { PUBLIC_ATTEMPTS_PER_ADDRESS, PUBLIC_ATTEMPTS_PER_KEY, TOO_MANY_ATTEMPTS } from './rate-limits';
import { publicRequest, TEST_ADDRESS, TEST_TOKEN_SECRET } from './test-helpers';

const PHONE = '+201001234567';

/** Stands in for Lino's sign-in: anonymous, keyed by phone, names the person the code was sent to. */
const requestSignInCode: PublicWriteOperation = {
  kind: 'public',
  name: 'requestSignInCode',
  method: 'POST',
  path: '/sign-in/codes',
  bodySchema: { fields: { phone: 'string' } },
  audit: { omit: ['phone'] },
  rateLimitKey: 'phone',
  examples: { valid: { phone: PHONE }, invalid: {} },
  async handle(context) {
    await context.transaction.insert('test_sign_in_codes', `${context.address}/${context.requestId}`, { phone: context.body['phone'] });
    return { response: respond(202, { sent: true }), audit: { subjectPersonIds: ['person-for-that-phone'] } };
  },
};

function application() {
  return composeInMemoryApplication({
    tokenSecret: TEST_TOKEN_SECRET,
    clock: new FixedClock(new Date('2026-11-07T10:00:00Z')),
    additionalOperations: [requestSignInCode],
  });
}

describe('public operations (P3, ADR-15)', () => {
  it('is accepted without a token and leaves one redacted audit entry naming the anonymous caller by address', async () => {
    const { handle, audit } = application();
    const response = await handle(publicRequest('/sign-in/codes', 'request-0001', { phone: PHONE }));
    expect(response.status).toBe(202);
    const [entry] = await audit.readByScope({ personId: 'chair-1', role: 'chair' });
    expect(entry).toMatchObject({
      actor: { kind: 'anonymous', address: TEST_ADDRESS },
      operation: 'requestSignInCode',
      requestId: 'request-0001',
      input: {},
      subjectPersonIds: ['person-for-that-phone'],
    });
    expect(JSON.stringify(entry)).not.toContain(PHONE);
  });

  it('still needs a request id, obeys the server clock rule and validates the body', async () => {
    const { handle, audit } = application();
    const withoutId = publicRequest('/sign-in/codes', 'request-0001', { phone: PHONE });
    const noId = await handle({ ...withoutId, headers: {} });
    const timestamp = await handle(publicRequest('/sign-in/codes', 'request-0002', { phone: PHONE, sentAt: 1 }));
    const badBody = await handle(publicRequest('/sign-in/codes', 'request-0003', { telephone: PHONE }));
    expect([noId.status, timestamp.status, badBody.status]).toEqual([400, 400, 400]);
    expect(String((noId.body as { error: string }).error)).toContain(REQUEST_ID_HEADER);
    expect(await audit.readByScope({ personId: 'chair-1', role: 'chair' })).toHaveLength(0);
  });

  it('repeats: the same address and request id return the stored response; another address with the same id is a new write', async () => {
    const { handle, audit } = application();
    const first = await handle(publicRequest('/sign-in/codes', 'request-0001', { phone: PHONE }));
    const repeat = await handle(publicRequest('/sign-in/codes', 'request-0001', { phone: PHONE }));
    const otherAddress = await handle(publicRequest('/sign-in/codes', 'request-0001', { phone: '+201009876543' }, '198.51.100.9'));
    expect(repeat).toEqual(first);
    expect(otherAddress.status).toBe(202);
    expect(await audit.readByScope({ personId: 'chair-1', role: 'chair' })).toHaveLength(2);
  });

  it('refuses the same address and request id with a different body with 409 and no new entry (P19)', async () => {
    const { handle, audit } = application();
    await handle(publicRequest('/sign-in/codes', 'request-0001', { phone: PHONE }));
    const reused = await handle(publicRequest('/sign-in/codes', 'request-0001', { phone: '+201009876543' }));
    expect(reused.status).toBe(409);
    expect(await audit.readByScope({ personId: 'chair-1', role: 'chair' })).toHaveLength(1);
  });

  it(`refuses the ${PUBLIC_ATTEMPTS_PER_KEY.maximumAttempts + 1}th attempt for one phone with 429 and a plain message`, async () => {
    const { handle, audit } = application();
    for (let attempt = 1; attempt <= PUBLIC_ATTEMPTS_PER_KEY.maximumAttempts; attempt += 1) {
      const response = await handle(publicRequest('/sign-in/codes', `request-${attempt}00`, { phone: PHONE }, `198.51.100.${attempt}`));
      expect(response.status).toBe(202);
    }
    const overTheLimit = await handle(publicRequest('/sign-in/codes', 'request-9999', { phone: PHONE }, '198.51.100.99'));
    expect(overTheLimit.status).toBe(429);
    expect(overTheLimit.body).toEqual({ error: TOO_MANY_ATTEMPTS });
    expect(await audit.readByScope({ personId: 'chair-1', role: 'chair' })).toHaveLength(PUBLIC_ATTEMPTS_PER_KEY.maximumAttempts);
  });

  it(`refuses the ${PUBLIC_ATTEMPTS_PER_ADDRESS.maximumAttempts + 1}th attempt from one address with 429`, async () => {
    const { handle } = application();
    for (let attempt = 1; attempt <= PUBLIC_ATTEMPTS_PER_ADDRESS.maximumAttempts; attempt += 1) {
      const response = await handle(publicRequest('/sign-in/codes', `request-${attempt}00`, { phone: `+2010${String(attempt).padStart(8, '0')}` }));
      expect(response.status).toBe(202);
    }
    const overTheLimit = await handle(publicRequest('/sign-in/codes', 'request-9999', { phone: '+201099999999' }));
    expect(overTheLimit.status).toBe(429);
  });

  it('admits the same phone again once the window has slid past the earlier attempts', async () => {
    const clock = new FixedClock(new Date('2026-11-07T10:00:00Z'));
    const { handle } = composeInMemoryApplication({ tokenSecret: TEST_TOKEN_SECRET, clock, additionalOperations: [requestSignInCode] });
    for (let attempt = 1; attempt <= PUBLIC_ATTEMPTS_PER_KEY.maximumAttempts; attempt += 1) {
      await handle(publicRequest('/sign-in/codes', `request-${attempt}00`, { phone: PHONE }));
    }
    clock.advanceByMilliseconds(PUBLIC_ATTEMPTS_PER_KEY.windowMilliseconds + 1);
    const afterTheWindow = await handle(publicRequest('/sign-in/codes', 'request-9999', { phone: PHONE }));
    expect(afterTheWindow.status).toBe(202);
  });
});
