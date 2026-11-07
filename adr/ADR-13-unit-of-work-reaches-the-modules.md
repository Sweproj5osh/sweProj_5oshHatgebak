# ADR-13: The unit of work reaches the modules

**Status:** Accepted · **Date:** 2026-11-07 · **Decided by:** Zeyad Khaled

## Context
Review day (section 17 of `uml/architecture_walkthrough_decisions.md`, P1): "the pipeline's transaction wraps the audit
entry but not the modules' data (private maps) nor cross-module calls (`TicketDesk.changePaymentStatus` takes no
transaction). Proof: Amina's payment rolled back while the ticket stayed paid; Lino's erasure is four non-atomic
deletes; no PostgreSQL adapter can join the transaction." Lino's in-memory stores say the same in their own words: they
keep private maps "because erasure and status changes need to replace and remove rows, which that database's
transactions do not offer yet". Rule E (one transaction for integrity) was a promise the code could not keep.

## Decision
"(a) explicit. `WriteContext.transaction` is `UnitOfWork & TableAccess`; module stores read and write through it;
every cross-module write method takes the unit of work as its first parameter; the in-memory database gains replace and
remove so stores live inside it."

In code: `src/shared/unit-of-work.ts` holds `UnitOfWork` (commit, rollback), `TableAccess` (`read`, `list`, `insert`,
`replace`, `remove` over keyed plain rows) and `Transaction = UnitOfWork & TableAccess`. The in-memory database stages
inserts, replaces and removes and applies them on commit. The `audit_log` table is not reachable through
`TableAccess`: the audit log store keeps its own port, so nothing can update or delete an entry by accident
(ADR-10). Logged reads (ADR-14's sibling rule P9) and telemetry use the same handle.

## Alternatives rejected
- (b) An ambient transaction through `AsyncLocalStorage`: a hidden dependency; a store that forgets to look it up works
  in tests and loses atomicity in production without any signal.
- (c) A validate-before-write convention: a habit, not a property; it cannot be checked and does not survive a crash
  between two writes.

## Consequences
- Easier: Rule E is now a mechanism. A PostgreSQL adapter implements `Transaction` once and every module joins it.
  Lino's stores can move onto the shared database; erasure becomes one unit of work.
- Harder: every cross-module write method grows a first parameter, and owners change their stores and signatures when
  they rebase (P4, P23). The in-memory database still does not lock, so concurrency over one table is not serialised.

## Related
ADR-06 (Rule E), ADR-07 (audit in the transaction), ADR-10 (append-only audit log), ADR-14, ADR-15.
