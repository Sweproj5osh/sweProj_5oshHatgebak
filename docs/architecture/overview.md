# Overview

## The deployable units (ADR-03, ADR-04)
- **The main system** (this repository): one modular monolith, run as stateless copies, one PostgreSQL database.
- **The AI Assistant service**: a separate small service with its own database that calls the main system with the
  driver's own token.

## Where the code lives (ADR-16, ADR-17)
| Folder | Holds | Owner |
|---|---|---|
| `src/server/main.ts` | Start-up: read the environment, compose, bootstrap the first Chair, listen | The team |
| `src/server/http/` | The single entry point: the pipeline every request passes (section "How a request travels") | The team |
| `src/server/composition/` | The composition root: every operation, port and adapter is wired here and nowhere else | The team |
| `src/server/shared/` | Code with no business rule: identifiers, results, clock, request ids, unit of work, the operation contract | The team |
| `src/server/adapters/` | The storage adapters behind the ports | The team |
| `src/server/test-support/` | Test-only: the test application and its stand-ins (F14 keeps production code away from it) | The team |
| `src/server/modules/foundation/` | Area 1: `audit-log/`, `scheduler.ts` | The team |
| `src/server/modules/identity-and-registry/` | Area 2: `accounts-and-access-control/`, `sites-and-areas/`, `licensing-assignment-attendance/` | Lino (Teammate A) |
| `src/server/modules/parking-and-prices/` | Area 3: `ticketing/`, `committee-prices/` (pure, F1) | Karim (Teammate B) |
| `src/server/modules/money-and-governance/` | Area 4: `payments/`, `cash-custody.ts`, `approvals.ts`, `money-check-dashboard.ts` | Amina (Teammate C) |
| `src/server/modules/messages-and-complaints/` | Area 5: `notifications.ts`, `evidence.ts`, `complaints-inspections-ratings.ts` | Mahi (Teammate D) |
| `src/apps/shared-client/` | The HTTP client library the apps and the server-side tests share | Mahi (Teammate D) |
| `src/apps/test-support/` | Test-only client fakes | Mahi (Teammate D) |
| `src/apps/mobile/` | The one Expo app for every role (`docs/setup/mobile-app.md`) | Mahi (Teammate D) |
| `src/fitness/` | The static fitness functions and their planted violations | The team |
| `db/migrations/` | PostgreSQL migrations | The team (and each owner for their tables) |
| `demo/` | The demo scripts (`docs/demo/DEMO.md`) | Teammate A |

## How a request travels
Token (one person, one role, signed by the server) → live status → route → permission table → for a write:
`X-Request-Id` required → body rejected if it carries a timestamp → body schema → repeat check (same id, same answer) →
the module's handler → **one audit entry appended by the pipeline** → events to the outbox → commit. A failed write
leaves no entry and no event. Reads, public writes (sign-in) and telemetry follow the variants in
`docs/rules/ARCHITECTURE_RULES.md` section 8.
