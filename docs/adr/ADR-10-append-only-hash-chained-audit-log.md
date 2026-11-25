# ADR-10: Append-only, hash-chained audit log with scoped read access

**Status:** Accepted · **Date:** 2026-11-04 · **Decided by:** Zeyad Khaled

## Context
Accountability is the product: a sayes cannot be trusted on his word and neither can a committee member about a price
change. A permission rule copied into twelve screens is missing from the thirteenth. An editable record proves nothing.

## Decision
Permissions:
- Every request carries a token naming one person and one role; the single entry point checks it before any module
  runs; one permission table maps roles to operations.
- Scope is checked inside modules through Access Control: an attendant acts only at the assigned site, an inspector only
  in the zone, a member only in the district, the Chair everywhere.
- A member requests, the Chair approves; nobody approves their own request. Committee two-step login is built late.
- A revoked licence or suspended account blocks the next write: live status is checked on every write.

Audit log:
- Entry = who (person, role), what (operation, inputs), when (server clock), why (mandatory reason for prices, licences,
  waivers, corrections), approver, request id.
- **Append-only, enforced twice**: no update or delete code path, and the application's database user has no update or
  delete right on the table.
- **Tamper-evident**: each entry stores the hash of the previous entry; editing or removing one breaks every fingerprint
  after it, so anyone can verify the chain.
- Corrections are new rows. Reads of personal data (plate look-ups) are logged.
- **Read access**: members see their district's entries, the Chair sees all, inspectors and attendants see entries about
  themselves (an attendant sees every action on their licence).
- Retention: indefinite, under pseudonyms (ADR-06).

## Alternatives rejected
- An editable log protected by permissions: a privileged bug or person can still rewrite history.
- Checks in each screen: Rule A forbids rules in the apps; one entry point is the only place every request passes.

## Consequences
- Easier: "we did not edit it" becomes "verify the chain"; one permission table to review.
- Harder: one indexed status read per write; the hash chain must be computed inside the transaction (fitness functions
  F5, F6).

## Related
ADR-01, ADR-06, ADR-07.
