# Test report, 7 November 2026 (evening)

Tester: Claude (test and report only; nothing fixed, pushed, committed or commented). Brief: `architecture_v3/BRIEF_rigorous_test_pass.md`.
Worktrees (all removed afterwards): `main` = `origin/main` at f900d1f (foundation, A2, A7, A3, C1); `karim` = `origin/main` at 921db02
(the same plus Area 3, pull request #26, merged 18:55); `lino` = `origin/area-a/a15-committee-two-step` at 7647b9d; `amina` =
`origin/area-c/c3-one-charge-per-request-id` at 9573948; `mahi` = `origin/area-d` at 81a9eb9 (branched from a585b13, before A3, A7 and C1).
Probe files kept under `/private/tmp/claude-501/-Users-zeyadkhaled-Desktop-software-engineering/63d606da-f1fc-4079-91cd-328f777bf144/scratchpad/tp/probes/`.

## 1. Verdict

The foundation pipeline does what the rules say on the single-request path: token, permission table, request id, server-clock rule, body
schema, one audit entry per committed write, none per refusal or thrown handler, hash chain that breaks on any altered field, correct
read scope, 100 % of 7 operations × 5 roles refusing unlisted roles. Lino's scope ladder holds at every rung (23 scope cases, 11
cross-scope writes all 403 with zero audit rows), erasure is complete, site codes refuse every single-character tamper, and the
off-site rule is exact at 300 metres. Karim's fee calculator passes a 2,000-case property test and the shipped store wins the last-space
race 50 times out of 50; payment-status transitions never leave the four allowed values. What broke: (1) concurrency, in-memory, is
not handled anywhere above the ticket store: five parallel writes through the entry point produce five audit entries all numbered 1 with
a broken chain, two concurrent repeats of one request id both commit, two concurrent pays of one ticket both charge, and the
interleaving-hostile ticket store opens 20 tickets on 5 spaces (the service has no guard of its own); (2) the payments ledger answers
any repeat of a request id from the first row regardless of payer or ticket, so a stranger gets another driver's payment record, and a
second pay while the first is pending charges the provider again; (3) the known sign-in lock-out bypass still reproduces (20 wrong codes,
never locked); (4) the server-clock rule and fitness function F11 miss snake-case `_at` names and epoch numbers, and F11 only ever scans
the foundation's own operations file (8 fields checked on every branch, while Lino has 15 write operations and Karim 4); F10 misses
quoted camel-case columns and `RENAME COLUMN`; (5) the Driver App sends the fee (`amount`) in the pay body, sends identity in the
clock-in body, fetches the receipt as a POST without a request id, parses the map answer as a bare array while the server answers
`{ sites }`, and shares exactly one route (`/cars`) with the server; sign-in cannot reach the real entry point at all. What is missing:
the composition root still registers only the five example operations, so the F5 harness reports "5 / 5" on every branch; Karim's
`closeStaleTickets` and `frequentSites` are declared and unimplemented; eight may-fail modules are type-only shells; no PostgreSQL
anywhere, so the append-only grant test and every "lives in the database adapter" promise (advisory lock, unique open-attendance index,
site lock) is unverified.

## 2. Part A: inventory and existing suites

`npm run typecheck`: exit 0 on all five worktrees. `npm run fitness`: 5 passed, 0 failed on all five (F1 1 file checked; F2 247/364/466/306/344
imports on main/karim/lino/amina/mahi; F8 99/210/318/158/67; F10 40/40/112/40/34 columns; F11 **8 fields on every worktree**).
`npx vitest run`: main 14 files passed + 1 skipped, 123 tests passed + 1 skipped; karim 29 + 1, 282 + 1; lino 29 + 1, 227 + 1; amina 16 + 1,
134 + 1; mahi 18 + 1, 139 + 1. Zero failures anywhere. The skipped test is always `db/audit-log-is-append-only.test.ts` (no `DATABASE_URL`).

