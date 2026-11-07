import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../shared/clock';
import { readRequest, TEST_TOKEN_SECRET, testApplication } from '../test-helpers';
import { createTokenIssuer } from './token-issuer';
import { DRIVER_TOKEN_LIFETIME_MILLISECONDS, STAFF_TOKEN_LIFETIME_MILLISECONDS, verifyToken } from './token';

const issuedAt = new Date('2026-11-07T08:00:00Z');

describe('TokenIssuer port (Q4): a module mints a token without importing the entry point', () => {
  it('issues tokens the verifier accepts, with the role-based expiry', () => {
    const issuer = createTokenIssuer(TEST_TOKEN_SECRET, new FixedClock(issuedAt));
    const staff = verifyToken(issuer.issue({ personId: 'attendant-1', role: 'attendant' }), TEST_TOKEN_SECRET, issuedAt);
    const driver = verifyToken(issuer.issue({ personId: 'driver-1', role: 'driver' }), TEST_TOKEN_SECRET, issuedAt);
    expect(staff.ok && new Date(staff.value.expiresAt).getTime() - issuedAt.getTime()).toBe(STAFF_TOKEN_LIFETIME_MILLISECONDS);
    expect(driver.ok && new Date(driver.value.expiresAt).getTime() - issuedAt.getTime()).toBe(DRIVER_TOKEN_LIFETIME_MILLISECONDS);
  });

  it('reaches the modules through ModuleDependencies, and the composed application accepts what it issues', async () => {
    const application = testApplication();
    const token = application.moduleDependencies.tokens.issue({ personId: 'chair-1', role: 'chair' });
    const response = await application.handle(readRequest('/audit-log', token));
    expect(response.status).toBe(200);
  });
});
