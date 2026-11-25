import type { Clock } from '../../shared/clock';
import type { Actor } from '../../shared/identifiers';
import { refuse, type HttpResponse } from '../../shared/operation-contract';
import { fail, succeed, type Result } from '../../shared/result';
import type { HttpRequest } from '../http';
import type { AccessChecks } from './access-checks';
import { verifyToken, type TokenClaims } from './token';

export interface AuthenticationDependencies {
  readonly tokenSecret: string;
  readonly clock: Clock;
  readonly accessChecks: AccessChecks;
}

/**
 * Who is asking (ADR-10, P26 Q4): a valid, unexpired token (401 otherwise), then the accounts module's live status read
 * fresh on every request (403 unless "active"), then the site the session is bound to, attached to the actor so a
 * module compares sites without asking again.
 */
export async function authenticate(request: HttpRequest, dependencies: AuthenticationDependencies): Promise<Result<Actor, HttpResponse>> {
  const claims = verifyToken(bearerTokenOf(request), dependencies.tokenSecret, dependencies.clock.now());
  if (!claims.ok) {
    return fail(refuse(401, claims.error));
  }
  const status = await dependencies.accessChecks.liveStatus(claims.value.personId);
  if (status !== 'active') {
    return fail(refuse(403, `account is ${status}`));
  }
  return succeed(await actorFrom(claims.value, dependencies.accessChecks));
}

function bearerTokenOf(request: HttpRequest): string | undefined {
  const header = request.headers['authorization'];
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : header;
}

async function actorFrom(claims: TokenClaims, checks: AccessChecks): Promise<Actor> {
  const { expiresAt: _expiry, ...identity } = claims;
  const boundSiteId = await checks.boundSite(claims.personId);
  return boundSiteId === undefined ? identity : { ...identity, boundSiteId };
}
