import type { Role } from '../shared/identifiers';
import { REQUEST_ID_HEADER } from '../shared/request-id';
import { signToken, type TokenIdentity } from './auth/token';
import { composeInMemoryApplication, type InMemoryApplication, type InMemoryApplicationOptions } from './composition';
import type { HttpRequest } from './http';

export const TEST_TOKEN_SECRET = 'test-secret-that-is-long-enough';

/** Test tokens never expire during a test run; the expiry rule has its own tests. */
const FAR_FUTURE = '2099-01-01T00:00:00.000Z';

/** The in-memory application as the pipeline tests want it: the test secret, everyone live unless overridden. */
export function testApplication(overrides: Partial<InMemoryApplicationOptions> = {}): InMemoryApplication {
  return composeInMemoryApplication({ tokenSecret: TEST_TOKEN_SECRET, ...overrides });
}

/** A documentation-range address (RFC 5737) standing for the client in every test request. */
export const TEST_ADDRESS = '203.0.113.7';

export function tokenFor(role: Role, identity: Partial<TokenIdentity> = {}): string {
  return signToken({ personId: `${role}-1`, role, ...identity, expiresAt: FAR_FUTURE }, TEST_TOKEN_SECRET);
}

export function writeRequest(path: string, role: Role, requestId: string, body: unknown): HttpRequest {
  return {
    method: 'POST',
    path,
    query: {},
    headers: { authorization: `Bearer ${tokenFor(role)}`, [REQUEST_ID_HEADER]: requestId },
    address: TEST_ADDRESS,
    body,
  };
}

export function publicRequest(path: string, requestId: string, body: unknown, address: string = TEST_ADDRESS): HttpRequest {
  return { method: 'POST', path, query: {}, headers: { [REQUEST_ID_HEADER]: requestId }, address, body };
}

/** A telemetry post: token, body, no request id (P7). */
export function telemetryRequest(path: string, role: Role, body: unknown): HttpRequest {
  return { method: 'POST', path, query: {}, headers: { authorization: `Bearer ${tokenFor(role)}` }, address: TEST_ADDRESS, body };
}

export function readRequest(path: string, token: string, query: Record<string, string> = {}): HttpRequest {
  return { method: 'GET', path, query, headers: { authorization: `Bearer ${token}` }, address: TEST_ADDRESS };
}

/** A logged read (P9): a read that carries the request id its one audit entry will name. */
export function loggedReadRequest(path: string, role: Role, requestId: string, query: Record<string, string> = {}): HttpRequest {
  return {
    method: 'GET',
    path,
    query,
    headers: { authorization: `Bearer ${tokenFor(role)}`, [REQUEST_ID_HEADER]: requestId },
    address: TEST_ADDRESS,
  };
}
