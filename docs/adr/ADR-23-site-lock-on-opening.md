# ADR-23: The PostgreSQL ticket store locks the site while it opens a ticket

**Status:** Accepted · **Date:** 2026-11-25 · **Decided by:** Lino (Teammate A), at the team's instruction to carry out the restructure without the usual review; Karim (Teammate B) and Zeyad Khaled to confirm

## Context
Rule E and fitness function F3 say a site never has more open tickets than spaces. The `TicketStore` contract already
said the PostgreSQL adapter "must do it inside the caller's transaction under a lock on the site", because two
transactions do not see each other's uncommitted tickets. No such adapter existed, so the guard was never built: with
twenty separate simultaneous entry scans for five spaces the in-memory server issued 6 tickets in 30 of 30 runs
(`demo/known-gap-parallel-requests.ts`). On PostgreSQL (ADR-21), where separate transactions really run at once, the
same demo issued 11 to 14.

## Decision
The composition root uses `PostgresTicketStore` (`src/server/adapters/postgres/postgres-ticket-store.ts`): ticketing's
`TableTicketStore` unchanged, with `openIfPossible` first taking `pg_advisory_xact_lock(<ticketing>, hashtext(siteId))`
inside the opening transaction. The lock is released by COMMIT or ROLLBACK; different sites never wait for each other.
Ticketing's own code does not change.

## Alternatives rejected
- Leaving the gap for later: the move to PostgreSQL made it twice as bad, on the integrity rule ranked first (ADR-01).
- `SELECT … FOR UPDATE` on a site row: sites live in another module's records; an advisory lock needs no row.
- A lock method on `TableAccess`: it would change a port every module uses.

## Consequences
- Easier: exactly as many tickets as spaces, in one server copy or several (test "B6 the last-space rule across separate
  transactions"; the demo now issues 5 in 30 of 30 runs).
- Harder: entry scans at one site wait for each other for the few milliseconds the check and the insert take.

## Related
ADR-01 (integrity first), ADR-06 (Rule E), ADR-13, ADR-21.