| Folder | main (f900d1f) | karim (921db02) | lino (7647b9d) | amina (9573948) | mahi (81a9eb9) |
|---|---|---|---|---|---|
| `src/entrypoint` | 4 files, 39 tests, 39 passed | 4 / 39 / 39 | 4 / 39 / 39 | 4 / 39 / 39 | 4 / 39 / 39 |
| `src/shared` | 3 / 30 / 30 | 3 / 30 / 30 | 3 / 30 / 30 | 3 / 30 / 30 | 3 / 30 / 30 |
| `src/adapters` | 1 / 3 / 3 | 1 / 3 / 3 | 1 / 3 / 3 | 1 / 3 / 3 | 1 / 3 / 3 |
| `src/fitness` | 1 / 8 / 8 | 1 / 8 / 8 | 1 / 8 / 8 | 1 / 8 / 8 | 1 / 8 / 8 |
| `src/apps` | no code | no code | no code | no code | 7 / 45 / 45 |
| `db` | 1 file, 1 test, skipped | same | same | same | same |
| `modules/accounts-and-access-control` | 2 / 22 / 22 | 2 / 22 / 22 | 7 / 54 / 54 | 2 / 22 / 22 | 1 / 7 / 7 (A3 not in base) |
| `modules/sites-and-areas` | 1 / 6 / 6 | 1 / 6 / 6 | 6 / 42 / 42 | 1 / 6 / 6 | no code (A7 not in base) |
| `modules/licensing-assignment-attendance` | no code | no code | 5 / 36 / 36 | no code | no code |
| `modules/audit-log` | 1 / 7 / 7 | 1 / 7 / 7 | 1 / 7 / 7 | 1 / 7 / 7 | 1 / 7 / 7 |
| `modules/payments` | 1 / 8 / 8 | 1 / 8 / 8 | 1 / 8 / 8 | 3 / 19 / 19 | no code (C1 not in base) |
| `modules/ticketing` | type-only shell (Karim) | 12 / 101 / 101 | type-only shell | type-only shell | type-only shell |
| `modules/committee-prices` | type-only shell (Karim) | 2 production files; tests in `src/tests/committee-prices/`: 3 / 58 / 58 | type-only shell | type-only shell | type-only shell |
| `modules/approvals`, `cash-custody`, `complaints-inspections-ratings`, `evidence`, `money-check-dashboard`, `notifications`, `scheduler` | no code (type-only `public.ts`) | same | same | same | same |
| **Total** | 15 files, 124 tests, 123 passed, 0 failed, 1 skipped | 30 / 283 / 282 / 0 / 1 | 30 / 228 / 227 / 0 / 1 | 17 / 135 / 134 / 0 / 1 | 19 / 140 / 139 / 0 / 1 |

Karim's two modules: empty shells on `main` at f900d1f (the brief's assumption), real code on 921db02 after the scope change; tested there.

## 3. Part B: coverage

Method: `c8` over `vitest --pool=forks` saw no worker coverage (0 of 3,024 lines). Fallback: `@vitest/coverage-v8@5.1.0` installed with
`npm install --ignore-scripts` into a separate scratchpad folder and symlinked into each worktree's `node_modules/@vitest/`; `package.json`,
`package-lock.json` and the repository untouched (`git status` clean in every worktree). Lines and branches, production files only
(`*.test.ts` and `src/fitness/fixtures/**` excluded); type-only `public.ts` files have 0 of 0 lines and are omitted.

| Folder | main | karim | lino | amina | mahi |
|---|---|---|---|---|---|
| all files | 91.9 % / 86.2 % | 94.5 % / 89.8 % | 92.3 % / 85.1 % | 91.5 % / 86.1 % | 76.1 % / 63.0 % |
| `src/entrypoint` | 88.6 / 80.4 | 89.8 / 81.4 | 89.8 / 81.4 | 89.8 / 81.4 | 89.8 / 81.4 |
| `src/shared` | 98.3 / 100 | 100 / 100 | 100 / 100 | 98.3 / 100 | 98.3 / 100 |
| `src/adapters` | 100 / 100 | 100 / 100 | 100 / 100 | 100 / 100 | 100 / 100 |
| `src/fitness` | 88.8 / 73.5 | 88.8 / 73.5 | 88.8 / 73.5 | 88.8 / 73.5 | 88.8 / 73.5 |
| `src/apps` | – | – | – | – | 67.0 / 51.5 |
| `accounts-and-access-control` | 88.2 / 90.4 | 88.2 / 90.4 | 98.1 / 93.7 | 88.2 / 90.4 | 74.6 / 80.0 |
| `sites-and-areas` | 100 / 100 | 100 / 100 | 87.0 / 79.6 | 100 / 100 | – |
| `licensing-assignment-attendance` | – | – | 91.8 / 84.2 | – | – |
| `audit-log` | 100 / 100 | 100 / 100 | 100 / 100 | 100 / 100 | 100 / 100 |
| `payments` | 100 / 100 | 100 / 100 | 100 / 100 | 89.7 / 87.0 | – |
| `ticketing` | – | 99.2 / 95.9 | – | – | – |
| `committee-prices` | – | 100 / 97.4 | – | – | – |

