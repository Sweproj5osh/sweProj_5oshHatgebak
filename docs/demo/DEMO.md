# Demo guide: Street Parking Management System (Cairo)

The app has no user interface yet, so these demos drive the **real application code** from the terminal and print each
request and the server's answer, the way a phone app would see them. Nothing under `src/` is changed or mocked by
the demos; they call the same entry point the tests and `npm start` use.

## Run it

From the repository root (Node.js 24, as in the README):

```bash
npm ci                                  # once
npx tsx demo/01-driver-journey.ts       # about 1 second each
npx tsx demo/02-fees-and-payment.ts
npx tsx demo/03-integrity-guarantees.ts
./demo/run-all.sh                       # all three in a row
NO_COLOR=1 npx tsx demo/01-driver-journey.ts > out.txt   # plain text, for slides
```

Every demo prints `PASS`/`FAIL` for each claim it makes and exits non-zero if one fails, so a broken demo is never silent.
Ready-made plain-text output of each is in `demo/output/`.

## What each demo shows

| Demo | Story | What to point out |
|---|---|---|
| **01 Driver journey** (real server wiring) | Chair is bootstrapped and signs in with code + password; committee creates district, zone, street with 3 spaces and opening hours; a driver signs in by phone and saves a car; scans the entry sign; ticket opens; street fills up; the 4th car is refused; the Chair reads the audit trail | Server stamps the time; signed site codes; one open ticket per car; roles enforced; same request id gives the same answer; refused writes leave no audit entry; the audit trail contains no plate, phone, password or code |
| **02 Fees and payment** | Five drivers leave three streets at different times: a 3h20 stay (25 EGP), a resident (0), a 14-hour stay held to the 50 EGP cap, a declined card, a "pending" provider answer, a receipt | Fee arithmetic lives only in Committee Prices; the phone never sends a time or an amount; payment cannot be taken twice; "pay later or pay cash" when the provider is unsure |
| **03 Integrity under stress** | 20 drivers want 5 spaces; a phone retries one scan 10 times at once; a request id is reused with other content; sign-in code guessing; 2,000 random stays vs the cap; someone edits the audit log underneath the app | Exactly 5 tickets; one ticket for 10 retries; brute force is shut out; the hash chain catches an edited entry and a cut tail |

Suggested order for a short presentation: 01 (the main flow), 02 (money), 03 (why the design ranks integrity first),
then close with the project's own safety net: `npm test` (719 tests pass, 1 database test skipped without a database)
and `npm run fitness` (7 static architecture checks pass).

## What is real and what is a stand-in

- **Real:** the single entry point (token, role, request id, server clock, body checks, repeat check, one audit entry per
  successful write, outbox events), accounts and sign-in, sites and areas, ticketing, committee prices and fee
  calculation, payments, the hash-chained audit log.
- **Stand-ins (the project's own, by design):** in-memory storage instead of PostgreSQL; sign-in codes are recorded in
  memory instead of being sent by SMS; the payment provider is a scripted fake (the last digit of the amount decides:
  ...1 paid, ...2 declined, ...3 pending).
- **Demo 02 uses the project's test composition** (`composeInMemoryApplication`), because on the real server wiring the
  committee's price approval is not composed yet (see below), so no price can be applied there. Demo 02 also moves a
  clock forward so hours can pass in a second. Say this out loud if asked.

## Known gaps found while building the demos (tell your team before you present)

1. **Simultaneous separate requests can take more spaces than exist.** `demo/known-gap-parallel-requests.ts` sends
   20 separate simultaneous opens for 5 spaces through the entry point: 6 tickets are issued, in 30 of 30 runs. The
   ticket store's contract (`src/server/modules/parking-and-prices/ticketing/ticket-store.ts`) says the PostgreSQL adapter must lock the
   site, but `src/server/adapters/` holds only in-memory code so far, and the in-memory database does not lock across
   transactions (the project's F3 test races the 20 opens inside one unit of work, which passes). Demo 03 therefore
   shows only what holds today: arrivals one after another, the F3 single-unit-of-work race, and 10 simultaneous
   retries of the same request id. Not part of the presentation; run it only to show the team.
2. **Approvals are not composed yet** (see `ticketingPortsFrom` and `APPROVALS_NOT_COMPOSED_YET` in `src/server/composition/compose-server.ts`): on the real server a
   price cannot be applied, so a ticket cannot close with a fee; and licence changes are never applied, so the
   attendant flow (clock-in, assisted tickets, cash) cannot be driven there. Demo 02 works around the first with the
   test composition; the attendant flow is not demoed.
3. **The map shows no free-space band or first-hour fee** (`band: "unknown"`, `firstHourFee: null`) because those two ports
   are not wired (`docs/team/QUESTIONS.md` item 17). Demo 01 prints two server log lines at that step; they are expected.
4. **A zero-fee ticket stays "unpaid"** (the resident in demo 02). Worth agreeing with the ticketing owner how a 0 EGP
   ticket should be shown.
