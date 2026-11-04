# ADR-06: One writer per table; personal data in a separate store behind pseudonyms

**Status:** Accepted · **Date:** 2026-11-04 · **Decided by:** Zeyad Khaled

## Context
Data is the hardest thing to change after launch. Two modules writing one table are secretly one module. Instant
consistency costs a lock, so it is paid only where integrity demands it. Law 151 of 2020 requires minimum collection,
separate storage, retention and erasure of personal data. The receipt must show the licence plate.

## Decision
- **One owner per table**: Sites & Areas owns sites; Ticketing owns tickets and the free-space count; Committee Prices
  owns price versions (written only through Approvals); Payments owns payments; Cash Custody owns deposits; Accounts &
  Access Control owns users and the personal-data store; Licensing & Assignment owns licences (suspension and revocation
  written only through Approvals); Approvals owns requests; Complaints, Inspections & Ratings owns its records; Audit Log
  owns history; Evidence owns photos. Money Check & Dashboard owns nothing.
- **Rule E, one transaction for integrity**: open ticket = capacity check + insert + audit entry; close ticket = freeze
  time + fee from Prices + audit; mark paid = payment row + ticket status + audit. All or nothing.
- **Rule F, pseudonyms outside the personal-data store**: the ticket table holds a driver reference; names, phones and
  plates live in the personal-data store. The plate **is** stored and **is** printed on the receipt; the receipt, the
  attendant's cash list and the inspector's look-up are role-checked, logged joins. At retention end the reference is
  cut, so history is anonymised without deleting the revenue record.
- **Rule G, derived data is never the truth**: totals, dashboards and the free-space display are recomputed or cached;
  the tickets win.
- Freshness: tickets, payments, approvals and audit entries are instant; sites, roles and complaints may be seconds to
  minutes old; a revoked licence must block the next write.
- Retention (accepted 2026-11-04): ticket-to-person link cut 12 months after close; audit log kept
  indefinitely under pseudonyms; assistant chat history 90 days.

## Alternatives rejected
- Plates in the ticket table: simpler joins, but erasure would delete revenue history or leave plates behind.
- Stored dashboard totals: a correction in Payments and the dashboard would disagree.

## Consequences
- Easier: erasure is cutting one reference; the audit log can be kept for years.
- Harder: every screen that shows a plate performs a logged join (fitness function F10 enforces the column rule).

## Related
ADR-01, ADR-02, ADR-04 (assistant history), ADR-10.
