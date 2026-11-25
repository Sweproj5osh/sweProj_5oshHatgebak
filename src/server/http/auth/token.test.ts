import { describe, expect, it } from 'vitest';
import {
  DRIVER_TOKEN_LIFETIME_MILLISECONDS,
  issueToken,
  readTokenSecret,
  signToken,
  STAFF_TOKEN_LIFETIME_MILLISECONDS,
  verifyToken,
} from './token';

const secret = 'a-secret-long-enough-for-tests';
const issuedAt = new Date('2026-11-07T08:00:00Z');
const aMomentLater = new Date('2026-11-07T08:00:01Z');

describe('signed token', () => {
  it('round-trips the person, the role and the expiry', () => {
    const token = issueToken({ personId: 'chair-1', role: 'chair' }, secret, issuedAt);
    expect(verifyToken(token, secret, aMomentLater)).toEqual({
      ok: true,
      value: { personId: 'chair-1', role: 'chair', expiresAt: '2026-11-07T22:00:00.000Z' },
    });
  });

  it('gives staff 14 hours, longer than any shift, and drivers 30 days (P26 Q4)', () => {
    expect(STAFF_TOKEN_LIFETIME_MILLISECONDS).toBe(14 * 60 * 60 * 1000);
    expect(DRIVER_TOKEN_LIFETIME_MILLISECONDS).toBe(30 * 24 * 60 * 60 * 1000);
    const driver = verifyToken(issueToken({ personId: 'driver-1', role: 'driver' }, secret, issuedAt), secret, aMomentLater);
    expect(driver.ok && driver.value.expiresAt).toBe('2026-12-07T08:00:00.000Z');
  });

  it('refuses an expired token', () => {
    const token = issueToken({ personId: 'attendant-1', role: 'attendant' }, secret, issuedAt);
    const afterFourteenHours = new Date(issuedAt.getTime() + STAFF_TOKEN_LIFETIME_MILLISECONDS);
    expect(verifyToken(token, secret, afterFourteenHours)).toEqual({ ok: false, error: 'expired token' });
  });

  it('refuses a missing token', () => {
    expect(verifyToken(undefined, secret, aMomentLater)).toEqual({ ok: false, error: 'missing token' });
  });

  it('refuses a token signed with another secret', () => {
    const token = issueToken({ personId: 'chair-1', role: 'chair' }, 'some-other-secret-value', issuedAt);
    expect(verifyToken(token, secret, aMomentLater)).toEqual({ ok: false, error: 'bad signature' });
  });

  it('refuses a token whose claims were edited after signing', () => {
    const token = issueToken({ personId: 'attendant-1', role: 'attendant' }, secret, issuedAt);
    const [, signature] = token.split('.');
    const forgedClaims = Buffer.from(JSON.stringify({ personId: 'attendant-1', role: 'chair', expiresAt: '2099-01-01T00:00:00.000Z' })).toString('base64url');
    expect(verifyToken(`${forgedClaims}.${signature}`, secret, aMomentLater)).toEqual({ ok: false, error: 'bad signature' });
  });

  it('refuses claims without an expiry, even when correctly signed', () => {
    const token = signToken({ personId: 'chair-1', role: 'chair' } as never, secret);
    expect(verifyToken(token, secret, aMomentLater)).toEqual({ ok: false, error: 'bad claims' });
  });

  it('refuses garbage', () => {
    expect(verifyToken('not-a-token', secret, aMomentLater)).toEqual({ ok: false, error: 'malformed token' });
  });

  it('refuses to start without a secret in the environment', () => {
    expect(() => readTokenSecret({})).toThrow('TOKEN_SECRET must be set');
  });
});
