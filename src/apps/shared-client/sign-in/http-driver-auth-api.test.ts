import { describe, expect, it } from 'vitest';
import { TEST_ADDRESS, testApplication } from '../../../entrypoint/test-helpers';
import { FixedClock } from '../../../shared/clock';
import type { TokenIssuer } from '../../../shared/token-issuer';
import { answerDroppingHandle, type AnswerDrops } from '../../test-support/answer-dropping-handle';
import { fromAddress } from '../../test-support/from-address';
import {
  createStandInAccountsState,
  createStandInCarOperations,
  createStandInSignInOperations,
  lastCodeSentTo,
} from '../../test-support/stand-in-driver-auth-operations';
import { DriverSignInClient } from './driver-sign-in-client';
import { HttpDriverAuthApi } from './http-driver-auth-api';

const PHONE = '01012345678';
const UNKNOWN_PHONE = '01199999999';
const DRIVER_ID = 'driver-1';
const CHAIR = { personId: 'chair-1', role: 'chair' } as const;

function buildStack(drops: AnswerDrops = { remaining: 0 }) {
  /** The stand-in mints through the application's own issuer, which exists only once the application is composed. */
  const tokensOfTheApplication: TokenIssuer = { issue: (identity) => app.moduleDependencies.tokens.issue(identity) };
  const accounts = createStandInAccountsState(tokensOfTheApplication, [PHONE]);
  const app = testApplication({
    clock: new FixedClock(new Date('2026-11-06T12:00:00Z')),
    additionalOperations: [...createStandInSignInOperations(accounts), ...createStandInCarOperations(accounts)],
  });
  const api = new HttpDriverAuthApi({ handle: answerDroppingHandle(fromAddress(app.handle, TEST_ADDRESS), drops) });

  let serial = 1;
  const client = new DriverSignInClient({
    api,
    createRequestId: () => `d1-http-req-${String(serial++).padStart(4, '0')}`,
  });

  async function signIn(): Promise<void> {
    await client.submitPhone(PHONE);
    const code = lastCodeSentTo(accounts, PHONE);
    expect(code).toBeDefined();
    const result = await client.submitCode(code ?? '');
    expect(result.ok).toBe(true);
  }

  return { client, accounts, audit: app.audit, signIn };
}

