# ADR-19: Runtime dependency: the PostgreSQL driver `pg`

**Status:** Accepted · **Date:** 2026-11-25 · **Decided by:** the team (recorded by Lino, Teammate A, the scrum master; ADR-24)

## Context
The application must run only against PostgreSQL (ADR-21). Node has no built-in PostgreSQL client, and AGENTS.md rule 7
requires a decision record before any new runtime dependency.

## Decision
Add `pg` (node-postgres) as a runtime dependency and `@types/pg` as a development dependency. Only the adapters in
`src/server/adapters/postgres/` and the migration runner import it. It is a driver for the database, not a provider
(ADR-11): no database host is named or chosen.

## Alternatives rejected
- `postgres` (another driver): fine, but `pg` is the one the append-only test (task Z2) already expected.
- Writing the wire protocol ourselves: far too much code for no gain.

## Consequences
- Easier: one well-known driver with pooling and parameterised queries.
- Harder: one more package to keep current.

## Related
ADR-11, ADR-21.
