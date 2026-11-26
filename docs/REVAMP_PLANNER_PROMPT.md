# Repository revamp: prompt for the planner

The prompt below is sent to the Claude planner to produce the plan for the full repository revamp. It asks for a plan
only; no file is moved until the team approves that plan.

```text
Ok team.

You are planning a full structural revamp of this repository: the Sayes street parking system, a
TypeScript modular monolith running on Node 24 with npm, vitest and tsx. Your output is a PLAN only.
Do not edit, move or delete any file.

══════════════════════════════════════════════════════════════════════
THE ONE RULE ABOVE ALL OTHERS: THIS IS A RESTRUCTURE, NOT A REWRITE
══════════════════════════════════════════════════════════════════════
- No logical unit changes. A logical unit is any business rule, calculation, refusal, state transition,
  permission, audit behaviour or validation. Every fee, refusal reason, audit entry and event must come
  out exactly as it does today.
- Code is moved, renamed, regrouped and rewired. It is not re-thought. If a step seems to need a change
  in behaviour, the plan marks it "BEHAVIOUR CHANGE — needs owner approval" and does not hide it inside
  a move.
- The existing tests are the proof that behaviour did not change. A test's expected values (the
  numbers, refusal reasons and states it asserts) must never be edited. Its imports, file location,
  set-up code and the URL it calls may change. If a step would change an expected value, that step
  changes logic, so stop and flag it.
- Step 0 of the plan: record the baseline. Run `npm test`, `npm run typecheck` and `npm run fitness`,
  plus the CI workflow in `.github/workflows/`, and save the pass counts. Every later phase ends with
  all of these green and the same or a higher pass count. A phase that ends red is not finished.
- Plan small phases, each of which can be merged on its own, so the repository stays shippable between
  them. Every phase lists the exact commands that prove it is green.

══════════════════════════════════════════════════════════════════════
READ FIRST (these bind you)
══════════════════════════════════════════════════════════════════════
`CLAUDE.md`, `AGENTS.md`, `ARCHITECTURE_RULES.md`, `MODULES.md`, `adr/README.md` and every ADR
(architecture decision record) in `adr/`, `docs/TEAM_TASKS.md`, `QUESTIONS.md`,
`src/entrypoint/composition.ts`, `src/entrypoint/main.ts`, `src/entrypoint/server.ts`,
`src/entrypoint/handle-request.ts`, `src/adapters/in-memory/`, `db/migrations/`, `src/fitness/`,
`src/apps/shared-client/`, `demo/`.

══════════════════════════════════════════════════════════════════════
WHAT IS WRONG TODAY (the reasons for the revamp)
══════════════════════════════════════════════════════════════════════
1. Too much modularity. The repository treats cohesion as sacred: 14 modules, each split into
   `public.ts` and `internal/`, plus 13 fitness functions guarding the boundaries. That level of
   separation is not required or expected. Propose a simpler grouping. For every fitness function
   (F1–F13), say whether it stays, is merged or is dropped, and why. Keep every one that protects a
   business guarantee: the append-only audit log, no timestamps accepted from clients, personal-data
   redaction, sign-in being the only public operation, and pure fee calculation.
2. No place for the frontend. The mobile app will be React Native with Expo. Nothing in the current
   packages, folder hierarchy or tooling accounts for it.
3. A silent in-memory database. With `DATABASE_URL` unset, the server and every test run on
   `src/adapters/in-memory/` (`composeInMemoryServer` in `main.ts`). This must NEVER be possible. The
   application runs only against a real PostgreSQL instance, connected through the `POSTGRES_URL`
   environment variable. A missing or unreachable `POSTGRES_URL` stops start-up with a clear error.
   There is no fallback.

══════════════════════════════════════════════════════════════════════
TARGET ARCHITECTURE
══════════════════════════════════════════════════════════════════════
A. One monolith in one repository. Every module, endpoint, migration and the frontend live here.
   - The mobile app lives at `src/apps/mobile` (Expo, React Native).
   - Plan the package layout. Expo needs its own `package.json` and Metro bundler config, so say
     whether you use npm workspaces or another layout, and why. Plan the root and per-package
     `tsconfig`, and plan how `src/apps/shared-client` (the HTTP client library) is shared by the
     mobile app and the server-side tests.
   - Give the full target folder tree, plus a move map from every current folder to its new location.
B. Controllers and endpoints. Every API gets one controller and one explicit endpoint, and all of
   them are RESTful over HTTPS.
   - Today operations are registered per module through `operations(dependencies)` and dispatched by
     `handle-request.ts`. Current paths use verbs (`/tickets/open`, `/tickets/close`, `/payments/app`).
     Plan resource-oriented REST routes: nouns, the HTTP methods GET, POST, PUT, PATCH and DELETE,
     and status codes. Give a table mapping every current operation to its new method, path and
     controller.
   - Controllers stay thin: parse, call the existing module code unchanged, map the result to a
     response. Everything the current entry point does still happens on every request, in the same
     order: the token check, the permission table, read scopes, request ids, repeatable writes, the
     server clock, rate limits, the audited unit of work, telemetry and logged reads.
   - The URL change is the only behaviour change allowed on the wire. `src/apps/shared-client` route
     constants and the `demo/` scripts move in the same phase as the routes, so the client and server
     never disagree.
   - HTTPS: say how TLS works locally, in continuous integration and in production. Plain HTTP must
     not serve the API.
C. PostgreSQL only, through `POSTGRES_URL`.
   - There is no PostgreSQL adapter yet: only `db/migrations/0001`–`0004` and the in-memory adapters.
     Plan PostgreSQL adapters behind the existing ports (the database, the audit store, the outbox
     store, the response store and the rate limiter) without changing their interfaces.
   - Rename `DATABASE_URL` to `POSTGRES_URL` everywhere: `.env.example`, the code and the docs.
   - Tests: plan how the existing test suite runs against a real PostgreSQL database (a CI service
     container, a local Docker database, per-test isolation), so the in-memory database can be
     deleted. If any in-memory code survives, the plan must prove the running application cannot
     reach it.
   - Keep the audit log append-only: no update or delete on `audit_log`, ever (ADR-10).

══════════════════════════════════════════════════════════════════════
CONFLICTS WITH CURRENT PROJECT RULES (resolve these in the plan, do not ignore them)
══════════════════════════════════════════════════════════════════════
- `AGENTS.md` rule 7 forbids adding a runtime dependency without a decision record first. A
  PostgreSQL driver, Expo and React Native are all new runtime dependencies. Plan the ADRs that must be
  written and approved before each one.
- `AGENTS.md` rule 3 says agents edit only their owner's modules. This revamp touches every area
  (Teammates A–D and Zeyad). Plan how each area owner approves the moves in their area.
- ADR-03 (modular monolith), ADR-05 (two apps), ADR-13 (unit of work) and ADR-15 (public sign-in) are
  affected. List which ADRs get superseded or amended and which new ADRs are needed.
- Branches: `area-<letter>/<task-id>-<short-name>`, never `main`, one pull request per phase.

══════════════════════════════════════════════════════════════════════
DOCUMENTATION AND CLAUDE.md
══════════════════════════════════════════════════════════════════════
1. Every document, all documentation and all human-readable context lives in one `docs/` directory
   at the repository root. Plan moving `ARCHITECTURE_RULES.md`, `MODULES.md`, `QUESTIONS.md`, `adr/`,
   `demo/DEMO.md` and the PDFs into `docs/`, and fix every link that points at them. The exceptions
   are `README.md`, `AGENTS.md` and `CLAUDE.md`: tools load these from the root, so they stay there
   and point into `docs/`.
2. The root `CLAUDE.md` already holds the standing rules every agent reads on every run. Keep it, and
   update its links when documents move.
3. Plan the target `docs/` tree: architecture, the controller and endpoint pattern, the REST route
   catalogue, the database set-up with `POSTGRES_URL`, the mobile app set-up, the rules, and the ADRs.

══════════════════════════════════════════════════════════════════════
WHAT YOUR PLAN MUST CONTAIN
══════════════════════════════════════════════════════════════════════
1. A baseline: test, typecheck, fitness and CI results before anything moves.
2. The target folder tree, plus a move map from every current path to its new path.
3. A REST route table: current operation → method, path, controller, and the client constant that
   changes with it.
4. Numbered phases. For each phase: the goal, the files touched, the owner who must approve it, the
   verification commands, and a rollback note. Order the phases so the riskiest step (PostgreSQL
   replacing in-memory under the tests) gets its own phase, kept apart from pure file moves.
5. Fitness functions: keep, merge or drop each one, with the reason.
6. The ADRs to write or supersede.
7. Risks: places where a move could quietly change behaviour (import side effects, registration
   order in `composeRegistry`, serial queues, advisory locks, clock injection), and how each is checked.
8. Open questions for the team. Do not guess the answers.
```
