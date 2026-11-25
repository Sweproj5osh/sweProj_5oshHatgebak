# ADR-08: Every write is repeatable; the server is the only clock

**Status:** Accepted · **Date:** 2026-11-04 · **Decided by:** Zeyad Khaled

## Context
On Cairo streets the signal drops daily. A scan or a payment whose answer is lost will be retried by the driver. A
phone's clock can be wrong by an hour. Integrity (rank 1) forbids two tickets for one car, a double charge, or a fee
computed from a phone's time.

## Decision
- **Rule H**: every request that creates or changes something carries a client-generated request id; the same id twice
  returns the same answer and makes one database change. The payment call to the provider carries the same id as its
  idempotency key, so a retry is charged once.
- **Rule I**: the server is the only clock and the only truth. Entry and exit times are stamped when the request
  arrives; no time, fee or free-space count is ever taken from a phone.
- Failure handling that follows: provider down or slow → 8-second timeout, ticket stays closed and unpaid, "pay later or
  pay cash"; provider "pending" → recorded as pending and polled by a job; server copy dies → the load balancer retries
  on another copy; database unreachable → writes stop and say so, reads may continue from a read copy; photo store down →
  report saved, photo pending upload; language model down → "assistant unavailable". Site codes are signed and bound to
  the site; a scan from far away is flagged for inspection.

## Alternatives rejected
- Non-repeatable writes with "are you sure?" prompts: the driver cannot know whether the first attempt landed.
- Phone timestamps: cheaper for an offline mode, but a wrong clock becomes a wrong fee.
- Automatic local fallback when the database is unreachable: two truths that must later be reconciled.

## Consequences
- Easier: retry is safe everywhere, which also makes ADR-09's future offline queue possible.
- Harder: every write endpoint stores and checks request ids (fitness function F7); the client must generate and keep
  the id until the answer arrives.

## Related
ADR-01, ADR-07, ADR-09.
