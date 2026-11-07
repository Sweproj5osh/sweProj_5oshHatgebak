# Modules

One folder per module under `src/modules/`. Another module may import only the module's `public.ts`; everything under
`internal/` is private (fitness function F2). "Must stay on" modules keep a driver parking; "may fail" modules fail
alone, and no must-stay-on module imports a may-fail one (fitness function F8, Rule D). Sets are declared in code in
`src/fitness/module-sets.ts`.

**The code is the catalogue (P25).** The names below are the ones actually exported from each `public.ts` on `main`.
An owner who adds, renames or removes a public name edits this file's row in the same pull request; review checks it.
A module that exposes operations through the entry point exports `operations(dependencies)` and adds one line to
`src/entrypoint/composition.ts` in its own pull request (P4).

| Module folder | Public names exported from `public.ts` | Owner | Set |
|---|---|---|---|
| `sites-and-areas` | `SiteRegistry` (extends `SiteCodes`), `SiteCodes`; factory `createSiteCodes(secret)`; constant `SITE_CODE_SECRET_VARIABLE`; types `GeoPoint`, `NearbySite`, `CapacityChange`, `FreeSpaceBand`, `SiteCodeKind`, `SiteCodeRefusal` | Lino (Teammate A) | must stay on |
| `ticketing` | `TicketDesk`, `TicketQuery`; ports `TicketingSites`, `AttendantAssignments`, `PlateLookup`, `TicketStore` (with `InMemoryTicketStore`); factories `createTicketOpening`, `createTicketClosing`, `createTicketCounts`, `createTicketReading`, `createTicketPaymentStatus`, `createTicketingOperations(dependencies)` (not yet the `operations(dependencies)` export the composition root calls, see QUESTIONS.md); constants `PLATE_UNAVAILABLE`, `TicketReadRefusal`; types `Ticket`, `Receipt`, `OpenTicketCommand`, `CarReference`, `TicketState`, `PaymentStatus`, `OpenRefusal`, `CloseRefusal`, `SiteCodeProblem`, `TicketOpening`, `TicketClosing`, `AssistedClosing`, `TicketCounts`, `TicketReading`, `TicketPaymentStatus` and their `…Dependencies` | Karim (Teammate B) | must stay on |
| `committee-prices` | `PriceList`, `FeeCalculator`; factories `createPriceList`, `createFeeCalculator`; types `PriceVersion`, `Money`, `PriceLookup`, `ApplyVersionRefusal`, `ApplyVersionOutcome`, `PriceListOptions`, `FeeCalculatorOptions`, `CarAtSite`, `IsResident` (pure: imports nothing outside its folder, F1) | Karim (Teammate B) | must stay on |
| `payments` | `PaymentLedger`; port `PaymentGateway` (`charge(amount, idempotencyKey)`, `status(providerReference)`; the 8-second timer is the ledger's, P18); fake `createFakePaymentGateway`, `FakePaymentGateway`; module `Payments` with factory `createPayments(dependencies)` and `operations(dependencies)` (`payments.payInApp`, POST `/payments/app`); constants `PAYMENTS_TABLE`, `PROVIDER_TIMEOUT_MILLISECONDS`, `TICKET_PAID_TOPIC`, `PAY_LATER_OR_PAY_CASH`; types `PaymentRecord`, `AttemptState`, `ChargeResult`, `ChargeOutcome`, `PayRefusal`, `PaymentsDependencies`, `TicketPaidPayload`. Not yet in `composeRegistry`: needs `TicketDesk`/`TicketQuery` in `ModuleDependencies` from Karim's wiring | Amina (Teammate C) | must stay on |
| `accounts-and-access-control` | `Authorization`, `PersonalData`, `AccessFacts`; port `SiteLocator`; module `AccountsAndAccessControl` with factories `createAccountsAndAccessControl(dependencies)`, `createInMemoryAccountsStores()`; constant `SCOPE_RULE_DESCRIPTIONS`; types `Scope`, `AccountStatus`, `AccessDecision`, `BindSessionRefusal`, `LicenceLiveState`, `CarRef`, `PersonCreator`, `CreatePersonRefusal`, `AccountsAndAccessControlStores`, `AccountsAndAccessControlDependencies` | Lino (Teammate A) | must stay on |
| `audit-log` | `AuditTrail`; port `AuditLogStore`; factory `createHashChainedAuditTrail`; constant `GENESIS_HASH`; `operations(dependencies)` (the two audit reads); types `AuditEntry`, `AuditRecord`, `AuditReader`, `AuditActor`, `PersonAuditActor`, `AnonymousAuditActor`. Appends are serialized across server copies: the PostgreSQL adapter takes `pg_advisory_xact_lock(<constant>)` in the write's transaction before reading the last entry and inserting the next | Zeyad | must stay on |
| `cash-custody` | `DepositLedger`; types `Deposit`, `DepositReceipt`, `DepositState`, `DepositRefusal` | Amina (Teammate C) | may fail |
| `licensing-assignment-attendance` | `LicenceStatus`, `Assignments`, `Attendance`; types `LicenceState`, `AssignmentRefusal`, `ClockInRefusal` | Lino (Teammate A) | may fail |
| `approvals` | `ApprovalDesk`; types `ApprovalRequest`, `ApprovableKind`, `ApprovalState`, `ApprovalRefusal` | Amina (Teammate C) | may fail |
| `complaints-inspections-ratings` | `Complaints`, `Inspections`, `Scores`; types `ComplaintRefusal`, `DisputeDecision` | Mahi (Teammate D) | may fail |
| `money-check-dashboard` | `MoneyCheck`; types `MoneyCheckFigures`, `DashboardView` | Amina (Teammate C) | may fail |
| `scheduler` | `Scheduler`, `ScheduledJob`, `JobRunReport` (job registry for owners; provides nothing to other modules) | Zeyad | may fail |
| `notifications` | `Notifier`; port `MessageDelivery`; type `Message` | Mahi (Teammate D) | may fail |
| `evidence` | `EvidenceStore`; port `PhotoStorage`; type `PhotoState` | Mahi (Teammate D) | may fail |

## Foundation folders (Zeyad)
| Folder | Holds |
|---|---|
| `src/entrypoint/` | The single HTTP entry point: token and expiry, live status, permission table, read scopes, request id, server clock rule, repeat check with body hash under a per-request-id lock, rate limits, the audited unit of work whose serialized commit step appends the one redacted audit entry, telemetry, logged reads, the bootstrap of the first Chair, the composition root (`composeRegistry`, `composeInMemoryApplication`, `composeInMemoryServer`) |
| `src/shared/` | Code with no business rule: identifiers and roles, `Result`, `Clock`, request ids, canonical JSON, timestamp detection, `UnitOfWork` and `TableAccess`, the operation contract (`ReadOperation`, `WriteOperation`, `PublicWriteOperation`, `TelemetryOperation`, their contexts and outcomes, `respond`, `refuse`), the body schema (`list of <kind>`, `localDateTime`), the `RateLimiter` and `TokenIssuer` ports, `SerialQueue` and `KeyedSerialQueue`, event ports and the outbox delivery job |
| `src/adapters/in-memory/` | The in-memory database (keyed rows, staged replace and remove), audit store, outbox store, response store and rate limiter every test runs on |
| `src/fitness/` | The static fitness functions and the fixtures that prove each one can fail |
| `db/migrations/` | PostgreSQL migrations: one schema per module, `personal_data`, `foundation` (outbox, write responses), the append-only `audit_log` with its one-row `head` and three actor shapes (0003) |

## Open placement
`PendingActions` (the assistant proposes, the driver confirms; Q12 and task D18) is named in the interface catalogue
but belongs to no module in the table above. Zeyad decides where it lives.
