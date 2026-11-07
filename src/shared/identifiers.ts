/** Identifiers shared across module boundaries. Each is a string so that adapters stay free to choose the storage type. */
export type PersonId = string;
export type DistrictId = string;
export type ZoneId = string;
export type SiteId = string;
export type TicketId = string;
export type PaymentId = string;
export type DepositId = string;
export type ApprovalRequestId = string;
export type LicenceId = string;
export type PhotoId = string;

/** The five roles. One token names one person and one role (ADR-10). */
export type Role = 'driver' | 'attendant' | 'inspector' | 'member' | 'chair';

export const ALL_ROLES: readonly Role[] = ['driver', 'attendant', 'inspector', 'member', 'chair'];

/** The two committee roles: the only ones whose operations may take a calendar time (P6, fitness function F11). */
export const COMMITTEE_ROLES: readonly Role[] = ['member', 'chair'];

export function isRole(candidate: unknown): candidate is Role {
  return typeof candidate === 'string' && (ALL_ROLES as readonly string[]).includes(candidate);
}

/**
 * A person acting through the entry point: the token's claims after verification. The server sets every claim at
 * sign-in; nothing here ever comes from a request body or query string.
 */
export interface Actor {
  readonly personId: PersonId;
  readonly role: Role;
  /** The district a committee member belongs to; absent for every other role. */
  readonly districtId?: DistrictId;
  /** The site an attendant's session was bound to at clock-in, read fresh on every request; absent otherwise. */
  readonly boundSiteId?: SiteId;
}