Production files under 60 % lines (every worktree unless named): `src/entrypoint/main.ts` 0 % (0/6, the process entry); `src/fitness/run-all.ts`
0 % (0/8, the script entry); `src/fitness/support/run-as-script.ts` 44.4 % (4/9); `src/fitness/support/fitness-result.ts` 57.1 % (4/7);
`src/modules/accounts-and-access-control/internal/adapters/in-memory-stores.ts` 59.3 % (16/27) on main, karim, amina and 39.1 % (9/23) on mahi
(98 % on lino). mahi only: `src/apps/driver/map/driver-map-api.ts` 14.3 % (1/7); `driver-map-client.ts` 56.3 % (9/16); `driver-map-routes.ts` 0 % (0/2);
`http-driver-map-api.ts` 0 % (0/37); `driver/payments/driver-payment-routes.ts` 0 % (0/4); `http-driver-payment-api.ts` 0 % (0/44);
`staff/attendant-mode/attendant-mode-routes.ts` 0 % (0/5); `http-attendant-mode-api.ts` 0 % (0/75). The three untested HTTP adapters are the
production path of the apps; only the in-memory stand-ins are tested.

## 4. Part C: live smoke test on `main`

Server: `TOKEN_SECRET=smoke-secret-that-is-long-enough PORT=4321 npx tsx src/entrypoint/main.ts` (the brief's `test-secret` is refused:
`readTokenSecret` demands at least 16 characters). Log: "listening on port 4321 with in-memory storage", "Permission table holds 7 operations".
Tokens minted with a 4-line tsx script importing `signToken`. Audit entries read through `GET /audit-log` as the Chair.

| # | Request | Status | Body (excerpt) | Audit entries after |
|---|---|---|---|---|
| 1 | POST /example/approvals, no token | 401 | `{"error":"missing token"}` | 0 |
| 2 | same, `Authorization: Bearer not-a-token` | 401 | `malformed token` | 0 |
| 2b | same, token signed with another secret | 401 | `bad signature` | 0 |
| 3 | same, valid attendant token (Chair-only operation) | 403 | `role attendant may not call example.chair.approveRequest` | 0 |
| 4 | Chair, no `X-Request-Id` | 400 | `every write needs a well-formed x-request-id header (8 to 128 letters, digits, - or _)` | 0 |
| 5 | Chair, body with `approvedAt: "2026-11-07T18:00:00Z"` | 400 | `timestamps are set by the server`, `fields: ["approvedAt"]` | 0 |
| 5b | Chair, body with `approved_at: 1762538400` (epoch) | 400 | `field "approved_at" is not part of this operation` (caught by the schema, not by the clock rule) | 0 |
| 6 | Chair, valid write, id `req-smoke-0006` | 201 | `{"operation":"example.chair.approveRequest","requestId":"req-smoke-0006"}` | 1 |
| 7 | same request id again, same body | 201 | byte-identical to 6 | 1 (no second entry) |
| 7b | same request id, different body (`request-OTHER`) | 201 | identical to 6: the first body's answer is returned | 1 |
| 7c | GET /audit-log as Chair | 200 | 1 entry: id 1, prevHash 64 zeros, hash c1adcce8…, input = first body | 1 |
| 7d | GET /audit-log/verification as Chair | 200 | `{"chainIntact":true}` | 1 |
| 8 | Chair, body `{"approvalRequestId":5}` | 400 | `body does not match the operation schema`, problems: `must be a string`, `"reason" is required` | 1 |
| 8b | Chair, body `{not json` | 400 | `Expected property name or '}' in JSON at position 1 …` (raw parser text) | 1 |
| 9 | GET /nothing/here with token | 404 | `no operation at GET /nothing/here` | 1 |
| 9b | GET /nothing/here without token | 404 | same: the route is resolved before the token is checked | 1 |
| 10 | GET /audit-log?foo=bar&personId=someone-else as Chair | 200 | query ignored, same 1 entry | 1 |
| 10b | GET /audit-log?role=chair as attendant | 200 | `{"entries":[]}`: scope from the token, not the query | 1 |
| 11 | PATCH /example/approvals | 400 | `unsupported method PATCH` | 1 |
| 12 | final GET /audit-log | 200 | still exactly 1 entry | 1 |

Server stopped with `kill`; exit clean.

## 5. Part D: adversarial probes

Format: probe → expected → observed → verdict. File:line names the code under test for every FAIL.

