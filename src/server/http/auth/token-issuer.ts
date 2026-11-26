import type { Clock } from '../../shared/clock';
import type { TokenIssuer } from '../../shared/token-issuer';
import { issueToken } from './token';

/** The entry point's side of the TokenIssuer port: the secret and the server clock stay here. */
export function createTokenIssuer(secret: string, clock: Clock): TokenIssuer {
  return {
    issue: (identity) => issueToken(identity, secret, clock.now()),
  };
}
