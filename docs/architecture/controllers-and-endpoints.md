# Controllers and endpoints (ADR-22)

## The pattern
- **An operation is one endpoint.** Each operation object (`src/server/shared/operation-contract.ts`) declares its kind
  (`read`, `write`, `public`, `telemetry`), its name, its `method` and `path` (the endpoint; the path may hold `:name`
  parameters), the roles, the read scope, the body schema, the audit redaction, the samples the audit-coverage check
  sends, and its `handle`.
- **`handle` is the thin controller action.** It reads the already-validated input, calls the component's service
  unchanged, and maps the answer to `respond(status, body)` or `refuse(status, message)`. No business rule lives in it
  beyond choosing the status for each refusal the service names.
- **A controller is one file per REST resource**, inside the component that owns it: for example
  `parking-and-prices/ticketing/tickets-controller.ts` holds the ticket endpoints and
  `identity-and-registry/sites-and-areas/districts-controller.ts` the district ones. Samples and seeds the controllers
  of one component share live in its `controller-support.ts`.
- **A component lists its endpoints once**, in `operations.ts` (or `operations` in its `index.ts`), in registration
  order. `src/server/composition/compose-server.ts` (`composeRegistry`) concatenates the components' lists in a fixed
  order; the permission table and the audit-coverage check (F5) follow that order.
- **Adding an endpoint**: add the operation to the right controller (or a new controller file for a new resource), add
  it to the component's list, add its row to `rest-routes.md`.

## What every request goes through, in this order (`src/server/http/handle-request.ts`)
1. Route lookup (only to recognise a public operation, which has no token).
2. Token and expiry → live status of the person (401, 403).
3. Unknown route → 404 (after the token, so the route table is not discoverable).
4. Permission table (an `open` read skips it).
5. The path's parameters join the input: the query of a read, the body of every other kind. A body or query that
   repeats a path field with another value is refused with 400.
6. The kind's own pipeline: for a write, request id → server-clock rule (no timestamps) → body schema → repeat check
   (same id, same answer; another body, 409) → the handler inside one unit of work → one redacted audit entry → events
   to the outbox → commit. Reads check their scope and, when logged, write one entry; telemetry is rate-limited and
   leaves no entry; public writes are rate-limited per address and per phone.

## Routing rules (`src/server/http/registry.ts`)
- A fixed path is matched first; then the most specific template (the one with the most fixed segments).
- A parameter takes exactly one non-empty segment, percent-decoded; a malformed encoding matches nothing.
- Two operations on the same method and path (parameter names aside) are refused when the registry is built.
- The client fills a template with `pathWith(template, values)` from `src/apps/shared-client/route-path.ts`.
