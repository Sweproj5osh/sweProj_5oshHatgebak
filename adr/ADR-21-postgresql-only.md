# ADR-21: PostgreSQL only, through POSTGRES_URL; no in-memory database

**Status:** Accepted · **Date:** 2026-11-25 · **Decided by:** Lino (Teammate A), at the team's instruction to carry out the restructure without the usual review; Zeyad Khaled to confirm

## Context
With `DATABASE_URL` unset the server and every test ran on in-memory adapters, so a server could run for days on
storage that forgets everything at a restart. That must never be possible.

## Decision
- The application runs only against PostgreSQL named by `POSTGRES_URL` (renamed from `DATABASE_URL`). A missing or
  unreachable database, or a migration not yet applied, stops start-up with a clear error. There is no fallback.
- PostgreSQL adapters implement the existing ports without changing them: `TableAccess` and the unit of work, the
  audit log store, the outbox store, the response store and the rate limiter.
- Records are stored whole, under their key, in a `records` table inside the owning module's schema
  (`<schema>.records`: `record_table`, `record_key`, `position`, `record` as `json`), so a record comes back exactly as
  it was written and personal data stays in `personal_data`. The column tables of migrations 0002 and 0004 stay unused.
- The unit of work starts lazily (the connection is taken at the first statement), so `begin()` stays synchronous.
  The audit log store takes `pg_advisory_xact_lock` before reading the last record. Every time comes from the
  injected server clock, never from the database.
- Migration 0005 adds the records tables, the response body hash, the rate-limit table, the outbox order and the list
  of applied migrations; `npm run db:migrate` applies what is missing.
- Tests run against a real PostgreSQL: each test application gets its own database cloned from a migrated template,
  dropped at the end of the run. Nothing truncates or deletes `audit_log` rows. The two proofs that edit records under
  the log use a test-only array-backed `AuditLogStore`.
- The in-memory adapters are deleted. Fitness function F14 proves the running application imports no test-only code.

## Alternatives rejected
- Column-by-column mapping onto the 0002 and 0004 tables: their constraints add refusals that do not exist today.
- Truncating tables between tests: it would delete `audit_log` rows.
- Keeping the in-memory adapters for unit tests: the silent fallback is exactly what this record removes.

## Consequences
- Easier: data survives a restart; several server copies share one truth; the append-only grants are tested always.
- Harder: `npm test` needs a running PostgreSQL; the suite is slower.

## Related
Amends ADR-11 (consequence "tests run against in-memory adapters"), ADR-13 (the in-memory database; PostgreSQL now
implements `Transaction`) and ADR-15 (the shared rate-limiter store now exists). ADR-07, ADR-10, ADR-19.
