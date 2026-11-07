# Architecture rules and restrictions

This file binds every person and every AI coding agent working in this repository. Read it before writing a line.
The reasons behind each rule are in `adr/` (fifteen Architecture Decision Records) and the task list is in
`docs/TEAM_TASKS.md`. When this file and a pull request disagree, this file wins until Zeyad Khaled (the architect
and the only decision maker) changes it through a new decision record.

## 1. What the system is
A street parking management system for Cairo. It exists to **organize and protect**: a driver knows the real, legal
price and is never charged above it; the governorate committee stays in control of prices and licences; every visit,
payment, price change and decision leaves a record nobody can quietly alter. Five roles: Driver, Attendant,
Inspector, Committee Member, Committee Chair.

## 2. Qualities, ranked (ADR-01)
1. **Integrity**: data is never wrong or forged (exactly as many tickets as spaces; a fee never above the cap; times
   frozen at the exit scan).
2. **Accountability**: every action is traceable to one person, with the reason and the approver.
3. **Reliability and availability**: correct behaviour when something fails; the system stays on when a component fails.
4. **Security**: only the right role, in the right scope, can act.

The lower rank gives way in a conflict. "It is too hard for the deadline" is never a reason to weaken ranks 1–4.
Privacy (Law 151 of 2020) is a constraint, obeyed not ranked. Performance, scalability and cost are unranked.

## 3. Constraints that cannot move
- The system never holds money: a licensed provider moves it, we record that it happened.
- The system never sets a price or decides a licence: it stores the committee's numbers and reasons.
- Free tools only, with no credit card. A provider is chosen only after its free tier is verified on the vendor's page.
- Personal data (names, phones, plates) is collected minimally, stored apart, retained for a set period and erasable.
- Phones are cheap and the signal is weak: no heavy client work, no assumption of a stable connection.
- English only for now; no Arabic-language processing in version one.

## 4. The two deployable units (ADR-03, ADR-04)
- **Unit 1, the main system:** one modular monolith, run as stateless copies behind a load balancer, one PostgreSQL
  database with read copies. Clean Architecture inside each module: domain → use cases → adapters.
- **Unit 2, the AI Assistant service:** a separate small service with its own database. It calls unit 1 through the
  public interface with the driver's own token, never a staff token. If it fails, nothing else fails.

## 5. The fourteen modules and their owners (ADR-02)
| Module (folder under `src/modules/`) | Public interfaces | Owner | Set |
|---|---|---|---|
| `accounts-and-access-control` | `Authorization`, `PersonalData` | Lino (Teammate A) | must stay on |
| `sites-and-areas` | `SiteRegistry` | Lino (Teammate A) | must stay on |
| `ticketing` | `TicketDesk`, `TicketQuery` | Karim (Teammate B) | must stay on |
| `committee-prices` | `PriceList`, `FeeCalculator` | Karim (Teammate B) | must stay on |
| `payments` | `PaymentLedger`, port `PaymentGateway` | Amina (Teammate C) | must stay on |
| `audit-log` | `AuditTrail` | Zeyad | must stay on |
| `cash-custody` | `DepositLedger` | Amina (Teammate C) | may fail |
| `licensing-assignment-attendance` | `LicenceStatus`, `Assignments`, `Attendance` | Lino (Teammate A) | may fail |
| `approvals` | `ApprovalDesk` | Amina (Teammate C) | may fail |
| `complaints-inspections-ratings` | `Complaints`, `Inspections`, `Scores` | Mahi (Teammate D) | may fail |
| `money-check-dashboard` | `MoneyCheck` | Amina (Teammate C) | may fail |
| `scheduler` | none (it calls others) | Zeyad | may fail |
| `notifications` | `Notifier`, port `MessageDelivery` | Mahi (Teammate D) | may fail |
| `evidence` | `EvidenceStore`, port `PhotoStorage` | Mahi (Teammate D) | may fail |

"Must stay on" means a driver cannot park without it. "May fail" means it fails gracefully and the rest keeps working.

## 6. Module boundaries
- A module exposes only what its `public.ts` exports. Everything under `internal/` is private.
- Code in one module may import another module **only** through that module's `public.ts`. Fitness function F2
  fails the build otherwise.
- You write only inside the modules you own. Changes to another owner's module go through that owner.
- Shared code lives in `src/shared/` and holds no business rule: identifiers, results, request ids, clock, events,
  unit of work, the operation contract and body schema, the rate-limiter port. A module never imports
  `src/entrypoint` (F2): the entry point depends on the modules, not the reverse.
