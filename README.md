# Street Parking Management System (Cairo)

A street parking management system for Cairo: a driver scans a site code to park, pays the committee's published
price, and gets a receipt; the governorate committee stays in control of prices and licences, and every visit,
payment, price change and decision leaves a record nobody can quietly alter. Every rule that binds this repository,
with its reasons, is in [ARCHITECTURE_RULES.md](ARCHITECTURE_RULES.md); read that file first.

## Qualities, ranked
1. Integrity · 2. Accountability · 3. Reliability and availability · 4. Security. The lower rank gives way in a
conflict ([ADR-01](adr/ADR-01-ranked-qualities.md)).

## The two deployable units
- **The main system** (this repository): one modular monolith, run as stateless copies, one PostgreSQL database.
- **The AI Assistant service**: a separate small service with its own database that calls the main system with the
  driver's own token ([ADR-04](adr/ADR-04-assistant-second-quantum.md)).

## The fourteen modules
`src/modules/<module>/public.ts` is the only file another module may import; `internal/` is private. The full table of
modules, public interfaces, owners and sets is in [MODULES.md](MODULES.md).

| Owner | Modules |
|---|---|
| Zeyad (Area 1) | `audit-log`, `scheduler`, plus the foundation: `src/entrypoint`, `src/shared`, `src/adapters`, `src/fitness`, `db/` |
| Lino (Teammate A) (Area 2) | `accounts-and-access-control`, `sites-and-areas`, `licensing-assignment-attendance` |
| Karim (Teammate B) (Area 3) | `committee-prices`, `ticketing` |
| Amina (Teammate C) (Area 4) | `payments`, `cash-custody`, `approvals`, `money-check-dashboard` |
| Mahi (Teammate D) (Area 5) | `notifications`, `evidence`, `complaints-inspections-ratings` |

## Running things
```bash
npm ci                 # install (Node.js 24)
npm run typecheck      # TypeScript, strict mode
npm test               # Vitest: every test runs on in-memory adapters, no database needed
npm run fitness        # the static fitness functions F1, F2, F8, F10, F11
npx tsx src/fitness/f2-cross-module-imports-use-public-interfaces.ts   # one fitness function alone
cp .env.example .env && npm start                                      # the HTTP entry point, in-memory storage
```
The database test for task Z2 (the application role cannot update or delete `audit_log`) runs only when
`DATABASE_URL` points at a PostgreSQL you own and the `pg` package is installed (`npm install --no-save pg`); it says
so and skips otherwise.

## How a write travels
Token (one person, one role, signed by the server) → permission table → `X-Request-Id` required → body rejected if
it carries a timestamp → body schema → repeat check (same id, same answer) → the module's handler → **one audit entry
appended by the pipeline** → events to the outbox → commit. A failed write leaves no entry and no event. Each audit
entry's id and previous hash come from the last entry, so appends are serialized across every server copy: the
PostgreSQL adapter takes `pg_advisory_xact_lock(<constant>)` inside the write's transaction before reading the last
entry and inserting the next. Module owners
register their operations as `WriteOperation` objects (see `src/entrypoint/operations/operation.ts`); the audit-coverage
test (`src/entrypoint/audit-coverage.test.ts`) then checks every registered write automatically.

## Rules for everyone (from `docs/TEAM_TASKS.md`)
1. Stay inside your area; use another area only through its `public.ts`.
2. Every write accepts a client request id; the same id twice gives the same answer and changes the database once.
3. Every write leaves exactly one audit entry, inside the same transaction; a failed write leaves none.
4. The apps hold no business rule: they display and collect; the server decides.
5. The server's clock is the only clock.
6. Nothing merges without green tests, green fitness functions and one review by Zeyad.
7. Until the foundation lands, build against in-memory stand-ins and unit tests.

## Where to read more
- [ARCHITECTURE_RULES.md](ARCHITECTURE_RULES.md): the binding rules, the nine lettered rules A–I, the eleven fitness functions.
- [adr/](adr/README.md): the twelve Architecture Decision Records.
- [docs/TEAM_TASKS.md](docs/TEAM_TASKS.md): every task, its test and its report numbers.
- [docs/UML_Component_Architecture_V3_diagrams.pdf](docs/UML_Component_Architecture_V3_diagrams.pdf): the component diagrams.
- [AGENTS.md](AGENTS.md): instructions for AI coding agents working here.
