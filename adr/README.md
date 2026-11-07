# Architecture Decision Records (ADRs)

One file per decision that is expensive to change later. Every record has the same five parts: Context (the problem and
the forces), Decision (what we chose), Alternatives rejected (and why each lost), Consequences (what becomes easier, what
becomes harder), Related (the decisions it depends on). Status is Accepted unless marked otherwise.

ADR-01 to ADR-12 were decided by Zeyad Khaled on 4 November 2026, one question at a time, following the
eleven-question walkthrough recorded in `uml/architecture_walkthrough_decisions.md`, section 16. ADR-13 to ADR-15 were
decided on 7 November 2026, the review day of the teammates' first pull requests (section 17, P1 to P3). Ranked
qualities are from ADR-01.

| # | Decision |
|---|---|
| [ADR-01](ADR-01-ranked-qualities.md) | Qualities ranked: integrity, accountability, reliability and availability, security |
| [ADR-02](ADR-02-components-by-actor-actions.md) | Fourteen components found by actor/actions, not by database tables |
| [ADR-03](ADR-03-one-quantum-modular-monolith.md) | One deployable unit: a modular monolith with Clean Architecture inside, run as stateless copies |
| [ADR-04](ADR-04-assistant-second-quantum.md) | The AI Assistant is a second, separate service |
| [ADR-05](ADR-05-two-apps.md) | Two apps; only the Staff App gets a web build |
| [ADR-06](ADR-06-data-ownership-and-personal-data-store.md) | One writer per table; personal data in a separate store behind pseudonyms |
| [ADR-07](ADR-07-audit-in-transaction-events-outbox.md) | Audit entry inside the transaction; in-process events with an outbox; no message broker |
| [ADR-08](ADR-08-repeatable-writes-server-clock.md) | Every write is repeatable; the server is the only clock |
| [ADR-09](ADR-09-offline-attendant-refuses.md) | An offline attendant is refused in version one |
| [ADR-10](ADR-10-append-only-hash-chained-audit-log.md) | Append-only, hash-chained audit log with scoped read access |
| [ADR-11](ADR-11-providers-behind-frozen-ports.md) | Providers sit behind ports frozen before any provider is chosen |
| [ADR-12](ADR-12-system-issued-deposit-receipt.md) | The system issues the cash-deposit receipt; the inspector confirms |
| [ADR-13](ADR-13-unit-of-work-reaches-the-modules.md) | The unit of work reaches the modules: `UnitOfWork & TableAccess`, first parameter of every cross-module write |
| [ADR-14](ADR-14-declared-audit-redaction.md) | Audit entries carry no personal data; each write declares `omit` or `replace`; F12 |
| [ADR-15](ADR-15-public-sign-in-operations.md) | Sign-in is a `public` operation kind through the single entry point, rate-limited; F13 |
