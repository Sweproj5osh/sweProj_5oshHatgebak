# Restructure plan: Sayes street parking (a restructure, not a rewrite)

## Context

The repository works (719 tests pass) but has three problems the team wants fixed:

1. **Too much ceremony.** There are fourteen module folders, each split into `public.ts` and `internal/`, plus thirteen
   fitness functions, several of which only guard folder boundaries.
2. **No place for the phone app.** Nothing in the folders, packages or tooling holds a React Native (Expo) app.
3. **A silent in-memory database.** `src/entrypoint/main.ts` calls `composeInMemoryServer`, and every test runs on
   `src/adapters/in-memory/`. The application must run only against a real PostgreSQL named by `POSTGRES_URL`, and must
   refuse to start without it.

The outcome: five area modules (one per owner), one route table of resource-style REST endpoints over HTTPS, PostgreSQL
behind the existing ports with no fallback, one Expo app at `src/apps/mobile`, and every document under `docs/`.
**No business rule, calculation, refusal, state transition, permission, audit behaviour or validation changes.** Code is
moved, renamed, regrouped and rewired; the existing tests, with their expected values untouched, prove it.

Decisions already taken by the user (25 November 2026):
- PostgreSQL stores each module's records **whole, under their key**, in a table inside the module's own schema.
- The fourteen modules become **five area modules**, one per owner.
- **One app for every role**: the first screen asks the role (driver, attendant, inspector, committee).

Anything below marked **BEHAVIOUR CHANGE — needs owner approval** is not done inside a move; it waits for its owner.

---

