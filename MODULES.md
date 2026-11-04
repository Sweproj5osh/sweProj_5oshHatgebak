# Modules

One folder per module under `src/modules/`. Another module may import only the module's `public.ts`; everything under
`internal/` is private (fitness function F2). "Must stay on" modules keep a driver parking; "may fail" modules fail
alone, and no must-stay-on module imports a may-fail one (fitness function F8, Rule D). Sets are declared in code in
`src/fitness/module-sets.ts`.

| Module folder | Public interface names (in `public.ts`) | Owner | Set |
|---|---|---|---|
| `sites-and-areas` | `SiteRegistry` | Teammate A | must stay on |
| `ticketing` | `TicketDesk`, `TicketQuery` | Teammate B | must stay on |
| `committee-prices` | `PriceList`, `FeeCalculator` (pure: imports nothing outside its folder, F1) | Teammate B | must stay on |
| `payments` | `PaymentLedger`; port `PaymentGateway` | Teammate C | must stay on |
| `accounts-and-access-control` | `Authorization`, `PersonalData` | Teammate A | must stay on |
| `audit-log` | `AuditTrail`; port `AuditLogStore`; factory `createHashChainedAuditTrail`. Appends are serialized across server copies: the PostgreSQL adapter takes `pg_advisory_xact_lock(<constant>)` in the write's transaction before reading the last entry and inserting the next | Zeyad | must stay on |
| `cash-custody` | `DepositLedger` | Teammate C | may fail |
| `licensing-assignment-attendance` | `LicenceStatus`, `Assignments`, `Attendance` | Teammate A | may fail |
| `approvals` | `ApprovalDesk` | Teammate C | may fail |
| `complaints-inspections-ratings` | `Complaints`, `Inspections`, `Scores` | Teammate D | may fail |
| `money-check-dashboard` | `MoneyCheck` | Teammate C | may fail |
| `scheduler` | `Scheduler` (job registry for owners; provides nothing to other modules) | Zeyad | may fail |
| `notifications` | `Notifier`; port `MessageDelivery` | Teammate D | may fail |
| `evidence` | `EvidenceStore`; port `PhotoStorage` | Teammate D | may fail |

## Foundation folders (Zeyad)
| Folder | Holds |
|---|---|
| `src/entrypoint/` | The single HTTP entry point: token, permission table, request id, server clock rule, body schemas, repeat check, the write pipeline that appends the one audit entry, the composition root |
| `src/shared/` | Code with no business rule: identifiers and roles, `Result`, `Clock`, request ids, canonical JSON, timestamp detection, `UnitOfWork`, event ports and the outbox delivery job |
| `src/adapters/in-memory/` | The in-memory database, audit store, outbox store and response store every test runs on |
| `src/fitness/` | The static fitness functions and the fixtures that prove each one can fail |
| `db/migrations/` | PostgreSQL migrations: one schema per module, `personal_data`, `foundation` (outbox, write responses), the append-only `audit_log` |

## Open placement
`PendingActions` (the assistant proposes, the driver confirms; Q12 and task D18) is named in the interface catalogue
but belongs to no module in the table above. Zeyad decides where it lives.