- `committee-prices` imports nothing outside its own folder (F1): it is pure arithmetic, testable with plain numbers.
- A must-stay-on module never calls a may-fail module synchronously (Rule D, F8). It publishes an event instead.

## 7. The nine rules (A to I)
| Rule | Statement | Checked by |
|---|---|---|
| A | No business rule in the apps. The apps display and collect; the server decides. | Review |
| B | Every outside provider sits behind a port owned by the module that uses it. Adapters are the only code that names a provider. Ports are frozen before any provider is chosen. | Review, F2 |
| C | Fee arithmetic exists only in `committee-prices`. Ticketing asks; it never computes. | F1, review |
| D | Nothing in the must-stay-on set calls anything in the may-fail set synchronously. | F8 |
| E | One transaction for integrity: capacity check + ticket + audit entry; freeze time + fee + audit; payment + ticket status + audit. All or nothing. | F3, F5, review |
| F | Names, phones and plates live only in the `personal_data` schema. Other tables hold a reference. Showing a plate is a role-checked, logged join. | F10 |
| G | Derived data (totals, dashboards, the free-space display) is never the truth. The tickets win. | Review |
| H | Every write carries a client request id (`X-Request-Id`). The same id twice returns the same answer and changes the database once. | F7 |
| I | The server is the only clock and the only truth. No time, fee or count is ever taken from a phone. | F11 |

## 8. Writes, audit and events (ADR-07, ADR-08, ADR-10)
- Every write goes through the entry point: token (one person, one role) → permission table → request id → body
  validation (no timestamp fields) → the module's handler → **one audit entry written by the pipeline** → events to
  the outbox → commit. A failed write leaves no audit entry and no event.
- The audit entry holds: who (person, role), what (operation, input), when (server clock), why (mandatory for prices,
  licences, waivers and corrections), the approver if any, the request id, and the hash of the previous entry.
- The audit table is append-only twice over: no update or delete code path exists, and the application's database role
  has no `UPDATE` or `DELETE` right on it. Corrections are new rows.
- Events (TicketOpened, TicketClosed, TicketPaid, DepositConfirmed, RequestAwaitingChair, …) are written to the
  `outbox` table inside the same transaction and delivered by a job. There is no message broker. Handlers tolerate
  receiving an event twice.
- A member requests with a reason; the Chair approves; nobody approves their own request. "Approved" and "applied"
  happen in one transaction.
- An attendant is proven at the gate: sign-in (registered, licence live, re-checked on every request) and clock-in
  (binds the session to the site). Ticketing checks only that the request's site equals the session's site.
- The unit of work reaches the modules (ADR-13). A handler receives `transaction: UnitOfWork & TableAccess`; module
  stores read and write through it; **every cross-module write method takes the unit of work as its first parameter**,
  so a module's rows, the audit entry and the events commit or roll back together. `audit_log` is not reachable
  through it.
- The audit entry carries no personal data (ADR-14). Every write declares `audit: { omit, replace }`; the pipeline
  strips or substitutes before the entry is written; a personal field with no rule fails the build (F12).
- Sign-in is the one door without a token (ADR-15): the `public` operation kind, with request id, server-clock rule,
  body validation, unit of work, redacted audit entry (actor: the client address), events, and a rate limit per phone
  and per address that only this kind has. Only `requestSignInCode` and `signIn` are public (F13).
- **Measurements are not actions; decisions are.** A `telemetry` operation (a location reading) is token-checked,
  rate-limited (one per person per minute), body-validated, and written into its module's tables with no request id,
  no audit entry and no event. The flag a measurement may raise is an ordinary audited write.
- Logged reads. Showing personal data is a role-checked, logged join (Rule F): the read declares `logged: true`; the
  pipeline requires the request id, opens a unit of work, runs the handler and writes one redacted entry (operation,
  actor, request id, the reference read, the subject). Modules never append entries themselves. A read that declares
  `audit.touchesPersonalData` must be logged (F5). One's own data (a driver's own cars) is not logged.
- Reads declare roles and a scope, so the permission table is one table: `open` (site configuration; any valid
  token), `own` (the actor's own records; role table only), `staff-scoped` (anything naming a person, a plate, a shift
  or money; role table, then `Authorization` with the same ladder as writes: Chair everywhere, Member in the district,
  Inspector in the zone, Attendant at the own site).
- The same request id with a different body is refused with 409 and writes nothing: the response store keeps the hash
  of the body beside the response (Rule H).
