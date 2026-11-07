import { FixedClock } from '../../../../shared/clock';
import type { TokenIssuer } from '../../../../shared/token-issuer';
import {
  createAccountsAndAccessControl,
  createInMemoryAccountsStores,
  RecordingSignInCodeSender,
  type AccountsAndAccessControl,
  type AccountsAndAccessControlStores,
  type SiteLocator,
} from '../../public';

export const NO_SITES: SiteLocator = { locateSite: async () => undefined, locateZone: async () => undefined };

/**
 * A stand-in for the entry point's token minter: it writes the identity into a readable string instead of signing it.
 * A test that needs a real token passes the entry point's own issuer in; this module's files never import the entry
 * point (fitness function F2).
 */
export const FAKE_TOKEN_ISSUER: TokenIssuer = {
  issue: (identity) => `fake-token:${identity.personId}:${identity.role}:${identity.districtId ?? ''}`,
};

/** This module over in-memory stores, a fixed clock, the recording code sender and a token issuer. */
export interface AccountsWorld {
  readonly accounts: AccountsAndAccessControl;
  readonly stores: AccountsAndAccessControlStores;
  readonly codeSender: RecordingSignInCodeSender;
  readonly clock: FixedClock;
}

export function createAccountsWorld(siteLocator: SiteLocator = NO_SITES, tokenIssuer: TokenIssuer = FAKE_TOKEN_ISSUER): AccountsWorld {
  const stores = createInMemoryAccountsStores();
  const codeSender = new RecordingSignInCodeSender();
  const clock = new FixedClock(new Date('2026-11-05T08:00:00Z'));
  const accounts = createAccountsAndAccessControl({ stores, siteLocator, signInCodeSender: codeSender, tokenIssuer, clock });
  return { accounts, stores, codeSender, clock };
}
