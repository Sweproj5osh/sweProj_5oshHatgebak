# ADR-09: An offline attendant is refused in version one

**Status:** Accepted · **Date:** 2026-11-04 · **Decided by:** Zeyad Khaled

## Context
An attendant with no signal taps "cash paid" or opens an assisted ticket. Accepting the action offline risks two tickets
for one space or a payment status that never reaches the server. Integrity (rank 1) outranks reliability (rank 3).

## Decision
In version one the Staff App **refuses the write with a clear message** when the server cannot be reached. The driver
can still pay in the Driver App. No offline write queue.

Roadmap, deferred: an offline queue **for cash-paid ticks only** (it changes a status from unpaid to paid and cannot
create a ticket), made safe by Rule H. It can be added without changing the architecture.

## Alternatives rejected
- A general offline queue: assisted tickets opened offline could exceed capacity.
- Accepting the tick and reconciling later: a status the server has not seen is not a status.

## Consequences
- Easier: one truth; no reconciliation code in version one.
- Harder: a driver may wait while the attendant finds signal; the clear message and the in-app payment path matter.

## Related
ADR-01, ADR-08.
