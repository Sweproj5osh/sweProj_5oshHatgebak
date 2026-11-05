/**
 * The containment split from ADR-03. A must-stay-on module keeps a driver parking; a may-fail module fails alone.
 * Rule D: nothing in the must-stay-on set imports anything in the may-fail set (fitness function F8).
 */
export const MUST_STAY_ON_MODULES: readonly string[] = [
  'accounts-and-access-control',
  'sites-and-areas',
  'ticketing',
  'committee-prices',
  'payments',
  'audit-log',
];

export const MAY_FAIL_MODULES: readonly string[] = [
  'cash-custody',
  'licensing-assignment-attendance',
  'approvals',
  'complaints-inspections-ratings',
  'money-check-dashboard',
  'scheduler',
  'notifications',
  'evidence',
];

export const ALL_MODULES: readonly string[] = [...MUST_STAY_ON_MODULES, ...MAY_FAIL_MODULES];

export const PURE_MODULE = 'committee-prices';