### Foundation (worktree `main`, 42 probes: 32 PASS, 10 FAIL)
| Probe | Expected | Observed | Verdict |
|---|---|---|---|
| Permission table, 7 operations × 5 roles | every unlisted role 403, every listed role < 400 | 35/35 as expected | PASS |
| Unknown route without a token | 401 (token before route, rules §8) | 404 | FAIL `src/entrypoint/handle-request.ts:36-43` (route lookup precedes `authenticate`) |
| Repeat with same id and body | stored response, 1 audit entry, 1 event | identical response, 1 and 1 | PASS |
| Same id, different body | refusal (a repeat must be the same write) | 201 with the first body's answer | FAIL `handle-request.ts:96-99` (key is person + id only; body not compared) |
| Same id, two different people | two writes | 2 entries | PASS |
| Two concurrent requests, same id | 1 entry, 1 event | 2 entries, 2 events | FAIL `handle-request.ts:97-103` (find-then-save, no reservation) |
| Handler throws after publishing | 500, 0 entries, 0 events | as expected | PASS |
| Handler refuses (409) after publishing | 0 entries, 0 events | as expected | PASS |
| Refused write not remembered; retry judged again | first 503, retry 201, 1 entry | as expected | PASS |
| 500 body hides the internal error text | no `handler blew up` in the body | `details.cause: "handler blew up after publishing"` | FAIL `handle-request.ts:137` |
| Alter any of 9 stored fields of the middle entry | `verifyChain` false | false for all 9 | PASS |
| Remove the middle entry | false | false | PASS |
| Remove the LAST entry | false | true (tail truncation invisible: no anchor of the last hash) | FAIL `src/modules/audit-log/internal/hash-chained-audit-trail.ts:35-45` (design gap, low) |
| 200 appends on one trail fired without awaiting | ids 1..200 in call order, chain intact | as expected | PASS |
| 5 concurrent writes through the entry point | 5 distinct ids, chain intact | 5 entries, ids `[1,1,1,1,1]`, one prevHash, `chainIntact: false` | FAIL `src/entrypoint/composition.ts:42-49` (a new trail and `SerialQueue` per write; each reads the committed last record) and `src/adapters/in-memory/in-memory-database.ts:15` (no locking) |
| `SerialQueue`: 200 tasks with random delays; survives a throw | in order; next task runs | as expected | PASS |
| Read scope: member own district, attendant own/subject, chair all | per ADR-10 | as expected | PASS |
| Token: other secret; changed role; re-encoded claims; unknown role, extra claim, empty person, numeric district; empty; 3 parts | all refused | all refused | PASS |
| Canonical JSON: key order at every depth, arrays keep order, undefined dropped | one string / different / same | as expected | PASS |
| Timestamp fields: nested, camel-case, `at`, ISO values under any key | all caught | all caught | PASS |
| `closed_at`, `created_at`, `paid_at` | caught | not caught | FAIL `src/shared/timestamp-fields.ts:6-18` (camel suffix `At` and lower-case `time/date/timestamp` only) |
| `paid_at: 1762538400` through `findTimestampFields` | `['paid_at']` | `[]` | FAIL same lines |
| `AT`, `CLOSED_AT`, `ClosedAT` | caught | not caught | FAIL same lines |
| Epoch number under a declared numeric field (`since`) through the entry point | 400 | 201 | FAIL `handle-request.ts:88-91` (values are only tested against the ISO pattern) |
| Write without `x-request-id` | 400 before the handler | 400, 0 entries | PASS |

Also observed, not a probe: `composition.ts:38` registers `foundationOperations` only, so `main.ts` serves 7 operations and the F5 harness
(`audit-coverage.test.ts:10`) reports "operations covered 5 / 5" on every branch, while lino registers 15 write operations and karim 4 in
their own tests only.

### Fitness functions (worktree `main`, 30 probes: 25 PASS, 5 FAIL)
| Probe | Expected | Observed | Verdict |
|---|---|---|---|
| The 5 shipped fixtures | each turns its function red | all red | PASS |
| F1: type-only import of `src/shared`; dynamic `import()` of ticketing | red | red | PASS |
| F2: `..`-wandering path, `.js` extension, re-export, dynamic import, multi-line import, entry point reaching into internals, `index.ts` root import; `public.ts` with extension accepted | red ×7, green ×1 | as expected | PASS |
| F2: `import('../../audit-log/internal/' + 'read-scope')` | red | green (known static-analysis limit) | FAIL `src/fitness/support/import-scanner.ts:13` (low) |
| F8: internal import across the line; type-only import | red | red | PASS |
| F10: `plate_number`, `licence_plate`, `phone_number`, `full_name`, unqualified `plate`; `label`/`filename` accepted; `plate` inside `personal_data` accepted | as listed | as expected | PASS |
| F10: quoted `"driverName"` outside `personal_data` | red | green | FAIL `src/fitness/f10-personal-data-columns-stay-in-their-schema.ts:30-33` (lower-cases before the camel-case split, so the split never fires) |
| F10: `ALTER TABLE … RENAME COLUMN car_ref TO plate` | red | green | FAIL `src/fitness/support/sql-columns.ts:7-8` (only `CREATE TABLE` and `ADD COLUMN` are read) |
| F11: `recordedAt`, `exitTime`, `entry_date` | red | red | PASS |
| F11: `closed_at` | red | green | FAIL `src/shared/timestamp-fields.ts:6-7` |
| F11: timestamp field in a module owner's operations file (`sites-and-areas/internal/operations.ts`) with a clean foundation file | red | green | FAIL `src/fitness/f11-write-schemas-carry-no-timestamp.ts:7-8, 32-40` (loads `foundation-operations.ts` only; "8 checked" on all five worktrees) |

