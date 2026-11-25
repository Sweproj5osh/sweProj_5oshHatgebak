import { pathWith } from '../../apps/shared-client/route-path';
import type { Role } from '../shared/identifiers';
import type { HttpMethod } from '../shared/operation-contract';
import { REQUEST_ID_HEADER } from '../shared/request-id';
import { signToken, type TokenIdentity } from '../http/auth/token';
import { composeInMemoryApplication, type InMemoryApplication, type InMemoryApplicationOptions } from './compose-test-application';
import type { HttpRequest } from '../http/http';

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

/**
 * A test names its endpoint as a path (`/tickets`) or as a method and a route template (`PATCH /zones/:zoneId`). The
 * template's `:name` segments are filled from the request's own body or query, which keep the value too (ADR-22).
 */
export function requestLine(endpoint: string, values: unknown, defaultMethod: HttpMethod): { method: HttpMethod; path: string } {
  const [first, second] = endpoint.split(' ');
  const [method, template] = second === undefined ? [defaultMethod, first ?? ''] : [first as HttpMethod, second];
  const known = typeof values === 'object' && values !== null && !Array.isArray(values) ? (values as Record<string, unknown>) : {};
  return { method, path: pathWith(template, known) };
}

export function writeRequest(path: string, role: Role, requestId: string, body: unknown): HttpRequest {
  return {
    ...requestLine(path, body, 'POST'),
    query: {},
    headers: { authorization: `Bearer ${tokenFor(role)}`, [REQUEST_ID_HEADER]: requestId },
    address: TEST_ADDRESS,
    body,
  };
}

export function publicRequest(path: string, requestId: string, body: unknown, address: string = TEST_ADDRESS): HttpRequest {
  return { ...requestLine(path, body, 'POST'), query: {}, headers: { [REQUEST_ID_HEADER]: requestId }, address, body };
}

/** A telemetry post: token, body, no request id (P7). */
export function telemetryRequest(path: string, role: Role, body: unknown): HttpRequest {
  return { ...requestLine(path, body, 'POST'), query: {}, headers: { authorization: `Bearer ${tokenFor(role)}` }, address: TEST_ADDRESS, body };
}

export function readRequest(path: string, token: string, query: Record<string, string> = {}): HttpRequest {
  return { ...requestLine(path, query, 'GET'), query, headers: { authorization: `Bearer ${token}` }, address: TEST_ADDRESS };
}

/** A logged read (P9): a read that carries the request id its one audit entry will name. */
export function loggedReadRequest(path: string, role: Role, requestId: string, query: Record<string, string> = {}): HttpRequest {
  return {
    ...requestLine(path, query, 'GET'),
    query,
    headers: { authorization: `Bearer ${tokenFor(role)}`, [REQUEST_ID_HEADER]: requestId },
    address: TEST_ADDRESS,
  };
}
