import { createHmac, timingSafeEqual } from 'node:crypto';
import { isRole, type Actor } from '../../shared/identifiers';
import { fail, succeed, type Result } from '../../shared/result';

/**
 * The system's own token: base64url(JSON claims) + "." + base64url(HMAC-SHA256 of that first part).
 * One token names one person and one role (ADR-10). The secret comes from the environment, never from code.
 */
export type TokenRefusal = 'missing token' | 'malformed token' | 'bad signature' | 'bad claims';

export const TOKEN_SECRET_VARIABLE = 'TOKEN_SECRET';
const MINIMUM_SECRET_LENGTH = 16;

export function signToken(claims: Actor, secret: string): string {
  const encodedClaims = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${encodedClaims}.${signature(encodedClaims, secret)}`;
}

export function verifyToken(token: string | undefined, secret: string): Result<Actor, TokenRefusal> {
  if (token === undefined || token === '') {
    return fail('missing token');
  }
  const [encodedClaims, providedSignature, ...rest] = token.split('.');
  if (encodedClaims === undefined || providedSignature === undefined || rest.length > 0) {
    return fail('malformed token');
  }
  if (!signaturesMatch(providedSignature, signature(encodedClaims, secret))) {
    return fail('bad signature');
  }
  return decodeClaims(encodedClaims);
}

export function readTokenSecret(environment: NodeJS.ProcessEnv): string {
  const secret = environment[TOKEN_SECRET_VARIABLE];
  if (secret === undefined || secret.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(`${TOKEN_SECRET_VARIABLE} must be set to at least ${MINIMUM_SECRET_LENGTH} characters`);
  }
  return secret;
}

function signature(encodedClaims: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedClaims).digest('base64url');
}

function signaturesMatch(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided, 'base64url');
  const expectedBytes = Buffer.from(expected, 'base64url');
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}

function decodeClaims(encodedClaims: string): Result<Actor, TokenRefusal> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString('utf8'));
  } catch {
    return fail('bad claims');
  }
  if (!isActor(parsed)) {
    return fail('bad claims');
  }
  return succeed(parsed);
}

function isActor(candidate: unknown): candidate is Actor {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }
  const { personId, role, districtId, ...unknownClaims } = candidate as Record<string, unknown>;
  const districtIsAbsentOrString = districtId === undefined || typeof districtId === 'string';
  return (
    typeof personId === 'string' &&
    personId.length > 0 &&
    isRole(role) &&
    districtIsAbsentOrString &&
    Object.keys(unknownClaims).length === 0
  );
}