### Lino, Area 2 (worktree `lino`, 25 probes: 21 PASS, 4 FAIL, one FAIL re-read as PASS)
| Probe | Expected | Observed | Verdict |
|---|---|---|---|
| Scope ladder, 23 cases (Chair system-wide/district 2/site 2; member own district, zone, site vs other district, other site, system-wide; inspector own zone, own-zone site vs other zone, other-zone site, district, system-wide; attendant own site vs sibling site, zone, system-wide; driver; ghost site; site and zone that disagree) | per A3 | 23/23 | PASS |
| 11 cross-scope writes by a district-1 member through the entry point (relabel/zone/site/capacity/hours/outline in district 2, assignments to site 2 and zone 2, create district, appoint member) | 403 each, 0 audit rows | 11 × 403, 0 rows | PASS |
| 5 in-scope writes by the same member | < 400, 1 audit entry each | 5 entries | PASS |
| Attendant revoked through an approved request | refused on the next call, `liveStatus` revoked | as expected | PASS |
| Driver whose token claims Chair | refused by the scope rules | refused | PASS |
| Migration: plate/phone/name columns only in `personal_data` | none outside | none | PASS |
| In-memory stores holding `plate`/`phone`/`displayName` outside personal-data code | none | 3 hits: two test helpers generating phone numbers, `ticketing/public.ts:50` `Receipt.plate` (the receipt by design) | PASS (no store holds personal data) |
| Erasure: plate read → not resolvable (Chair and owner), own cars empty, live status revoked, sign-in "wrong code", addCar "not a driver", re-erase "already erased", phone registrable again; audit keeps no plate or name | as listed | as expected | PASS |
| Erasure permissions: driver on another, member, Chair on Chair, through the entry point | refused / 403 | as expected | PASS |
| Site codes: tamper every single character (all positions), other site's code, exit at entry, entry at exit, empty, extra segment | forged / wrong site / wrong kind / forged | as expected | PASS |
| Codes expire? | (brief: "if codes expire") | codes are deterministic HMAC per site, identical after one simulated year, never expire; a photographed code is valid for ever | PASS (no expiry exists; noted) |
| Lock-out: 2 wrong codes, request a new code, repeat 10 times | locked after 3 wrong codes in total | 20 wrong codes, never locked | FAIL `src/modules/accounts-and-access-control/internal/sign-in-service.ts:39-45` (`failedAttempts: 0` on every new code; the counter should survive a new code the way `lockedUntil` does, lines 35-37) |
| Once locked (5 wrong), new code requested | still locked; right code refused | as expected | PASS |
| Member with code only; password not set; wrong password; right password; attendant unaffected | second step required / password not set / wrong password / token | as expected | PASS |
| Member sets Chair's or another member's password | not allowed | not allowed | PASS |
| Two open shifts: clock in at site 1, member releases and reassigns to site 1-bis, clock in again | 1 open attendance row | second clock-in succeeds, 2 open rows | FAIL `src/modules/licensing-assignment-attendance/internal/attendance-service.ts:37-44` (only an open row at the same site is reused) and `assignments-service.ts:68-79` (release does not clock out); the PostgreSQL unique index `attendance_one_open_per_attendant` (migration 0002, line 188) would refuse, so the in-memory store diverges from the schema |
| Clock-in at a site not assigned; forged code; unassigned attendant; bound site absent | wrong site / forged code / not assigned | as expected | PASS |
| Unlicensed attendant clocks in | licence not live | as expected | PASS |
| Licence suspended while clocked in | session unbound and shift closed | session unbound (`boundSite` undefined) but `isClockedIn` still true | FAIL `authorization-service.ts:87-92` unbinds, nothing closes the attendance row (`attendance-service.ts` has no hook) |
| Off-site: 5 readings exactly 300 m; 3 at 301 m; 1 stray at 600 m then near; 5 at 600 m; second flag same shift; inspector other zone | no flag / flag on the 3rd / no flag / exactly 1 flag / none / refused | as expected | PASS |
| Location reading keeps only the distance | keys `attendanceId, distanceMeters, recordedAt` | as expected | PASS |
| Capacity history after 12→15→7→20 with the clock advancing; no reason; 0; 2.5 | ascending dates, latest 20, refusals | as expected | PASS |
| Hours: no row → open at 03:00 Cairo; explicit `daily 00:00-24:00` same; Tuesday 08:00-20:00 open at 08:00, closed at 20:00 (exclusive); empty list; closure wins; ghost site closed; invalid periods | as listed | as expected; note: an EMPTY hours list means never open, unlike "no row" | PASS |
| Nearby: site exactly on the radius included, radius − 1 m excludes, far point → `[]`, radius 0 / 20,001, latitude 91, NaN; malformed query through the entry point | included / excluded / `[]` / invalid radius / invalid point / 400 | as expected | PASS |