describe('D1 Driver App sign-in and cars over the HTTP entry point', () => {
  it('signs in with the code the server sent, in two taps, and the token works on the real pipeline', async () => {
    const { client, signIn } = buildStack();

    await signIn();

    expect(client.isSignedIn()).toBe(true);
    expect(client.tapsToSignIn()).toBe(2);
    expect(await client.listCars()).toEqual({ ok: true, value: [] });

    console.log(`D1 report: taps to sign in = ${client.tapsToSignIn()}`);
  });

  it('goes through the pipeline, not around it: both sign-in steps leave an anonymous, redacted audit entry (P3)', async () => {
    const { signIn, audit } = buildStack();

    await signIn();

    const entries = await audit.readByScope(CHAIR);
    expect(entries.map((entry) => entry.operation)).toEqual(['requestSignInCode', 'signIn']);
    expect(entries.map((entry) => entry.address)).toEqual([TEST_ADDRESS, TEST_ADDRESS]);
    expect(entries.map((entry) => entry.personId)).toEqual([undefined, undefined]);
    expect(entries.map((entry) => entry.requestId)).toEqual(['d1-http-req-0001', 'd1-http-req-0002']);
    expect(JSON.stringify(entries)).not.toContain(PHONE);
  });

  it('refuses a wrong code, and three wrong codes lock the phone even for the right code', async () => {
    const { client, accounts } = buildStack();
    await client.submitPhone(PHONE);
    const rightCode = lastCodeSentTo(accounts, PHONE) ?? '';

    expect(await client.submitCode('999991')).toEqual({ ok: false, error: 'wrong code' });
    expect(await client.submitCode('999992')).toEqual({ ok: false, error: 'wrong code' });
    expect(await client.submitCode('999993')).toEqual({ ok: false, error: 'locked' });
    expect(await client.submitCode(rightCode)).toEqual({ ok: false, error: 'locked' });
    expect(client.isSignedIn()).toBe(false);
    expect(accounts.tokensIssued).toBe(0);
  });

  it('answers an unknown phone like a wrong code and sends no code', async () => {
    const { client, accounts } = buildStack();

    const requested = await client.submitPhone(UNKNOWN_PHONE);
    const attempt = await client.submitCode('123456');

    expect(requested.ok).toBe(true);
    expect(attempt).toEqual({ ok: false, error: 'wrong code' });
    expect(accounts.sentCodes).toHaveLength(0);
  });

  it('saves a plate and it appears in the driver cars, as the server stores it', async () => {
    const { client, signIn, audit } = buildStack();
    await signIn();

    const saved = await client.addCar('abc-123');
    const listed = await client.listCars();

    expect(saved).toEqual({ ok: true, value: ['ABC123'] });
    expect(listed).toEqual({ ok: true, value: ['ABC123'] });

    const entries = await audit.readByScope({ personId: DRIVER_ID, role: 'driver' });
    expect(entries.map((entry) => entry.operation)).toEqual(['signIn', 'personalData.addCar']);
    expect(JSON.stringify(entries)).not.toContain('ABC123');
  });

  it('saving the same plate twice keeps one car', async () => {
    const { client, signIn, accounts } = buildStack();
    await signIn();

    await client.addCar('ABC123');
    const again = await client.addCar('abc 123');

    expect(again).toEqual({ ok: true, value: ['ABC123'] });
    expect(accounts.carsSaved).toBe(1);
  });

  it('shows the server refusal for an invalid plate and leaves no car and no audit entry', async () => {
    const { client, signIn, accounts, audit } = buildStack();
    await signIn();

    const result = await client.addCar('this plate is far too long');

    expect(result).toEqual({ ok: false, error: 'invalid plate' });
    expect(accounts.carsSaved).toBe(0);
    expect((await audit.readByScope({ personId: DRIVER_ID, role: 'driver' })).map((entry) => entry.operation)).toEqual(['signIn']);
    expect(client.pendingCarRequestId()).toBeUndefined();
  });

  it('refuses to save a car before signing in, without calling the server', async () => {
    const { client, accounts } = buildStack();

    expect(await client.addCar('ABC123')).toEqual({ ok: false, error: 'not signed in' });
    expect(accounts.carsSaved).toBe(0);
  });

  it('airplane mode after the plate was saved, then retry: one car and one audit entry', async () => {
    const drops = { remaining: 0 };
    const { client, signIn, accounts, audit } = buildStack(drops);
    await signIn();
    drops.remaining = 1;

    const lost = await client.addCar('ABC123');
    expect(lost.ok).toBe(false);
    expect(client.pendingCarRequestId()).toBeDefined();
    expect(accounts.carsSaved).toBe(1);

    const retry = await client.addCar('ABC123');

    expect(retry).toEqual({ ok: true, value: ['ABC123'] });
    expect(accounts.carsSaved).toBe(1);
    expect(client.pendingCarRequestId()).toBeUndefined();
    const entries = await audit.readByScope({ personId: DRIVER_ID, role: 'driver' });
    expect(entries.filter((entry) => entry.operation === 'personalData.addCar')).toHaveLength(1);
  });

  it('airplane mode after the sign-in was answered, then retry: the same token and one sign-in', async () => {
    const drops = { remaining: 0 };
    const { client, accounts, audit } = buildStack(drops);
    await client.submitPhone(PHONE);
    const code = lastCodeSentTo(accounts, PHONE) ?? '';
    drops.remaining = 1;

    const lost = await client.submitCode(code);
    expect(lost.ok).toBe(false);
    expect(client.isSignedIn()).toBe(false);
    expect(accounts.tokensIssued).toBe(1);

    const retry = await client.submitCode(code);

    expect(retry.ok).toBe(true);
    expect(client.isSignedIn()).toBe(true);
    expect(accounts.tokensIssued).toBe(1);
    expect(client.tapsToSignIn()).toBe(3);
    expect((await audit.readByScope(CHAIR)).filter((entry) => entry.operation === 'signIn')).toHaveLength(1);
  });

  it('airplane mode after the code request, then retry: one code is sent', async () => {
    const drops = { remaining: 1 };
    const { client, accounts } = buildStack(drops);

    const lost = await client.submitPhone(PHONE);
    expect(lost.ok).toBe(false);
    expect(accounts.sentCodes).toHaveLength(1);

    const retry = await client.submitPhone(PHONE);

    expect(retry.ok).toBe(true);
    expect(accounts.sentCodes).toHaveLength(1);
  });
});
