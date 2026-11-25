import type { DistrictId, PersonId, Role } from './identifiers';

/** Who a token is for; the server sets every claim at sign-in, nothing comes from a request body. */
export interface TokenIdentity {
  readonly personId: PersonId;
  readonly role: Role;
  /** The district a committee member belongs to; absent for every other role. */
  readonly districtId?: DistrictId;
}

/**
 * Port (Q4): mints the system's token for a person who just signed in. The entry point implements it (the signing
 * secret and the role-based expiry live there) and the composition root hands it to the modules through their
 * dependencies, so sign-in never imports src/entrypoint (fitness function F2).
 */
export interface TokenIssuer {
  issue(identity: TokenIdentity): string;
}
