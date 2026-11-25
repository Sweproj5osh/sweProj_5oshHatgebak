# ADR-22: Resource-style REST routes, one controller per resource, HTTPS only

**Status:** Accepted · **Date:** 2026-11-25 · **Decided by:** Lino (Teammate A), at the team's instruction to carry out the restructure without the usual review; Zeyad Khaled to confirm

## Context
Paths used verbs (`/tickets/open`, `/tickets/close`, `/payments/app`) and the server listened on plain HTTP.

## Decision
- Every operation keeps its declaration (kind, name, roles, scope, schema, audit rule, handler); its `method` and
  `path` become a REST endpoint, and the path may hold parameters (`/tickets/:ticketId/closure`). A path that is
  already a noun keeps its URL. The full table is `docs/architecture/rest-routes.md`. `PATCH` is accepted.
- A controller is one file per REST resource, inside the component that owns it. A component lists its operations in
  the same order as before, so the registry, the permission table and the audit-coverage harness see the same sequence.
- The pipeline order is unchanged. Path parameters are merged into the query of a read and into the body of a write,
  before the server-clock rule, the schema, the body hash and the audit input, so every handler, refusal, repeat answer
  and audit entry sees exactly the input it saw before. The body or query may repeat a field the path names with the
  same value (the shared client does, so its requests change only in their URL); another value is refused with 400.
- An operation whose only body field is the id of what it acts on (erasure, releasing an attendant, paying) keeps the
  id in the body at a noun path (`POST /erasures`, `POST /attendant-releases`, `POST /payments`), so a request with a
  wrong body still reaches the operation and is refused there.
- Status codes are unchanged.
- The server listens with Node's `node:https` only; `TLS_CERT_PATH` and `TLS_KEY_PATH` are required at start-up.
  There is no plain-HTTP listener.

## Alternatives rejected
- Hand-written controller functions per operation: forty-nine wrappers around handlers that already parse, call the
  module and map the result.
- A web framework: forbidden inside modules (rules §10) and not needed for one route table.
- A redirect listener on plain HTTP: plain HTTP must not serve the API at all.

## Consequences
- Easier: URLs name resources; the apps and the assistant reach one HTTPS entry point (ADR-04, ADR-07).
- Harder: developers need a local certificate; phones must trust it.

## Related
Amends ADR-15 (the paths of the public sign-in operations; F13 unchanged). ADR-07, ADR-10 (token before route).
