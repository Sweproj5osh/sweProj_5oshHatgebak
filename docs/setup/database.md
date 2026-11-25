# The database: PostgreSQL through POSTGRES_URL

The system runs only against PostgreSQL (ADR-21). There is no in-memory fallback: the tests refuse to start without
`POSTGRES_URL`, and (from phase R10 of the restructure) so does the server.

## Getting a PostgreSQL
Any PostgreSQL 14 or later works.
- **Docker:** `docker compose -f db/compose.yaml up -d`, then
  `export POSTGRES_URL=postgres://sayes:sayes@localhost:5432/postgres`. (The compose file was not run on the machine
  the restructure was made on, whose Docker did not answer; a local PostgreSQL 14 was used instead.)
- **A local installation** (for example Homebrew's `postgresql@14`): `export POSTGRES_URL=postgres://$USER@localhost:5432/postgres`.

## Migrations
`npm run db:migrate` applies, in file-name order, every file of `db/migrations` the database has not recorded in
`foundation.schema_migrations`, each in its own transaction; a second run applies nothing. Run it as the database owner.
Migration 0005 adds what the adapters need: the `records` tables (one per module schema), the response body hash, the
rate-limit table and the outbox order. Column names never contain "name", "plate" or "phone" outside `personal_data`
(fitness function F10).

## How records are stored
A module's store reads and writes plain records through `TableAccess`. The PostgreSQL adapter
(`src/server/adapters/postgres/postgres-database.ts`) keeps each record whole, as the `json` text written, under its
key, in the `records` table of the schema its table name starts with (`personal_data.cars` goes to
`personal_data.records`); a table name with no module schema goes to `foundation.records`. `list` returns records in
the order they were first written. The audit log, the outbox, the stored answers and the rate-limit attempts have their
own tables and stores. The column tables of migrations 0002 and 0004 are not used.

## The roles
Migration 0001 creates `sayes_application`, the role the application acts as: it may insert into and read `audit_log`
and never update or delete it (ADR-10). In production `POSTGRES_URL` names a login role that is a member of
`sayes_application` and nothing more; migrations run with the owner's credentials.

## Tests
`src/server/test-support/postgres-global-setup.ts` runs once per `vitest run`: it creates a template database, applies
every migration to it, and makes sure the login role `sayes_test_application` (a member of `sayes_application`)
exists. Each test application calls `createTestDatabase()` (`src/server/test-support/postgres-test-database.ts`), which
clones the template into a fresh database and connects as that role, so every test starts empty and every audit grant
is enforced. At the end of the run every database of the run is dropped. Nothing truncates or deletes `audit_log` rows.
In continuous integration a PostgreSQL service container provides the database (`.github/workflows/ci.yml`).
