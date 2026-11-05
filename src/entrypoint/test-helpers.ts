import type { Actor, Role } from '../shared/identifiers';
import { REQUEST_ID_HEADER } from '../shared/request-id';
import { signToken } from './auth/token';
import type { HttpRequest } from './http';

export const TEST_TOKEN_SECRET = 'test-secret-that-is-long-enough';

export function tokenFor(role: Role, claims: Partial<Actor> = {}): string {
  return signToken({ personId: `${role}-1`, role, ...claims }, TEST_TOKEN_SECRET);
}

export function writeRequest(path: string, role: Role, requestId: string, body: unknown): HttpRequest {
  return {
    method: 'POST',
    path,
    query: {},
    headers: { authorization: `Bearer ${tokenFor(role)}`, [REQUEST_ID_HEADER]: requestId },
    body,
  };
}

export function readRequest(path: string, token: string, query: Record<string, string> = {}): HttpRequest {
  return { method: 'GET', path, query, headers: { authorization: `Bearer ${token}` } };
}
