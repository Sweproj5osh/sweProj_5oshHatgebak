# ADR-07: Audit entry inside the transaction; in-process events with an outbox; no message broker

**Status:** Accepted · **Date:** 2026-11-04 · **Decided by:** Zeyad Khaled

## Context
The call style decides how failure spreads. If Ticketing waits on Notifications, a slow Notifications slows every
ticket. Accountability (rank 2) means an unlogged action must not exist. Availability (rank 3) means a crash at the wrong
millisecond must not lose a notification or a dashboard update.

## Decision
- **Synchronous in-process calls** only inside the must-stay-on set and only when the answer is needed to finish the
  action: Ticketing → Prices, Sites & Areas, Access Control; Approvals → Prices, Licensing (approved = applied).
- **Audit entry written inside the action's transaction**, then the event is published.
- **Events, topic style** (in-memory publish-subscribe, every subscriber gets a copy, the sender never waits):
  TicketOpened, TicketClosed, TicketPaid, DepositConfirmed, RequestAwaitingChair → Notifications, Dashboard, Money Check.
- **Outbox pattern**: each event is written to an `outbox` table in the same transaction and delivered by a background
  job, so no event is lost if the process dies after commit.
- **Jobs, queue style, with retry**: Scheduler (stale tickets, retention), Notifications → push or SMS provider.
- **One external synchronous call on the hot path**: Payments → payment provider, with an 8-second timeout and an
  idempotency key (ADR-08).
- Apps and the Assistant reach the server over HTTPS through one entry point.
- Map availability by **polling every 15 seconds** with a short server cache; no live push connection.

## Alternatives rejected
- A message broker: a second system to run for a team of five, for events that never leave the process.
- Fire-and-forget in-memory events without an outbox: a crash between commit and handler loses the event.
- Live push for availability: fresher, but fragile on Cairo networks; 15 seconds is enough for a free-space band.

## Consequences
- Easier: a new reactor subscribes without touching the sender; Rule D is natural.
- Harder: one outbox table and one delivery job; handlers must tolerate receiving an event twice.

## Related
ADR-01, ADR-03 (Rule D), ADR-08, ADR-10.
