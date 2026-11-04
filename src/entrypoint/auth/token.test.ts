import { describe, expect, it } from 'vitest';
import { readTokenSecret, signToken, verifyToken } from './token';

const secret = 'a-secret-long-enough-for-tests';

describe('signed token', () => {
  it('round-trips the person and role', () => {
    const token = signToken({ personId: 'chair-1', role: 'chair' }, secret);
    expect(verifyToken(token, secret)).toEqual({ ok: true, value: { personId: 'chair-1', role: 'chair' } });
  });

  it('refuses a missing token', () => {
    expect(verifyToken(undefined, secret)).toEqual({ ok: false, error: 'missing token' });
  });

  it('refuses a token signed with another secret', () => {
    const token = signToken({ personId: 'chair-1', role: 'chair' }, 'some-other-secret-value');
    expect(verifyToken(token, secret)).toEqual({ ok: false, error: 'bad signature' });
  });

  it('refuses a token whose claims were edited after signing', () => {
    const token = signToken({ personId: 'attendant-1', role: 'attendant' }, secret);
    const [, signature] = token.split('.');
    const forgedClaims = Buffer.from(JSON.stringify({ personId: 'attendant-1', role: 'chair' })).toString('base64url');
    expect(verifyToken(`${forgedClaims}.${signature}`, secret)).toEqual({ ok: false, error: 'bad signature' });
  });

  it('refuses garbage', () => {
    expect(verifyToken('not-a-token', secret)).toEqual({ ok: false, error: 'malformed token' });
  });

  it('refuses to start without a secret in the environment', () => {
    expect(() => readTokenSecret({})).toThrow('TOKEN_SECRET must be set');
  });
});
