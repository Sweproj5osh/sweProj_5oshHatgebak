# ADR-15: Sign-in goes through the single entry point as a `public` operation kind

**Status:** Accepted · **Date:** 2026-11-07 · **Decided by:** Zeyad Khaled

## Context
Review day (section 17, P3): "the entry point refuses token-less requests, so Lino's complete sign-in module has no
route and Mahi answered sign-in before the pipeline (a second front door without audit, permission table or rate
limit)." A second door is the one thing the single entry point exists to prevent (section 8).

## Decision
"(a) a third operation kind, `PublicWriteOperation`, accepted without a token but with request id, server-clock rule,
body validation, unit of work, redacted audit entry, and a per-phone and per-address rate limit that only this kind
has. Only `requestSignInCode` and `signIn` may be public; a fitness function (F13) keeps the list at two."

In code: `kind: 'public'`, no roles, no permission row. The audit entry's actor is `{ kind: 'anonymous', address }`,
stored flat in the record as `address` where a person's entry has `personId` and `role`;
the handler may name the subject through `subjectPersonIds`. Repeats are keyed by client address and request id. A
`RateLimiter` port in `src/shared` with a sliding-window in-memory adapter limits 30 attempts per address and 5 per
`rateLimitKey` value (the phone) per 10 minutes; beyond that the answer is 429 with a plain message. Lino registers the
two operations; Mahi removes her bypass.

## Alternatives rejected
- (b) A bootstrap token shipped in the app: a shared secret in every phone is no secret.
- (c) Sign-in outside the pipeline: no audit entry, no request id, no rate limit, and a second place to keep secure.

## Consequences
- Easier: one door; sign-in attempts are audited and rate-limited like everything else; the two-step committee login
  reuses the same kind.
- Harder: the audit record's `person_id` and `role` become nullable and an `address` column joins them, which needs a
  migration; a shared rate-limiter store is needed once the server runs as several copies.

## Related
ADR-08 (repeatable writes), ADR-10 (one person, one role per token), ADR-13, ADR-14.