## 1. Baseline (Step 0, recorded 25 November 2026 on `cd13eae`, branch `Clean`, Node 24.22.3, npm 11.19.1)

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0, no errors |
| `npm test` | Test Files **75 passed, 1 skipped (76)**; Tests **719 passed, 1 skipped (720)**; 1.66 s. The skip is `db/audit-log-is-append-only.test.ts` (no database) |
| `npm run fitness` | **7 passed, 0 failed**: F1 (3 checked), F2 (1012), F8-static (547), F10 (135), F11 (73), F12 (71), F13 (48) |
| CI (`.github/workflows/ci.yml`: `npm ci` → typecheck → test → fitness) | last run on `main`: 44955658377, success, 21 s (merge of #43) |
| Composed registry | 48 operations; `payments.payInApp` is a 49th, registered only by its own tests |
| Demo scripts | not in the type check today; checked by hand: they type-check clean |
| Working tree | uncommitted edits to `.env.example` and `.gitignore` (`*.pdf`); untracked `CLAUDE.md`, `docs/REVAMP_PLANNER_PROMPT.md` |

Step 0 also saves two fingerprints that every later phase is compared against (in the scratch folder, not committed):
- **Test names:** `npx vitest run --reporter=json --outputFile=<scratch>/tests-r0.json`, then
  `jq -r '.testResults[].assertionResults[] | .fullName + " :: " + .status' <scratch>/tests-r0.json | sort > <scratch>/names-r0.txt`.
- **Registry:** a one-line `npx tsx -e` that imports the composition root, calls the registry factory, and prints, for
  every operation in order: kind, name, method, path, roles, scope, logged, body field names and kinds, audit rule,
  rate-limit key. Saved as `<scratch>/registry-r0.json`.

### The gate every phase must pass (called "the gate" below)
```bash
npm ci
npm run typecheck                         # exit 0
npm test                                  # 0 failed; passed ≥ 719; every name in names-r0.txt still present,
                                          # except the tests the phase names as removed or renamed
npm run fitness                           # 0 failed
# Expected values were not edited:
git diff -U0 -M origin/main...HEAD -- '*.test.ts' \
  | grep -E '^[-+].*\.(toBe|toEqual|toStrictEqual|toMatch|toContain|toThrow|toHaveLength|toBeUndefined|toBeGreaterThan)\('
                                          # empty, or every line changes only a URL or an import
```
plus the CI run on the pull request green. From phase R8 on, a PostgreSQL must be running and `POSTGRES_URL` set
(`docker compose -f db/compose.yaml up -d`; `export POSTGRES_URL=postgres://sayes:sayes@localhost:5432/postgres`).

---

## 2. Target layout

```
.
├── README.md · AGENTS.md · CLAUDE.md      stay at the root (tools load them); they point into docs/
├── package.json                           server package AND npm workspaces root: "workspaces": ["src/apps/mobile"]
├── package-lock.json                      one lockfile for server and app
├── tsconfig.base.json                     NEW: the strict compiler options every tsconfig shares
├── tsconfig.json                          server, shared client, fitness, db, demo (extends base; excludes the app)
├── vitest.config.ts                       + globalSetup (PostgreSQL template database, throwaway TLS certificate)
├── .env.example                           POSTGRES_URL, TLS_CERT_PATH, TLS_KEY_PATH, TOKEN_SECRET, SITE_CODE_SECRET, PORT, BOOTSTRAP_CHAIR_*
├── .github/                               ci.yml (PostgreSQL service, app type check and bundle), CODEOWNERS per area, PR template
├── db/
│   ├── compose.yaml                       NEW: local PostgreSQL in Docker (a developer tool, not a runtime dependency)
│   ├── migrations/0001…0004 + 0005_keyed_records_and_adapter_tables.sql
│   └── audit-log-is-append-only.test.ts   fitness function F6; always runs from R8 on
├── demo/                                  the scripts stay; DEMO.md moves to docs/
├── docs/                                  every document (tree in section 2.3)
└── src/
    ├── fitness/                           F1, F10–F14, support/, fixtures/ (fixtures mirror the new paths)
    ├── server/
    │   ├── main.ts                        start-up: POSTGRES_URL and TLS required, migrations checked, HTTPS listener
    │   ├── composition/                   compose-server.ts, bootstrap.ts, foundation-operations.ts
    │   ├── http/                          server.ts (node:https), handle-request.ts, registry.ts (route templates),
    │   │                                  intake, writes, reads, telemetry, audited-execution, audit-redaction,
    │   │                                  internal-failure, rate-limits, unit-of-work-resources, auth/, repeatable-writes/
    │   ├── shared/                        was src/shared (no business rule), with events/
    │   ├── adapters/postgres/             database (keyed records), audit-log store, outbox store, response store,
    │   │                                  rate limiter, migrate.ts
    │   ├── test-support/                  TEST-ONLY: compose-test-application.ts (every stand-in), test-helpers.ts,
    │   │                                  postgres-test-database.ts, global-setup.ts
    │   └── modules/
    │       ├── foundation/                Area 1, Zeyad: audit-log/, scheduler.ts
    │       ├── identity-and-registry/     Area 2, Lino: accounts-and-access-control/, sites-and-areas/,
    │       │                              licensing-assignment-attendance/
    │       ├── parking-and-prices/        Area 3, Karim: ticketing/, committee-prices/ (pure, F1)
    │       ├── money-and-governance/      Area 4, Amina: payments/, cash-custody.ts, approvals.ts, money-check-dashboard.ts
    │       └── messages-and-complaints/   Area 5, Mahi: notifications.ts, evidence.ts, complaints-inspections-ratings.ts
    └── apps/
        ├── shared-client/                 the HTTP client library (+ fetch-handle.ts in R11)
        ├── test-support/                  client fakes, test-only (unchanged)
        └── mobile/                        NEW Expo workspace: package.json, app.config.ts, metro.config.js,
                                           tsconfig.json, index.ts, src/ (role picker, sign-in)
```

Inside a component the `internal/` level goes and `public.ts` becomes `index.ts` with identical content. Example:
```
parking-and-prices/ticketing/
  index.ts                         was public.ts
  tickets-controller.ts            was open-ticket-operation.ts + close-ticket-operation.ts + reading-operations.ts
  assisted-tickets-controller.ts   was assisted-ticket-operations.ts
  ticket-opening.ts, table-ticket-store.ts, …   were internal/*
  testing/ticketing-world.ts       was internal/testing/
  *.test.ts                        beside their code, names unchanged
```

### 2.1 Move map (every current folder)

| Current | New |
|---|---|
| `src/entrypoint/` (pipeline files, `http.ts`, `server.ts`) | `src/server/http/` |
| `src/entrypoint/auth/`, `src/entrypoint/repeatable-writes/` | `src/server/http/auth/`, `src/server/http/repeatable-writes/` |
| `src/entrypoint/operations/registry.ts` | `src/server/http/registry.ts` |
| `src/entrypoint/operations/operation.ts`, re-exports in `src/entrypoint/http.ts` | deleted (transitional shims, QUESTIONS item 15); importers point at `src/server/shared/operation-contract.ts` |
| `src/entrypoint/operations/foundation-operations.ts` | `src/server/composition/foundation-operations.ts` |
| `src/entrypoint/composition.ts` | `src/server/composition/compose-server.ts` (production) + `src/server/test-support/compose-test-application.ts` (the stand-ins, moved verbatim) |
| `src/entrypoint/auth/access-checks.ts` `EVERYONE_IS_LIVE` | `src/server/test-support/` (QUESTIONS item 21: no stand-in left in production code) |
| `src/entrypoint/main.ts`, `bootstrap.ts`, `test-helpers.ts` | `src/server/main.ts`, `src/server/composition/bootstrap.ts`, `src/server/test-support/test-helpers.ts` |
| `src/shared/`, `src/shared/events/` | `src/server/shared/`, `src/server/shared/events/` |
| `src/adapters/in-memory/` | `src/server/adapters/in-memory/` in R4, **deleted** in R10 |
| (new) | `src/server/adapters/postgres/` (R8) |
| `src/modules/audit-log/` | `src/server/modules/foundation/audit-log/` |
| `src/modules/scheduler/public.ts` | `src/server/modules/foundation/scheduler.ts` |
| `src/modules/accounts-and-access-control/` | `src/server/modules/identity-and-registry/accounts-and-access-control/` |
| `src/modules/sites-and-areas/` | `src/server/modules/identity-and-registry/sites-and-areas/` |
| `src/modules/licensing-assignment-attendance/` | `src/server/modules/identity-and-registry/licensing-assignment-attendance/` |
| `src/modules/ticketing/` | `src/server/modules/parking-and-prices/ticketing/` |
| `src/modules/committee-prices/` | `src/server/modules/parking-and-prices/committee-prices/` |
| `src/modules/payments/` (`internal/operations/`, `adapters/`, `test-support/`) | `src/server/modules/money-and-governance/payments/` (`payments-controller.ts`, `adapters/`, `testing/`) |
| `src/modules/cash-custody/`, `approvals/`, `money-check-dashboard/` (type-only `public.ts` + `.gitkeep`) | `src/server/modules/money-and-governance/<name>.ts` |
| `src/modules/notifications/`, `evidence/`, `complaints-inspections-ratings/` (type-only) | `src/server/modules/messages-and-complaints/<name>.ts` |
| inside every component: `internal/x.ts`, `internal/adapters/`, `internal/domain/`, `internal/testing/` | `x.ts`, `adapters/`, `domain/`, `testing/` |
| `src/fitness/` (+ `support/`, `fixtures/`) | stays; fixtures re-laid to the new paths; `fixtures/README.md` → docs |
| `src/apps/shared-client/`, `src/apps/test-support/` | stay |
| (new) | `src/apps/mobile/` |
| `db/migrations/`, `db/audit-log-is-append-only.test.ts` | stay (+ `0005`, + `db/compose.yaml`) |
| `demo/*.ts`, `demo/run-all.sh` | stay; `demo/DEMO.md` → `docs/demo/DEMO.md` |
| `adr/` | `docs/adr/` |
| `ARCHITECTURE_RULES.md`, `MODULES.md`, `QUESTIONS.md` | `docs/rules/ARCHITECTURE_RULES.md`, `docs/architecture/modules.md`, `docs/team/QUESTIONS.md` |
| `docs/TEAM_TASKS.md`, `docs/TEST_REPORT_2026-11-07.md` | `docs/team/` |
| `docs/UML_Component_Architecture_V3_diagrams.pdf` | `docs/pdf/` |
| root PDFs (untracked: "Team task sheet.pdf", "Handoff - Teammate A - Identity and registry.pdf") | `docs/pdf/` if the team says so (open question 15) |

### 2.2 Packages, TypeScript configuration and the shared client

- **npm workspaces**, root = the server package, one workspace `src/apps/mobile`. Why: built into npm 11 (no new tool),
  one lockfile, one `npm ci`, and current Expo versions detect npm workspaces and configure the Metro bundler for them.
  The server stays at the root so every existing command (`npm test`, `npm run fitness`, CI) keeps its meaning.
  Rejected: a separate npm project for the app (two lockfiles, two installs); pnpm, Yarn, Turborepo or Nx (new tools
  for two packages).
- **`tsconfig.base.json`**: today's strict options (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `isolatedModules`, `moduleResolution: Bundler`, …). **Root `tsconfig.json`** extends it with `lib: ES2023`,
  `types: ["node"]`, includes `src/server`, `src/apps/shared-client`, `src/apps/test-support`, `src/fitness`, `db`,
  `demo` (demo is new to the check and passes today), excludes `src/apps/mobile` and the fixtures.
  **`src/apps/mobile/tsconfig.json`** extends `expo/tsconfig.base` and the base file, adds the path alias
  `@sayes/shared-client/*` → `../shared-client/*`, and includes the shared client without Node types, so a Node-only
  global in the client fails the app's type check. `npm run typecheck` runs both projects.
- **Sharing `src/apps/shared-client`**: it stays a folder of the root package. Server-side tests keep importing it by
  relative path (no change). The app imports it through the alias (Expo reads `tsconfig` paths) and Metro's
  `watchFolders` includes `src/apps/shared-client` and `src/server/shared`: the client's only runtime import from
  outside itself is `src/server/shared/request-id.ts` (pure); its other imports are type-only and vanish when bundled.
  The CI bundle step (`expo export`) fails loudly if a Node-only import ever sneaks in. Rejected: making the client its
  own workspace package, which would need `request-id.ts` duplicated or a third package.
- `vitest.config.ts` includes only server, shared-client, test-support, fitness and db tests (never the app).

### 2.3 The `docs/` tree

```
docs/
├── README.md                          NEW: index of everything below
├── rules/ARCHITECTURE_RULES.md        was /ARCHITECTURE_RULES.md
├── architecture/
│   ├── overview.md                    NEW: the deployable units, the five areas, how a request travels (out of README)
│   ├── modules.md                     was /MODULES.md; rows per area and component
│   ├── controllers-and-endpoints.md   NEW: the controller pattern and the pipeline order (section 3)
│   ├── rest-routes.md                 NEW: the route catalogue (section 3.2, kept current)
│   └── fitness-functions.md           NEW: F1–F14 kept and dropped (section 5) + was src/fitness/fixtures/README.md
├── setup/
│   ├── database.md                    NEW: POSTGRES_URL, Docker, migrations, test databases
│   ├── https.md                       NEW: certificates locally, in CI, in production
│   └── mobile-app.md                  NEW: the Expo workspace and running the app
├── adr/                               was /adr/: README, ADR-01…ADR-15, new ADR-16…ADR-22
├── team/                              TEAM_TASKS.md (+ rows R0–R11), QUESTIONS.md, TEST_REPORT_2026-11-07.md,
│                                      RESTRUCTURE_PLAN.md (this plan)
├── demo/DEMO.md                       was demo/DEMO.md
└── pdf/                               the UML diagrams (+ the root PDFs if the team agrees)
```
`.github/pull_request_template.md` stays where GitHub loads it, like the three root files. `CLAUDE.md` is kept as it is
(committed in R1) and its links follow the moves.

---

## 3. Controllers, endpoints and HTTPS

### 3.1 The pattern (smallest change that gives one controller per resource and one explicit endpoint per operation)
- An operation object keeps everything it declares today (kind, name, roles, scope, schema, audit rule, examples,
  fixture, `handle`); its `method` and `path` become the REST endpoint, and `path` may hold parameters
  (`/tickets/:ticketId/closure`). The operation's `handle` already is the thin controller action: it parses the
  validated input, calls the module's service unchanged, and maps the result to `respond` or `refuse`.
- **A controller is one file per REST resource**, inside the component that owns the operations (ownership stays
  per area, as today's P4 rule). The component's `operations(dependencies)` returns the operations **in exactly
  today's order**, so `composeRegistry`, the permission table and the F5 harness see the same sequence.
- **Router**: `OperationRegistry.find(method, path)` matches templates (static segments win over parameters; two
  equivalent templates are refused at start-up, as duplicate routes are today) and returns the path parameters.
- **Pipeline order is unchanged** (`handle-request.ts`): route lookup only to spot a public operation → token and expiry
  → live status → 404 for an unknown route → permission table (open reads skip it, as today) → kind pipeline. Path
  parameters are merged right before the kind pipeline: **into `query` for reads**, **into the body for writes, public
  writes and telemetry**, so the server-clock rule, the body schema, the body hash, the repeat check, read scopes
  (`siteId`/`zoneId`/`districtId`), the audit input and every handler see exactly today's input. Request ids, the server
  clock, rate limits, the audited unit of work, telemetry and logged reads are untouched.
- `PATCH` is added to `HttpMethod` and to the server's method list. A known path with the wrong method still answers
  404 after the token check (no 405 is introduced).
- **BEHAVIOUR CHANGE — needs owner approval (Zeyad):** a body that repeats a field the path already names (for example
  `ticketId` in both) is refused with 400 through the existing "body does not match the operation schema" answer.

### 3.2 REST route table (status codes stay exactly as today)

Client constants live in `src/apps/shared-client/*/*-routes.ts`; `—` means no client constant exists today.
Paths are templates; the client fills them with a small `pathWith(template, values)` helper (encodes each value).

| # | Operation (kind) | Today | New | Controller (in the owning component) | Client constant |
|---|---|---|---|---|---|
| 1 | requestSignInCode (public) | POST /sign-in/code | POST /sign-in-codes | accounts…/sign-in-controller.ts | DRIVER_REQUEST_CODE_PATH |
| 2 | signIn (public) | POST /sign-in | POST /sessions | sign-in-controller.ts | DRIVER_SIGN_IN_PATH |
| 3 | signIn, second step (public) | POST /sign-in/committee | POST /committee-sessions | sign-in-controller.ts | — |
| 4 | personalData.createPerson | POST /people | POST /people (unchanged) | people-controller.ts | — |
| 5 | signIn.setCommitteePassword | POST /committee/password | PUT /people/:personId/committee-password | people-controller.ts | — |
| 6 | personalData.erase | POST /people/erasure | DELETE /people/:personId/personal-data | people-controller.ts | — |
| 7 | personalData.addCar | POST /cars | POST /cars (unchanged) | cars-controller.ts | DRIVER_CARS_PATH |
| 8 | personalData.ownCars (read, own) | GET /cars | GET /cars (unchanged) | cars-controller.ts | DRIVER_CARS_PATH |
| 9 | personalData.lookUpPlate (logged, staff) | GET /plates/look-up?carRef&siteId | GET /cars/:carRef/plate?siteId | cars-controller.ts | — |
| 10 | audit.readByScope | GET /audit-log | unchanged | foundation/audit-log/audit-log-controller.ts | — |
| 11 | audit.verifyChain | GET /audit-log/verification | unchanged | audit-log-controller.ts | — |
| 12 | assignments.assignAttendant | POST /assignments/attendants | POST /attendant-assignments | licensing…/assignments-controller.ts | — |
| 13 | assignments.changeShift | POST /assignments/attendants/shift | PATCH /attendant-assignments/:attendantId | assignments-controller.ts | — |
| 14 | assignments.releaseAttendant | POST /assignments/attendants/release | DELETE /attendant-assignments/:attendantId | assignments-controller.ts | — |
| 15 | assignments.assignInspector | POST /assignments/inspectors | PUT /inspector-assignments/:inspectorId | assignments-controller.ts | — |
| 16 | assignments.appointMember | POST /assignments/members | PUT /member-appointments/:memberId | assignments-controller.ts | — |
| 17 | licences.issue | POST /licences | unchanged | licences-controller.ts | — |
| 18 | licences.status (staff) | GET /licences/status?attendantId | GET /attendants/:attendantId/licence | licences-controller.ts | — |
| 19 | attendance.clockIn | POST /attendance/clock-in | POST /attendances | attendance-controller.ts | ATTENDANT_CLOCK_IN_PATH |
| 20 | attendance.clockOut | POST /attendance/clock-out | PATCH /attendances/current | attendance-controller.ts | — |
| 21 | attendance.recordLocation (telemetry) | POST /attendance/location-readings | POST /location-readings | attendance-controller.ts | — |
| 22 | attendance.offSiteFlags (staff) | GET /attendance/off-site-flags?zoneId | GET /off-site-flags?zoneId | attendance-controller.ts | — |
| 23 | sites.createDistrict | POST /districts | unchanged | sites…/districts-controller.ts | — |
| 24 | sites.relabelDistrict | POST /districts/label | PATCH /districts/:districtId | districts-controller.ts | — |
| 25 | sites.createZone | POST /zones | unchanged | zones-controller.ts | — |
| 26 | sites.relabelZone | POST /zones/label | PATCH /zones/:zoneId | zones-controller.ts | — |
| 27 | sites.createSite | POST /sites | unchanged | sites-controller.ts | — |
| 28 | sites.replaceOutline | POST /sites/outline | PUT /sites/:siteId/outline | sites-controller.ts | — |
| 29 | sites.changeCapacity | POST /sites/capacity | POST /sites/:siteId/capacity-changes | sites-controller.ts | — |
| 30 | sites.setWeeklyHours | POST /sites/hours | PUT /sites/:siteId/opening-hours | sites-controller.ts | — |
| 31 | sites.declareSpecialEvent | POST /sites/special-events | POST /sites/:siteId/special-events | sites-controller.ts | — |
| 32 | sites.statusNow (open) | GET /sites/status?siteId | GET /sites/:siteId/status | sites-controller.ts | — |
| 33 | sites.nearby (open) | GET /sites/nearby?latitude&longitude&radius | GET /sites?latitude&longitude&radius | sites-controller.ts | DRIVER_MAP_NEARBY_PATH |
| 34 | sites.capacityHistory (staff) | GET /sites/capacity-history?siteId | GET /sites/:siteId/capacity-changes | sites-controller.ts | — |
| 35 | sites.details (open) | GET /sites/details?siteId | GET /sites/:siteId | sites-controller.ts | — |
| 36 | ticketing.openTicket | POST /tickets/open | POST /tickets | ticketing/tickets-controller.ts | DRIVER_OPEN_TICKET_PATH |
| 37 | ticketing.closeTicket | POST /tickets/close | POST /tickets/:ticketId/closure | tickets-controller.ts | DRIVER_CLOSE_TICKET_PATH |
| 38 | ticketing.openAssistedTicket | POST /tickets/open-assisted | POST /assisted-tickets | assisted-tickets-controller.ts | — |
| 39 | ticketing.closeAssistedTicket | POST /tickets/close-assisted | POST /assisted-tickets/:ticketId/closure | assisted-tickets-controller.ts | — |
| 40 | ticketing.ticketHistory (own) | GET /tickets | unchanged | tickets-controller.ts | — |
| 41 | ticketing.ticketStatus (own) | GET /tickets/status?ticketId | GET /tickets/:ticketId | tickets-controller.ts | — |
| 42 | ticketing.receipt (own, logged) | GET /tickets/receipt?ticketId | GET /tickets/:ticketId/receipt | tickets-controller.ts | DRIVER_RECEIPT_PATH |
| 43 | ticketing.freeSpaces (open) | GET /tickets/free-spaces?siteId | GET /sites/:siteId/free-spaces | tickets-controller.ts | — |
| 44 | payments.payInApp (not composed today) | POST /payments/app | POST /tickets/:ticketId/payments | payments/payments-controller.ts | DRIVER_PAY_PATH |
| 45–49 | example.* (five foundation writes) | POST /example/tickets, /cash-ticks, /deposit-confirmations, /requests, /approvals | unchanged (already nouns) | composition/foundation-operations.ts | — |

Rule used: a path that is already a noun keeps its URL; a verb path becomes a noun plus a method; an id moves into the
path when the operation acts on one existing resource. Methods follow today's semantics (a refused "second site" stays
POST; a replaceable value is PUT; a partial change is PATCH; a release is DELETE). The `*_OPERATION` client constants
keep their values (operation names do not change).

### 3.3 HTTPS (Transport Layer Security, TLS)
- The server listens with Node's built-in `node:https` only (no new dependency). `main.ts` reads `TLS_CERT_PATH` and
  `TLS_KEY_PATH`; either missing or unreadable stops start-up with a clear message. There is no plain-HTTP listener
  and no redirect listener.
- **Locally:** a developer creates a certificate with `mkcert` or `openssl` (developer tools, documented in
  `docs/setup/https.md`); emulators and simulators trust it by installing the local root certificate.
- **Continuous integration (CI) and tests:** almost every test calls the pipeline in-process, so nothing changes for
  them. The HTTPS adapter test (`server.test.ts`) uses a throwaway certificate that the vitest global set-up creates
  with `openssl` and trusts it explicitly (`ca`), never by switching verification off.
- **Production:** the server holds its own certificate. If the chosen host terminates TLS at its edge, the edge must
  re-encrypt to the server, so plain HTTP never reaches the API (open question 8). No provider is named (ADR-11).

---

## 4. Phases

Branches: `area-a/r<N>-<short-name>` (Lino drives the restructure; see open question 3), never `main`, one pull request
per phase, squash-merged after Zeyad's review. Every phase runs **the gate** (section 1). Each phase updates the
documents it changes, in the same pull request (CLAUDE.md rule 3). Task ids R0–R11 are added to
`docs/team/TEAM_TASKS.md` in R1.

**How owners approve (AGENTS.md rule 3):** every pull request lists the areas it touches under "Approvals needed".
The agent edits another area's files only inside a phase that area's owner has approved in that pull request. R4 and
each R5 pull request add `.github/CODEOWNERS` lines mapping the moved folders to their owner, so GitHub asks the right
person automatically (needs the GitHub names, open question 2). Zeyad reviews every pull request (rule 12.4).

### R0 — Baseline (commands only, no pull request)
- Goal: section 1, recorded before anything moves. The results go into the plan document committed in R1.
- Keep the pending local edits (`.env.example` quoting, `.gitignore` `*.pdf`) out of every branch until open question 15 is answered.

### R1 — Decision records ADR-16 … ADR-22 (section 6), written first
- Why first: moving the documents changes paths the rules file cites, and rules §16 refuses a rule change before its
  record exists.
- Files: `adr/ADR-16…22` (status Proposed, then Accepted), `adr/README.md`, amendment notes appended to ADR-02, -03,
  -05, -11, -13, -15; this plan as `docs/RESTRUCTURE_PLAN.md` with the R0 numbers; R0–R11 rows in `docs/TEAM_TASKS.md`;
  `CLAUDE.md` committed.
- Approve: **Zeyad decides each record**; every owner reviews ADR-16 (their folders move) and ADR-21 (their stores);
  Lino reviews ADR-18 (sign-in flow); Mahi reviews ADR-17, ADR-18, ADR-20 (apps).
- Each later phase starts only when its records are Accepted (AGENTS.md rule 7, rules §16).
- Verify: the gate, counts **identical** to the baseline (719/1, 7/7). Rollback: revert.

### R2 — Documents into `docs/` (pure moves; needs ADR-17)
- Files: every move in sections 2.1 and 2.3 that concerns a document; links in `README.md`, `AGENTS.md`, `CLAUDE.md`,
  `docs/adr/README.md`, the rules file; the comment lines of the 14 source files that cite `QUESTIONS.md`,
  `ARCHITECTURE_RULES.md`, `MODULES.md`, `adr/`, `TEAM_TASKS.md` or `DEMO.md` (comment text only).
- Approve: Zeyad; each owner for the comment lines in their area.
- Verify: the gate, counts **identical** to the baseline;
  `git ls-files '*.md' | grep -v '^docs/'` → only `README.md`, `AGENTS.md`, `CLAUDE.md`,
  `.github/pull_request_template.md`; `git grep -nE '\]\((\.\./)*(ARCHITECTURE_RULES|MODULES|QUESTIONS)\.md|\]\((\.\./)*adr/|demo/DEMO\.md'` → no old target.
- Rollback: `git revert` of the squash commit (documents only).

### R3 — Fitness set reduced (needs ADR-16)
- Goal: section 5. Drop F2 and F8-static (and `module-sets.ts`; F1's module name moves into F1). Add **F14** with the
  existing `import-scanner.ts` and `defineFitnessFunction`, plus three planted-violation fixtures.
- Files: `src/fitness/*`, `src/fitness/fixtures/*`, `fitness-functions.test.ts`, rules §6 and §14, `docs/architecture/fitness-functions.md`.
- Approve: Zeyad.
- Verify: the gate; `npm run fitness` → **6 passed** (F1, F10, F11, F12, F13, F14); tests stay **719**: the three
  removed proofs ("F2 catches an import of another module's internal file", "F2 catches a module importing the entry
  point", "F8 catches a must-stay-on module importing a may-fail module") are replaced by three F14 proofs.
- Rollback: revert.

### R4 — Foundation folders move (pure moves; needs ADR-16)
- Goal: `src/entrypoint`, `src/shared`, `src/adapters` → `src/server/{http,composition,shared,adapters}`;
  `main.ts` → `src/server/main.ts`; delete the two transitional shims; split `composition.ts`: production
  `compose-server.ts` (exports `composeRegistry`, `composeInMemoryServer` for now, `composeDeclaredRegistry` replacing
  `composeInMemoryRegistry`, and the shared `compose(options, standIns)`), test-only `compose-test-application.ts`
  holding every stand-in **moved verbatim**; tsconfig `tsconfig.base.json` split and `demo/` added to the check;
  vitest includes; `package.json` `start` script; CODEOWNERS for foundation folders.
- Files: every import of `src/shared`/`src/entrypoint` in every area (import lines only), F11–F13 loader path and
  export name (`src/fitness/support/composed-operations.ts`) and their fixtures, `test-support-is-for-tests-only.test.ts`
  path constants, demos' imports.
- Approve: Zeyad and every owner (import lines in their files).
- Verify: the gate with counts identical to R3; registry fingerprint diff **empty**;
  `git diff -M --stat origin/main...HEAD` shows renames; `git grep -n "src/entrypoint\|from '.*shared/" -- src | grep -v server/shared` → nothing stale;
  `grep -rn "new SerialQueue\|new KeyedSerialQueue\|new TableTicketStore\|createHashChainedAuditTrail(" src` → same count and
  same enclosing functions as before (risk 3).
- Rollback: revert (one commit; no data).

### R5.1 – R5.5 — One area per pull request (pure moves; needs ADR-16)
- R5.1 Area 1 (Zeyad): audit-log, scheduler. R5.2 Area 2 (Lino): accounts, sites, licensing. R5.3 Area 3 (Karim):
  ticketing, committee-prices. R5.4 Area 4 (Amina): payments + three type-only shells. R5.5 Area 5 (Mahi): three
  type-only shells.
- Goal: `src/modules/<m>` → `src/server/modules/<area>/<component>`; flatten `internal/`; `public.ts` → `index.ts`
  (identical content); operation files split into the per-resource controller files of section 3.2 (same operation
  objects, same order from `operations(dependencies)`); `composeRegistry` imports updated **without reordering**;
  F1 path (R5.3); fixtures that mirror the moved paths; that area's rows in `docs/architecture/modules.md` and rules §5;
  CODEOWNERS line for the area.
- Approve: that area's owner and Zeyad (composition imports).
- Verify: the gate, counts identical; registry fingerprint diff **empty** (catches any reordering);
  `test -z "$(git ls-files 'src/modules/<m>/*')"`.
- Rollback: revert that area's commit only; revert later areas first if they built on it.

### R6 — REST routes (needs ADR-22)
- Goal: section 3.1 and the table in 3.2, client and server in one pull request so they never disagree.
- Files: `src/server/shared/operation-contract.ts` (PATCH), `src/server/http/{server.ts,registry.ts,handle-request.ts}`,
  every controller's `method`/`path` values (the assignment helper gains a `method` field), the client route constants
  and the three adapters whose ids move into the path (close ticket, receipt, pay) + `pathWith` with one small test,
  test request builders (`test-helpers.ts`; the F5 harness fills a template from the operation's sample body or query),
  test URLs, demo paths, `docs/architecture/{controllers-and-endpoints,rest-routes}.md`, rules §8, `docs/demo/DEMO.md`.
- Approve: Zeyad, every owner (their routes), Mahi (client library).
- Verify: the gate (passed ≥ 719 + the new `pathWith` test); registry fingerprint diff shows **only method and path**;
  tests that assert the request a client sends may lose an id field that moved into the URL — each such line is listed
  in the pull request; `./demo/run-all.sh` → every PASS; `git grep -nE "'/(sign-in/code|tickets/open|tickets/close|payments/app|tickets/receipt|sites/nearby|attendance/clock-in)'"` → nothing.
- Rollback: revert (client and server go back together).

### R7 — HTTPS only (needs ADR-22)
- Files: `src/server/http/server.ts` (`node:https`), `src/server/main.ts`, `server.test.ts` (set-up only), vitest global
  set-up (throwaway certificate), `.env.example`, `docs/setup/https.md`, rules §11.
- Approve: Zeyad; Mahi informed (the app must use `https://`).
- Verify: the gate; `npm start` without TLS variables → exits 1 naming the variables; with them,
  `curl --cacert <cert> https://localhost:3000/audit-log` → 401; `curl http://localhost:3000/audit-log` → no HTTP answer.
- Rollback: revert.

### R8 — PostgreSQL adapters beside the in-memory ones (additive; needs ADR-19, ADR-21)
- Goal: PostgreSQL implementations of the existing ports, unchanged interfaces, proven equal by the existing adapter
  tests run against both. The application still runs in memory in this phase.
- Files: `package.json` (`pg`, `@types/pg`), `src/server/adapters/postgres/*`, `db/migrations/0005_…sql`,
  `db/compose.yaml`, `npm run db:migrate`, the in-memory adapter tests turned into contract tests
  (`describe.each([inMemory, postgres])`, same expected values), the outbox-job and audit-trail tests also run on the
  PostgreSQL stores, CI (`services: postgres`, `POSTGRES_URL`), **rename `DATABASE_URL` → `POSTGRES_URL`** (db test,
  `.env.example`, README, docs), storage keys `ticketing_tickets`/`ticketing_request_keys`/`foundation_example_actions`
  renamed to `ticketing.tickets`/`ticketing.request_keys`/`foundation.example_actions` so every record lands in its
  owner's schema, `docs/setup/database.md`.
- Adapter design (all behind today's interfaces):
  - **Database (`TableAccess` + `begin()`):** `'<schema>.<table>'` → `<schema>.records(record_table, record_key,
    position identity, record json)`; schema from an allow-list (unknown → error); `json`, not `jsonb`, so key order
    and text round-trip exactly; `list` orders by `position` (insertion order, replace keeps the place); insert uses
    `ON CONFLICT DO NOTHING` and throws today's message ("Table … already holds a row with the key …") with the
    transaction still usable, as in memory; replace and remove of a missing key throw today's messages; any
    `audit_log` name is refused with today's message; `begin()` stays synchronous: the connection is taken and `BEGIN`
    sent at the first statement; READ COMMITTED, which matches the in-memory "staged changes over live committed rows".
  - **Audit-log store:** the typed `audit_log.audit_log` and `audit_log.head` tables; `lastRecord()` inside a unit of
    work first takes `pg_advisory_xact_lock(<constant>)`; the record read back is exactly the one hashed (bigint → number,
    NULL → absent, timestamp → the same ISO string).
  - **Outbox store:** `foundation.outbox`; the publisher keeps `publish()` synchronous by buffering inside the unit of
    work (id and `publishedAt` stamped at publish time from the server clock) and inserting before the audit append and
    commit; `undelivered()` in publish order.
  - **Response store:** `foundation.write_responses` + the body hash; the stored response comes back byte-identical.
  - **Rate limiter:** `foundation.rate_limit_attempts`; one key at a time under a transaction-scoped advisory lock;
    times only from the injected clock; old attempts of the key removed as the in-memory filter drops them.
  - **Migration 0005** (additive, Zeyad's): the `records` tables for the seven schemas in use, their grants to
    `sayes_application` (select, insert, update, delete), `write_responses.body_hash` (and `body` as `json`, nullable),
    `rate_limit_attempts`, `outbox.position`, `audit_log.subject_person_ids` nullable without default (absent ≠ empty
    list), `foundation.schema_migrations`. Column names avoid "name", "plate" and "phone" (F10). No `UPDATE` or `DELETE`
    on `audit_log`, ever. The runner records applied files (0003 cannot run twice).
- Approve: Zeyad (adapters, migration, CI); Karim (two ticketing storage keys).
- Verify: the gate with PostgreSQL; contract tests pass for both adapters (their names gain the adapter label, listed as
  renamed); `db/audit-log-is-append-only.test.ts` **runs** (0 skipped); passed = 719 + 1 (F6 no longer skipped) + the
  PostgreSQL copies of the adapter tests; `npm run db:migrate`
  twice → the second run applies nothing; `npm run fitness` → 6 passed (F10 reads 0005).
- Rollback: revert the code; 0005 only adds empty tables, nothing reads them after the revert.

### R9 — The test suite on PostgreSQL (the riskiest step, alone; needs ADR-21)
- Goal: every test that used the in-memory database now uses a real PostgreSQL; nothing else changes.
- Isolation: the vitest global set-up refuses to run without `POSTGRES_URL` (clear message), creates a template
  database once per run, applies 0001–0005 to it, and creates a login role that is a member of `sayes_application`.
  Every `composeTestApplication()` and every module test world gets **its own fresh database** cloned from the template
  (`CREATE DATABASE … TEMPLATE …`), connected as that role so the audit grants hold in every test. This keeps today's
  "fresh empty database per composition" exactly. Pools close after each file; the run's databases are dropped at the
  end. Truncating between tests is rejected: it would mean deleting from `audit_log`.
- Files: `src/server/test-support/{global-setup,postgres-test-database,compose-test-application,test-helpers}.ts`,
  `vitest.config.ts`, set-up lines of every test that composes an application or a world (they become `await`),
  the five module worlds, demos 02, 03 and the known-gap script (they use the test composition).
- The two tamper proofs (audit-trail test, demo 03) edit records underneath the log; they keep running over a
  test-only array-backed `AuditLogStore` beside the test (open question 4), never through `UPDATE`/`DELETE`.
- Approve: Zeyad and every owner (their test set-up).
- Verify: the gate, three consecutive runs with identical counts; suite duration recorded against the 1.66 s baseline;
  `git grep -n "adapters/in-memory" -- 'src/**/*.test.ts' 'src/**/testing/**' 'src/server/test-support/**'` → only the
  contract test; `env -u POSTGRES_URL npm test` → stops at set-up with the message.
- Rollback: revert (the in-memory adapters still exist).

### R10 — The server on PostgreSQL only; the in-memory adapters deleted (needs ADR-21)
- Goal: `main.ts` composes `composeServer` over PostgreSQL. Start-up stops with a clear error when `POSTGRES_URL` is
  missing, when the database does not answer within a few seconds, or when a migration in `db/migrations` is not
  applied. `composeInMemoryServer` and `src/server/adapters/in-memory/` are deleted; contract tests keep only the
  PostgreSQL case (same expected values); demo 01 runs on PostgreSQL; F14 now also forbids any import of an
  in-memory adapter.
- Files: `src/server/main.ts`, `compose-server.ts`, the deleted folder, contract tests, F14, README "Running things",
  `docs/setup/database.md`, rules §9 and §11, `.env.example`.
- Approve: Zeyad; every owner informed.
- Verify: the gate (passed ≥ 720, 0 skipped); `env -u POSTGRES_URL npm start` → exit 1 "POSTGRES_URL must be set";
  `POSTGRES_URL=postgres://nobody@127.0.0.1:1/none npm start` → exit 1 "cannot reach PostgreSQL" (no password printed);
  an empty database → exit 1 naming `npm run db:migrate`; `test ! -e src/server/adapters/in-memory`;
  `git grep -n "InMemoryDatabase\|InMemoryAuditLogStore\|InMemoryOutboxStore\|InMemoryResponseStore\|InMemorySlidingWindowRateLimiter"` → nothing;
  `./demo/run-all.sh` → every PASS; `npx tsx demo/known-gap-parallel-requests.ts` → number recorded (risk 15).
- Rollback: revert restores the deleted files and the in-memory start-up.

### R11 — The Expo app workspace (needs ADR-17, ADR-18, ADR-20)
- Goal: a place for the frontend and a shell that proves the sharing works: the first screen asks the role (driver,
  attendant, inspector, committee); the choice only selects the sign-in flow (`POST /sessions`, or
  `POST /committee-sessions` with the password); everything else is the server's decision (Rule A). Request ids come
  from `new RequestIdKeeper(randomUUID)` with expo-crypto's `randomUUID` (the constructor parameter already exists;
  the phone's JavaScript engine has no `crypto.randomUUID`). The role screens themselves stay Area 5's tasks (D1–D9).
- Files: root `package.json` (`workspaces`), lockfile, `src/apps/mobile/{package.json,app.config.ts,metro.config.js,tsconfig.json,index.ts,src/*}`,
  `src/apps/shared-client/fetch-handle.ts` (the `EntryPointHandle` over `fetch`, with one test against the HTTPS test
  server, which also proves client and server agree on routes over TLS), CI job (app type check +
  `npx expo export --platform android`), `docs/setup/mobile-app.md`.
- Approve: Mahi (Area 5) and Zeyad; Lino for the use of sign-in.
- **BEHAVIOUR CHANGE — needs owner approval (Lino, Zeyad), not planned here:** sending the chosen role to the server
  and refusing a mismatch would add a field and a refusal to `signIn`.
- Verify: the gate; `npm run typecheck` covers both projects; the bundle builds in CI; `npx expo start` reaches the role
  screen on a simulator and signs a driver in against a local HTTPS server.
- Rollback: revert (the server is untouched by this phase).

---

## 5. Fitness functions

| | What it checks | Decision | Why |
|---|---|---|---|
| F1 | committee-prices production files import nothing outside their folder | **Keep** (path moves) | pure fee calculation, Rule C |
| F2 | cross-module imports only through `public.ts`; modules and apps never import the entry point | **Drop**; its one non-boundary concern **merges into F14** | the `public.ts`/`internal/` split is gone; it guards folders, not a business rule |
| F3 | twenty parallel opens on five spaces give five tickets | **Keep** (test; runs on PostgreSQL from R9) | integrity: never more tickets than spaces |
| F4 | fee never above the cap for any input | **Keep** (test) | integrity of the fee |
| F5 | one audit entry per successful write, none per failure or telemetry, logged personal reads | **Keep** (test; sample URL from the template) | accountability, the audit log |
| F6 | the application role cannot update or delete `audit_log`; the chain verifies | **Keep**; always runs from R8 (never skipped) and applies every migration | append-only audit log |
| F7 | the same request id twice gives the same answer and one change | **Keep** (tests; PostgreSQL response store) | repeatable writes, Rule H |
| F8 | no import from must-stay-on into may-fail | **Drop the static half**; the guarantee stays with the behavioural test Z14 (F8-behavioural) and review of Rule D | an import boundary; the may-fail components are type-only shells today, so it guards nothing yet |
| F9 | the suite passes with the assistant stopped | **Keep as planned** (Z15, D20; not built) | assistant isolation |
| F10 | no plate, phone or name column outside `personal_data` | **Keep** | personal data stays in its own store (Law 151, Rule F) |
| F11 | no timestamp field in a body schema; calendar times only on committee operations | **Keep** | no timestamp accepted from a client |
| F12 | every personal field in a write has a redaction rule | **Keep** | personal-data redaction |
| F13 | only `requestSignInCode` and `signIn` are public | **Keep** | sign-in is the only public operation |
| F14 | NEW: no production file imports test-only code (`*.test.ts`, `test-support/`, `testing/`, `src/fitness`), and the composition root imports no adapter but the PostgreSQL ones (from R10: no in-memory adapter anywhere) | **Add** | proves the running application cannot reach a stand-in or in-memory code |

`npm run fitness` goes from 7 to 6 static functions. The existing unit tests `test-support-is-for-tests-only.test.ts` and
`module-imports.test.ts` stay (paths updated).

---

## 6. Decision records

New (all "Proposed" in R2; Zeyad decides each):

| ADR | Decision | Needed before | Effect on older records |
|---|---|---|---|
| ADR-16 | Five area modules replace fourteen module folders; the `public.ts`/`internal/` split goes; F2 and F8-static dropped, F14 added | R3–R5 | **amends ADR-02** (consequence "fourteen public interfaces and F2") and **ADR-03** (the build-time boundary check; one deployable unit and Rule D stay) |
| ADR-17 | One repository with npm workspaces: server at the root, the Expo app at `src/apps/mobile`, the shared client through a path alias; every document under `docs/` | R2 (documents), R11 | none |
| ADR-18 | One app for every role; the first screen asks the role and selects the sign-in flow; the server still decides the role | R11 | **supersedes ADR-05** (two apps, staff-only web build) |
| ADR-19 | Runtime dependency: the PostgreSQL driver `pg` (one paragraph, AGENTS.md rule 7) | R8 | none |
| ADR-20 | Runtime dependencies of the app: `expo`, `react`, `react-native`, `expo-crypto` (each named, with why) | R11 | none |
| ADR-21 | PostgreSQL only through `POSTGRES_URL`; no in-memory adapters; tests on a real database, one cloned database per composition; records stored whole under their key in their schema; migration 0005 | R8–R10 | **amends ADR-11** (consequence "tests run against in-memory adapters"), **ADR-13** (the in-memory database text; PostgreSQL implements `Transaction` with a lazy begin and the advisory lock), **ADR-15** (the shared rate-limiter store now exists); rules §11 |
| ADR-22 | Resource-style REST routes, one controller file per resource, path parameters merged into the body or query; HTTPS only through `node:https` | R6, R7 | **amends ADR-15** (the two sign-in paths and the committee path change; F13 unchanged) and rules §8 and §11; ADR-07 and ADR-10 unchanged (one entry point, token before route) |

---

## 7. Risks (where a move could quietly change behaviour) and how each is checked

1. **Import side effects and evaluation order** (flattening, `public.ts` → `index.ts`, circular type imports between an
   index and its files): index content kept byte-identical; type check, full suite and registry fingerprint per phase.
2. **Registration order in `composeRegistry`** (today: accounts, audit-log, licensing, sites, ticketing, foundation,
   additional): kept explicitly, never re-sorted by area name; the registry fingerprint diff catches any reorder.
3. **Serial queues and their instance boundaries** (`chainCommits` per composition, `TableTicketStore.oneStepAtATime`
   per store instance, `HashChainedAuditTrail.appends` per trail, a new trail per unit of work, `KeyedSerialQueue` for
   repeats): construction stays in the same functions; checked by the grep in R4 and the concurrency tests.
4. **Advisory lock**: must be taken before the last record is read, inside the write's transaction; checked by the
   five-concurrent-writes test on PostgreSQL and a two-server-copies test (two compositions, one database, verify the
   chain afterwards).
5. **Clock injection**: no adapter uses SQL `now()`, a column default or `new Date()`; every time comes from the
   injected clock (fixed-clock tests of rate limits, token expiry and sign-in lock-out prove it); `grep` adapters in R8.
6. **Record round-trip**: JSON drops `undefined` and turns a `Date` into a string, and memory hands back the same object
   while PostgreSQL hands back a copy; checked by the contract tests, the full suite, and a review of stores that
   mutate a record after inserting it.
7. **List order inside a transaction**: memory lists changed records last, PostgreSQL keeps their place. Three places
   read "the last one" of a listed table (`licences-service.ts:109`, licensing `adapters/table-stores.ts:105`,
   `site-registry-service.ts:293`); any suite failure here is stopped and flagged, not patched.
8. **A refused insert must not kill the transaction** (PostgreSQL aborts on an error): `ON CONFLICT DO NOTHING` plus the
   contract test that keeps using the transaction afterwards.
9. **Hash chain over PostgreSQL**: a single field read back differently (`'1'` for 1, `null` for absent, `[]` for absent)
   breaks verification; checked by appending entries of every actor shape and optional field and verifying.
10. **Pool exhaustion**: a handler that reads committed tables while its own transaction holds a connection can deadlock
    a small pool; checked by the concurrency tests run with a deliberately small pool.
11. **Path parameters**: merged before the server-clock rule, schema, hash and audit input (so audit entries and
    repeat answers are unchanged); static segments beat parameters; percent-decoding; checked by the F5 harness,
    `logged-reads.test.ts`, `read-scope.test.ts` and the repeat tests on the new URLs.
12. **HTTPS in tests and on phones**: the adapter test uses an explicit throwaway certificate; physical phones need a
    trusted certificate (open question 9).
13. **Test suite speed and flakiness** (one database per composition): measured in R9; three consecutive runs must
    agree; if too slow, clone a small pool of databases per worker ahead of time.
14. **App bundling**: Metro must reach `src/apps/shared-client` and `src/server/shared/request-id.ts`; TypeScript 7 must
    accept React Native's types (if not, the app workspace pins an older TypeScript as a development dependency).
15. **Known gap stays**: separate simultaneous opens can exceed capacity (demo: 6 tickets for 5 spaces); the site lock
    is not part of a restructure; its number on PostgreSQL is measured and reported in R10.
16. **In-process business data that survives** (not the database, but reachable by the running server): price
    versions in `createPriceList`'s map, codes in `RecordingSignInCodeSender`, the fake payment gateway. Listed in the
    open questions; untouched here.
17. **Workspace hoisting** may change versions in the root `node_modules`: the lockfile diff in R11 is reviewed; the
    server gate must stay identical.

Observable but not a rule change: once on PostgreSQL, data survives a restart (the in-memory server forgot everything),
so the first Chair is bootstrapped once across restarts by the same audit-log check.

---

## 8. Open questions for the team (not answered here)

1. **Zeyad:** accept, change or refuse ADR-16 … ADR-22, one by one.
2. **Everyone:** your GitHub user names, for `CODEOWNERS` per area (only Zeyad's, `Zab-17`, is known).
3. **Zeyad:** may Lino drive every phase on `area-a/r<N>-…` branches, or should foundation phases (R3, R4, R7–R10) be on
   Zeyad's own branches?
4. **Zeyad:** the two tamper proofs (audit-trail test, demo 03) alter records under the log. May they use a test-only
   array-backed `AuditLogStore`? The only other way is `UPDATE`/`DELETE` on `audit_log` as the owner, which rule 7 forbids.
5. **Zeyad:** is dropping the throwaway test databases at the end of a run acceptable under rule 7 (no row is ever
   updated or deleted; whole test databases are dropped)?
6. **Zeyad:** approve the new 400 when a body repeats a field the path names, or prefer another answer?
7. **Zeyad:** keep every status code exactly as today (for example `POST /tickets/:ticketId/closure` answers 200, a
   capacity change answers 200), or normalise them in a later, separately approved change?
8. **Zeyad:** in production, will the host terminate TLS at its edge (it must then re-encrypt to the server)? Is a
   Strict-Transport-Security header wanted (a new header on every answer)? Behind a proxy every client shares one
   address, which breaks the per-address sign-in limit: trust a forwarded-address header, and from whom?
9. **Mahi:** how should a physical phone trust the development certificate, or do we develop on emulators only?
10. **Lino, Mahi:** does "specify your role" mean the app only picks the sign-in flow (planned, no server change), or the
    role is sent and checked by the server (behaviour change)? How does the app learn the role the server granted:
    read it from the token, add it to the sign-in answer (behaviour change), or a new "who am I" read?
11. **Mahi, Zeyad:** with one app, is there still a web build for committee work on a laptop, and are driver screens
    hidden there?
12. **Lino, Amina, Zeyad:** the column tables in migrations 0002 and 0004 stay unused under keyed records. Keep them,
    drop them in a later migration, or move to them later as a separately approved change?
13. **Karim:** price versions live in process memory (`createPriceList`), so they vanish on restart and differ between
    server copies. Storing them is a behaviour change, and F1 needs its storage port declared inside committee-prices.
    When?
14. **Zeyad:** the five `/example/*` writes are served by the production server. Keep them, or move them to test-support
    (a behaviour change)? And who decides a development sign-in code sender, since codes are never sent today?
15. **Zeyad, Lino:** the two root PDFs are untracked and the local `.gitignore` edit ignores `*.pdf`; the local
    `.env.example` edit quotes `TOKEN_SECRET`. Commit the PDFs into `docs/pdf/`, commit either edit, or keep them local?
    Commit `docs/REVAMP_PLANNER_PROMPT.md`?
16. **Zeyad:** `uml/architecture_walkthrough_decisions.md` is cited by the ADR index and code comments but is not in the
    repository. Add it to `docs/`, or mark it external?
17. **Zeyad:** should start-up also refuse a database role that is allowed to `UPDATE` `audit_log` (for example a
    superuser), and do migrations use the same `POSTGRES_URL` with owner credentials or a second variable?
18. **Karim, Zeyad:** schedule the site lock that closes the parallel-open gap (risk 15) as its own task after R10?

---

## Verification, end to end

After R11, on a clean clone with Docker running:
```bash
npm ci
docker compose -f db/compose.yaml up -d
export POSTGRES_URL=postgres://sayes:sayes@localhost:5432/postgres
npm run db:migrate                     # applies 0001–0005; a second run applies nothing
npm run typecheck                      # server and app projects, exit 0
npm test                               # 0 failed, 0 skipped, passed ≥ 720; names-r0.txt all present except the
                                       # three F2/F8 proofs and the adapter tests renamed in R8
npm run fitness                        # 6 passed, 0 failed
./demo/run-all.sh                      # every claim PASS, against PostgreSQL, over the new routes
env -u POSTGRES_URL npm start          # exits 1: POSTGRES_URL must be set
TLS_CERT_PATH=… TLS_KEY_PATH=… npm start   # "listening on https"; curl --cacert … https://localhost:3000/audit-log → 401
(cd src/apps/mobile && npx expo export --platform android)   # the app bundle builds with the shared client
```
and the CI run on the last pull request green with the PostgreSQL service.

What I did not check: the route table's method choices against every service's re-assignment rules (the method never
changes what the server does); the actual cost of one database per test composition (measured in R9).

---

## Execution note (25 November 2026)

The team instructed that this is a structural change only and that the plan be carried out at once, overruling the
review steps. ADR-16 to ADR-22 are therefore marked "Accepted" by Lino (Teammate A), with Zeyad to confirm. The open
questions of section 8 were settled with the defaults this plan already recommends:
- the tamper proofs use a test-only array-backed `AuditLogStore` (no `UPDATE` or `DELETE` on `audit_log` anywhere);
- throwaway test databases are dropped at the end of each run;
- a body that repeats a field the path names is refused with 400; every other status code is unchanged;
- the server holds its own certificate; no Strict-Transport-Security header and no forwarded-address header are added;
- the app's role screen only selects the sign-in flow; the server decides the role;
- the column tables of 0002 and 0004 stay unused; price versions, the sign-in code recorder, the fake payment gateway
  and the `/example/*` writes are untouched; the site lock stays a later task;
- `CODEOWNERS` keeps its one line until the owners' GitHub names are known;
- three routes differ from the table in section 3.2, because each operation's only field is the id it acts on: with
  the id in the URL no request could fail the body check any more. `personalData.erase` is `POST /erasures`,
  `assignments.releaseAttendant` is `POST /attendant-releases`, `payments.payInApp` is `POST /payments`;
  `docs/architecture/rest-routes.md` is the current table;
- a body or query may repeat a path field with the same value (another value is refused with 400), so the client's
  requests and the tests' bodies are unchanged apart from the URL;
- the root PDFs and the local `.env.example` and `.gitignore` edits stay uncommitted.
