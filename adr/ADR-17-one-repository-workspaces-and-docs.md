# ADR-17: One repository with npm workspaces; every document under docs/

**Status:** Accepted · **Date:** 2026-11-25 · **Decided by:** Lino (Teammate A), at the team's instruction to carry out the restructure without the usual review; Zeyad Khaled to confirm

## Context
The phone app will be React Native with Expo, which needs its own `package.json` and bundler configuration. Nothing in
the repository had a place for it. Documents were spread over the root, `adr/`, `demo/` and `docs/`.

## Decision
- npm workspaces: the root `package.json` stays the server package and becomes the workspaces root with one workspace,
  `src/apps/mobile` (the Expo app). One lockfile, one `npm ci`.
- `tsconfig.base.json` holds the strict options; the root `tsconfig.json` checks the server, the shared client,
  the fitness functions, `db/` and `demo/`; `src/apps/mobile/tsconfig.json` checks the app and the shared client
  without Node types.
- `src/apps/shared-client` stays a folder of the root package. Server-side tests import it by relative path; the app
  imports it through the path alias `@sayes/shared-client/*`, and the Metro bundler watches the folder.
- Every document lives under `docs/`. `README.md`, `AGENTS.md` and `CLAUDE.md` stay at the root because tools load
  them from there; `.github/pull_request_template.md` stays where GitHub loads it.

## Alternatives rejected
- A separate npm project for the app: two lockfiles and two installs.
- pnpm, Yarn, Turborepo or Nx: a new tool for two packages.
- The shared client as its own workspace package: it imports one server file (`request-id.ts`), which would have to be
  duplicated or moved to a third package.

## Consequences
- Easier: the app and the server share one install and one client library.
- Harder: `npm ci` also installs the app's dependencies for server-only work.

## Related
ADR-18, ADR-20.
