# ADR-02: Fourteen components found by actor/actions, not by database tables

**Status:** Accepted · **Date:** 2026-11-04 · **Decided by:** Zeyad Khaled

## Context
Five roles (Driver, Attendant, Inspector, Committee Member, Committee Chair) plus time-driven work. The 3-to-5 role
change on 2 November touched eighteen sentences of the design document because "who approves" was written inside the
Prices and Licensing components separately. The entity trap (one "manager" component per table) produces storage with
no behaviour and scatters the real rules.

## Decision
Components are found by listing each actor's actions, grouping actions that share one responsibility, then testing each
boundary against what will change and who will ask for it (Parnas; Martin's Single Responsibility Principle).

| # | Component | Responsibility |
|---|---|---|
| 1 | Sites & Areas | Districts, zones, sites, capacity, hours, entry and exit codes, special events |
| 2 | Ticketing | Open and close by scan, assisted tickets, one open ticket per plate, no ticket when full, time frozen at exit |
| 3 | Committee Prices | Dated price versions, fee arithmetic, cap enforcement; pure (no database, no network) |
| 4 | Payments | Payment records (app and cash), statuses unpaid/paid/disputed/waived, payment-provider adapter, idempotency |
| 5 | Cash Custody (new) | Deposit record with a system-issued receipt number; inspector confirms or rejects; feeds the money check |
| 6 | Accounts & Access Control | Identities, roles, hierarchy Chair > Member > Inspector > Attendant, who may act on whom |
| 7 | Licensing & Assignment | Attendant licences, suspension and revocation, site and shift assignment, inspector to zone |
| 8 | Approvals (new) | Member request with reason → Chair approves or rejects → change applied; one rule for every approvable action |
| 9 | Complaints, Inspections & Ratings | Complaints up the hierarchy, inspection reports, road-block confirmations, ratings, disputes |
| 10 | Money Check & Dashboard | Money due versus collected per site and period; district and all-district views; committee only |
| 11 | Audit Log | Append-only record of every action: who, when, why, approver |
| 12 | Scheduler | Time-driven jobs: stale tickets, periods, retention purge |
| 13 | Notifications (new) | Ticket closed, payment received, request awaiting the Chair, complaint assigned |
| 14 | Evidence (new) | Photos for complaints, road blocks and inspections, behind a port |

Deferred behind ports: Prediction, Offline Sync, Subscriptions, Add-ons. The old deferred Voice Assistant is replaced by
the AI Assistant (ADR-04).

Rules produced by the change forecast:
- **Rule A**: no business rule in the apps; the apps display and collect, the server decides.
- **Rule C**: fee arithmetic exists only in Committee Prices; Ticketing asks, never computes.
- Money Check & Dashboard reads other components' data and never owns any.

## Alternatives rejected
- One module per table: fails the change test (a price change would touch Ticketing's display code).
- Keeping approval inside Prices and Licensing: the same rule in two places, as the 2 November change proved.
- Keeping deposit handling split between Payments and Inspection: the hand-off where theft happens had no single owner.

## Consequences
- Easier: a new approvable action is one line in Approvals; Cash Custody has one state machine to test.
- Harder: fourteen modules need fourteen public interfaces and a boundary check (fitness function F2).

## Related
ADR-01 (ranks 1–2 motivate Cash Custody and Approvals), ADR-03, ADR-11, ADR-12.

## Amendment 2026-11-04 (Q12a)
Ticketing does not require LicenceStatus or Authorization to check the attendant. The entry point proves the attendant
at sign-in (registered, licence live, re-checked on every request) and clock-in binds the session to the site; Ticketing
only checks that the request's site equals the session's site. Rule D holds with no exception.