Noted, not probed: sign-in and add-car have no registered operation (`accounts-and-access-control/internal/operations.ts:8-11`), the
attendant's location reading has none (`licensing-assignment-attendance/internal/operations.ts:14-16`), and declaring a special event
has none (`sites-and-areas/internal/operations.ts:179-183`), each blocked on a foundation question (no token at sign-in; the body is copied
into the permanent audit entry; the clock rule refuses dates in a body).

### Amina, Area 4 (worktree `amina`, 15 probes: 8 PASS, 7 FAIL)
| Probe | Expected | Observed | Verdict |
|---|---|---|---|
| Second pay with a new request id while the first charge is pending (fee 13) | refused, 1 row, 1 provider call | 202, 2 rows, 2 provider calls | FAIL `src/modules/payments/internal/payment-ledger.ts:59-61` (only `paymentStatus !== 'unpaid'` is checked; the pending row for the ticket is never consulted) |
| Two concurrent pays, different ids, one ticket (fee 11) | one 201, 1 row, 1 charge | 201/201, 2 rows, 2 charges | FAIL `payment-ledger.ts:52-63` (read-then-charge without a lock; `in-memory-database.ts:15`) |
| Same id, different ticket, same payer | not answered with ticket-1's payment | 201 carrying ticket-1's payment | FAIL `src/entrypoint/handle-request.ts:96-99` and `payment-ledger.ts:48-51` |
| Same id, different payer (driver-2 pays ticket-9) | 403 not your ticket | 201 carrying driver-1's payment record for ticket-1 | FAIL `payment-ledger.ts:48-51` (`byRequestId` ignores payer and ticket; `in-memory-payment-store.ts:25-27`) |
| At the ledger: same id, other ticket and payer | not the first row | first row returned | FAIL same lines |
| Timeout at exactly 8 seconds (fee 19, fake timers) | unanswered at 7,999 ms; 503 "pay later or pay cash" at 8,000 ms; ticket unpaid; no row, audit or event; retry judged again | as expected; retry reaches the provider a second time (2 calls) | PASS |
| Provider answers "paid" after the timeout | something recorded so the late answer can be settled (ADR-08: recorded and polled) | nothing recorded, no reference | FAIL `payment-ledger.ts:67-69` (design gap: a timed-out charge that the provider later completes cannot be reconciled; the fake cannot model it either) |
| Provider returns `outcome: 'processing'` | refusal, no row | 201, row stored with outcome `processing`, ticket unpaid, no event | FAIL `payment-ledger.ts:64-83` (every outcome other than declined / timed out is recorded) |
| Provider throws | 500, no row/audit/event; retry 201 | as expected | PASS |
| Charge paid but ticket cannot be marked | 500, rolled back, no row, no event | as expected | PASS |
| Statuses the ledger asks of ticketing | only the four; here only `paid` | `['paid']` | PASS |
| Source spells no forbidden status; literal statuses only | none | none | PASS |
| Pay a paid / disputed / waived / open ticket | 409 nothing to pay ×3; 409 ticket not closed | as expected | PASS |
| Pay an unknown ticket | 500, no row | as expected | PASS |
| Idempotency key handed to the provider | the `x-request-id` | as expected | PASS |

