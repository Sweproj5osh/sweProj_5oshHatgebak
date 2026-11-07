import { createHmac, timingSafeEqual } from 'node:crypto';
import { isRole, type DistrictId, type PersonId, type Role } from '../../shared/identifiers';
import { fail, succeed, type Result } from '../../shared/result';

/**
 * The system's own token: base64url(JSON claims) + "." + base64url(HMAC-SHA256 of that first part).
 * One token names one person and one role (ADR-10) and expires (P26 Q4): the live-status check on every request is
 * what locks a person out; the expiry only bounds a stolen token. The secret comes from the environment, never code.
 */
export type TokenRefusal = 'missing token' | 'malformed token' | 'bad signature' | 'bad claims' | 'expired token';

export const TOKEN_SECRET_VARIABLE = 'TOKEN_SECRET';
const MINIMUM_SECRET_LENGTH = 16;

const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * ONE_HOUR;

/** Longer than any shift, so an attendant signs in once per working day. */
export const STAFF_TOKEN_LIFETIME_MILLISECONDS = 14 * ONE_HOUR;
export const DRIVER_TOKEN_LIFETIME_MILLISECONDS = 30 * ONE_DAY;

/** Who the token is for; the server sets every claim at sign-in, nothing comes from a request body. */
export interface TokenIdentity {
  readonly personId: PersonId;
  readonly role: Role;
  /** The district a committee member belongs to; absent for every other role. */
  readonly districtId?: DistrictId;
}

export interface TokenClaims extends TokenIdentity {
  /** ISO-8601 instant after which the token is refused. */
  readonly expiresAt: string;
}

export function issueToken(identity: TokenIdentity, secret: string, issuedAt: Date): string {
  const expiresAt = new Date(issuedAt.getTime() + lifetimeOf(identity.role)).toISOString();
  return signToken({ ...identity, expiresAt }, secret);
}

export function lifetimeOf(role: Role): number {
  return role === 'driver' ? DRIVER_TOKEN_LIFETIME_MILLISECONDS : STAFF_TOKEN_LIFETIME_MILLISECONDS;
}

export function signToken(claims: TokenClaims, secret: string): string {
  const encodedClaims = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${encodedClaims}.${signature(encodedClaims, secret)}`;
}

export function verifyToken(token: string | undefined, secret: string, now: Date): Result<TokenClaims, TokenRefusal> {
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
  const claims = decodeClaims(encodedClaims);
  if (claims.ok && new Date(claims.value.expiresAt).getTime() <= now.getTime()) {
    return fail('expired token');
  }
  return claims;
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

function decodeClaims(encodedClaims: string): Result<TokenClaims, TokenRefusal> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString('utf8'));
  } catch {
    return fail('bad claims');
  }
  if (!isTokenClaims(parsed)) {
    return fail('bad claims');
  }
  return succeed(parsed);
}

function isTokenClaims(candidate: unknown): candidate is TokenClaims {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }
  const { personId, role, districtId, expiresAt, ...unknownClaims } = candidate as Record<string, unknown>;
  const districtIsAbsentOrString = districtId === undefined || typeof districtId === 'string';
  const expiryIsAnInstant = typeof expiresAt === 'string' && !Number.isNaN(new Date(expiresAt).getTime());
  return (
    typeof personId === 'string' &&
    personId.length > 0 &&
    isRole(role) &&
    districtIsAbsentOrString &&
    expiryIsAnInstant &&
    Object.keys(unknownClaims).length === 0
  );
}
