# ADR-16: Five area modules replace the fourteen module folders

**Status:** Accepted · **Date:** 2026-11-25 · **Decided by:** the team (recorded by Lino, Teammate A, the scrum master; ADR-24)

## Context
Fourteen module folders, each split into `public.ts` and `internal/`, plus thirteen fitness functions, several of
which only guard folder boundaries, are more separation than a five-person team needs. Ownership is already by area
(`docs/team/TEAM_TASKS.md`): one owner per area, several modules per owner.

## Decision
- The server code lives under `src/server/`. Business code is grouped into five area modules under
  `src/server/modules/`, one per owner: `foundation` (Area 1, the team: audit log, scheduler), `identity-and-registry`
  (Area 2, Lino), `parking-and-prices` (Area 3, Karim), `money-and-governance` (Area 4, Amina) and
  `messages-and-complaints` (Area 5, Mahi).
- The fourteen components of ADR-02 stay, as plain sub-folders (or one file for a type-only component). The
  `internal/` level goes and `public.ts` becomes `index.ts` with the same content.
- Fitness functions: F2 (imports only through `public.ts`) and F8-static (no import from must-stay-on into may-fail)
  are dropped. F14 is added: no production file imports test-only code, and the composition root imports no adapter
  but the PostgreSQL ones. F1, F10, F11, F12 and F13 stay. Rule D stays, proven by the behavioural test Z14.
- The move changes no business rule, calculation, refusal, state transition, permission, audit behaviour or validation.

## Alternatives rejected
- Keeping fourteen folders without the split: the folder count stays; ownership still spans several folders.
- Two groups by availability (must stay on, may fail): one folder would mix several owners.

## Consequences
- Easier: one folder per owner; fewer files per change; ownership matches the task sheet.
- Harder: an import into another component's private file is no longer caught by a build check; review catches it.

## Related
Amends ADR-02 (consequence "fourteen public interfaces and a boundary check") and ADR-03 (the build-time boundary
check). ADR-03's one deployable unit and Rule D are unchanged.