- Live status on every request: after the token check the pipeline asks `Authorization.liveStatus` and refuses anything
  but active; the session's bound site rides on the actor. Tokens expire: staff after 14 hours, drivers after 30 days;
  the live-status check is what locks a person out, the expiry only bounds a stolen token.

## 9. Failure behaviour (ADR-08, ADR-09)
- Payment provider: 8-second timeout, then the ticket stays closed and unpaid and the driver sees "pay later or pay
  cash". A "pending" answer is recorded and polled, never guessed.
- Attendant offline: refuse the write with a clear message. No local queue in version one.
- Database unreachable: writes stop and say so; reads may continue from a read copy. No local fallback.
- Any may-fail module down: the request to it fails alone; a ticket still opens, closes and gets paid.
- Language model down: "assistant unavailable"; the map still works.

## 10. Forbidden
- A web framework or an object-relational mapper inside a module's domain or use cases. Frameworks are details that
  live in adapters.
- Naming a provider (Neon, Supabase, Cloudflare, Paymob, Google Maps, any language-model vendor) anywhere except an
  adapter and `adr/`. "Candidate" is allowed in documents; "chosen" is not.
- A timestamp, fee or count accepted from a client.
- A table outside `personal_data` with a column named `plate`, `phone` or `name`.
- `UPDATE` or `DELETE` on `audit_log`; editing a payment row (add a correction row instead).
- A status other than open/closed for a ticket, and other than unpaid/paid/disputed/waived for its payment. No
  "left unpaid", no "awaiting payment".
- A new runtime dependency without a one-paragraph decision record in `adr/` saying why.
- Secrets in the repository. `.env.example` holds names only.
- Swallowed errors (`catch {}` with nothing in it), `any` in production code, business logic in a test helper.
- Commits directly to `main`.

## 11. Stack
TypeScript on Node.js 24, ECMAScript modules, strict mode. Vitest for tests, `tsx` to run scripts. HTTP through Node's
built-in `http` module behind our own small router. PostgreSQL through SQL migrations in `db/migrations/`; in-memory
adapters so every test runs without a database. The apps: Expo (React Native) for iPhone, Android and the committee
web build. Formatting and naming follow the code already in the repository.

## 12. How to work: branches, pull requests, review
1. Branch from `main`: `area-<letter>/<task-id>-<short-name>` (for example `area-c/c9-deposit-receipt`). Zeyad's
   branches are `foundation/<task-ids>`.
2. One task per pull request where possible. The description states: the task id, how to test it (commands), and the
   numbers the task asks you to report.
3. `npm test` and `npm run fitness` are green on the branch; the continuous-integration run on the pull request is
   green.
4. One review by Zeyad, then merge by squash. Nobody merges their own pull request without that review.
5. A pull request that changes a rule in this file or in `adr/` is refused until the decision record exists.

## 13. Definition of done, for every task
Every "Test it by" step in `docs/TEAM_TASKS.md` passes, as an automated test where possible; the "Report" numbers are
in the pull request; tests and fitness functions are green; one review by Zeyad.

## 14. The thirteen fitness functions (`npm run fitness`)
F1 Prices imports nothing outside itself · F2 cross-module imports only through `public.ts`, and no file under
`src/modules` or `src/apps` imports `src/entrypoint` · F3 twenty parallel opens on five spaces give five tickets · F4
fee ≤ cap for any input · F5 one audit entry per successful write or public write, none per failed one, none per
telemetry post, and every read that touches personal data is logged; it reads the composed registry and runs an
operation's `fixture` first · F6 the application role cannot update or delete `audit_log`, and the hash chain
verifies · F7 the same request id twice gives the same response and one change · F8 no synchronous call from
must-stay-on into may-fail · F9 the main-system suite passes with the assistant stopped · F10 no plate, phone or name
column outside `personal_data` · F11 no body schema in the composed registry accepts a timestamp, and `localDateTime`
appears only on committee operations · F12 every personal field (plate, phone, name, password, latitude, longitude) in
a write or public schema has an `omit` or `replace` rule · F13 the public operations are exactly a subset of
`requestSignInCode` and `signIn`.

## 15. Writing style for code, comments, documents and pull requests
Plain English. No abbreviation without its full form first (write "Architecture Decision Record (ADR)" once, then
"ADR"). No pronoun whose noun is unclear. Names reveal intent; functions are small and do one thing; comments only
where the code cannot say it; errors carry context and are never swallowed.

## 16. Changing a rule
Open a pull request that adds `adr/ADR-NN-<slug>.md` (context, decision, alternatives rejected, consequences,
related) and edits this file in the same change. Zeyad decides. Until it is merged, the old rule stands.