### Mahi, Area 5 (worktree `mahi`, 11 probes: 6 PASS, 5 FAIL)
| Probe | Expected | Observed | Verdict |
|---|---|---|---|
| Pay body sent by the Driver App | no fee | `{"ticketId":"t-1","amount":"25"}` | FAIL `src/apps/driver/payments/http-driver-payment-api.ts:33-37` (Rule I) |
| Any adapter puts a timestamp in a body (7 writes) | none | none | PASS |
| Receipt request | GET | POST without `x-request-id` (a write the real pipeline answers 400) | FAIL `http-driver-payment-api.ts:41-57` |
| Clock-in body | no identity | `{"attendantId":…,"siteId":…,"code":…}`; the server's `/attendance/clock-in` takes `siteCode` only | FAIL `src/apps/staff/attendant-mode/http-attendant-mode-api.ts:45-46` |
| Map adapter passes the server band through | `['few','unknown']` | `[]`: the adapter parses the body as a bare array and demands a numeric `firstHourFee`; the server answers `{ sites: [...] }` with `firstHourFee: number | null` | FAIL `src/apps/driver/map/http-driver-map-api.ts:63-80` versus `sites-and-areas/internal/operations.ts:231` |
| Sign-in against the real entry point | reachable | `404 no operation at POST /driver/sign-in` (would be 401 with a route: no token) | FAIL (no owner code; `handle-request.ts:40-43`) |
| Stand-in sign-in gateway bypasses the pipeline | confirm | confirmed: 0 calls to the entry point, 0 audit entries; `/cars` afterwards does go through | PASS (as documented in `stand-in-driver-auth-operations.ts:7-9`) |
| Entry scan: connection drops twice, retry | same id three times; a different code gets a new id | `['tap-1','tap-1','tap-1']`, then `tap-3` | PASS |
| Two taps on the same scan in flight | one request | one | PASS |
| Dropped answer after the server applied the write | retry with the same id | `['tap-1','tap-1']` | PASS |
| Attendant tick cash across a drop | same id | `['tap-2','tap-2']` | PASS |

Rule A grep (business rules inside `src/apps`, production files): band formula `in-memory-driver-map-api.ts:71-79` ("few" at 75 % of
capacity; the server's policy is at most 2 spaces or a fifth), distance `:81-85`; fee comparison `in-memory-driver-payment-api.ts:45`;
lock-out and plate rules copied from Area 2 in `stand-in-driver-auth-operations.ts:32-33, 143-150, 183-190`; a ticket status machine in
`in-memory-ticket-scan-api.ts:56, 81`. All are stand-ins, not the HTTP adapters; the HTTP adapters hold no arithmetic, no status decision and
no permission decision, except the wrong label `401 → 'ticket not closed'` in `http-driver-payment-api.ts:98-101`. The band is computed
client-side only in the stand-in. Route match between the apps and the servers: only `/cars` exists on both; the app's
`/driver/tickets/open|close`, `/driver/map/nearby`, `/driver/payments/pay|receipt`, `/driver/sign-in*`, `/staff/attendant/*` have no server
operation (the servers offer `/tickets/open|close|receipt`, `/sites/nearby`, `/payments/app`, `/attendance/clock-in`).

### Karim, Area 3 (worktree `karim`, 24 probes: 18 PASS, 6 FAIL)
| Probe | Expected | Observed | Verdict |
|---|---|---|---|
| F4 property test, 2,000 random entry/exit/version inputs (seed 20261107) | integer, 0 ≤ fee ≤ cap, reversed stay 0, a real stay never 0 when the first hour costs | 0 violations | PASS |
| Task-sheet numbers; exactly 1 h → 10; 1 h 1 s → 15 | 10, 25, 50, 10, 15 | as expected | PASS |
| NaN dates, negative cap, infinite first hour, cap below first hour, NaN fee | 0, 0, cap, cap, 0 | as expected | PASS |
| Version with `firstHourFee: 10.5` | whole pounds | 15.5 | FAIL `src/modules/committee-prices/internal/fee-calculator.ts:26-28` (trusts the version; unreachable through `PriceList`, which refuses non-whole versions at `price-list.ts:82-95`) |
| Resident 0; lookup throws / answers `'yes'` / absent | 0; 15; 15; 15 | as expected | PASS |
| Price list: latest version at or before the moment, exact start, before any, other site, duplicate start, unapproved, non-whole; no write path besides `applyApprovedVersion` | as listed | as expected | PASS |
| F3, shipped store, 20 opens on 5 spaces × 50 runs | 5 tickets, 15 "site full", count 5, every run | 50/50 | PASS |
| F3 with an interleaving-hostile store (a yield between count and insert, no queue) | 5 | 20 tickets on 5 spaces: the service adds no guard; atomicity lives only inside `InMemoryTicketStore.openIfPossible` | FAIL `src/modules/ticketing/internal/ticket-opening.ts:15-43` relies wholly on `in-memory-ticket-store.ts:17-34` (the PostgreSQL adapter must lock the site, as `ticket-store.ts:14-18` promises) |
| Same carRef twice, also from another driver | car already parked | as expected | PASS |
| Driver-2 opens with driver-1's carRef | refused (not the driver's car) | succeeds; the owner is then "car already parked" | FAIL `ticket-opening.ts:15-43`, `open-ticket-operation.ts:28-35` (carRef taken from the body, no ownership port) |
| Closed site with 0 spaces; open site with 0 spaces; unknown site | site closed; site full; site closed | as expected | PASS |
| Forged, wrong-site, exit-at-entry codes; entry-at-exit, wrong-site exit, nonsense exit | forged / wrong site / forged; forged / wrong site / forged; ticket stays open | as expected | PASS |
| Close with no price version | no price known, ticket open | as expected | PASS |
| Exit before entry (clock back 1 min); exit at entry | refused, fee undefined, open; closed with fee 0 | as expected | PASS |
| Price of the opening moment; exit time from the clock; close repeat same id | 15, `2026-11-09T10:00:00.000Z`, identical | as expected | PASS |
| All 16 payment transitions; table shape | allowed per `ALLOWED_PAYMENT_CHANGES`, nothing else, paid/waived final | 16/16, 4 keys | PASS |
| `'left unpaid'`, `'awaiting payment'`, open ticket, unknown ticket | refused | refused | PASS |
| Source spells no forbidden status | none | none | PASS |
| Receipt plate through `PlateLookup` (reader, purpose receipt, site); ticket row holds no plate | as listed | as expected | PASS |
| Plate port "not resolvable" | `PLATE_UNAVAILABLE` | `unavailable` | PASS |
| Plate port "refused" | `PLATE_UNAVAILABLE` on the receipt | throws `plate read refused` (403 through the route) | FAIL `src/modules/ticketing/internal/ticket-reading.ts:38-41` (defensible design, but not what the brief states) |
| Receipt for an open or unknown ticket | refused | ticket not closed / unknown ticket | PASS |
| Free spaces 3 of 5 → 2, close one → 3, ghost site → 0, no counter | as listed | as expected | PASS |
| Assisted count by month: 23:30 Cairo 30 Nov (21:30 UTC) and 00:30 Cairo 1 Dec (22:30 UTC 30 Nov) | Cairo months: November 1, December 1 | November 2, December 0 | FAIL `in-memory-ticket-store.ts:40-45` (`getUTCMonth`; the 23:30 case lands in November in both calendars, the 00:30 case moves a month) |
| Attendant of site 2 opens assisted at site 1; assisted flag | refused; `assisted: true` | as expected | PASS |
| `closeStaleTickets` (B14), `frequentSites` (B16) implemented | yes | declared in `public.ts:70, 89`, no implementation anywhere | FAIL (not built; sprint-2 tasks) |

Probe files written (copies under `…/scratchpad/tp/probes/`): `foundation.probe.test.ts` (was `main/src/entrypoint/__probe__/`),
`fitness.probe.test.ts` (`main/src/fitness/__probe__/`), `lino.probe.test.ts` (`lino/src/modules/accounts-and-access-control/__probe__/`),
`amina.probe.test.ts` (`amina/src/modules/payments/__probe__/`), `mahi.probe.test.ts` (`mahi/src/apps/__probe__/`),
`karim.probe.test.ts` (`karim/src/modules/ticketing/__probe__/`), plus `smoke/run.sh` and `smoke/mint.ts`. Totals: 147 probes, 110 PASS, 37 FAIL.

## 6. Part E: database test

`DATABASE_URL` unset; `pg_isready`, `psql` and `postgres` absent; no PostgreSQL process. `db/audit-log-is-append-only.test.ts`:
**skipped: no database on this machine** (on all five worktrees). Nothing installed.

## 7. Not testable yet

- Karim's `closeStaleTickets` (B14) and `frequentSites` (B16): declared, unimplemented. On `main` at f900d1f the whole of `ticketing` and `committee-prices` were type-only shells.
- No code (type-only `public.ts`) on every branch: `approvals`, `cash-custody`, `complaints-inspections-ratings`, `evidence`, `money-check-dashboard`, `notifications`, `scheduler`. Amina's `tickCash`, `addCorrection`, `settlePendingPayments`, `cashDueForShift` throw "built in task C5/C6/C7/C8".
- No registered route, so untestable through the entry point: sign-in and request-code (A1, D1), add car (A4), location reading (A14), special event (A9); nothing from `src/apps` can reach a server operation except `/cars`.
- Rules with no owner code to test: F3 beyond the in-memory store (no PostgreSQL adapter, no site lock); F4 only at the calculator (no end-to-end fee through a registered close route in the composition root); F7 beyond the in-memory response store (no durable store; the concurrent same-id case already fails in memory); F9 (no assistant service); F6's database half and Z2 (no database); Z7's crash-and-rerun, Z11–Z15 (scheduler, stale-ticket job, retention, fault containment, assistant isolation) not started.
