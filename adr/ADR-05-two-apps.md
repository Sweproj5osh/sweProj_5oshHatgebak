# ADR-05: Two apps; only the Staff App gets a web build

**Status:** Accepted · **Date:** 2026-11-04 · **Decided by:** Zeyad Khaled

## Context
Five roles. Drivers are not staff and should not download staff screens. Committee members work from a laptop as well as
a phone. "One app, three modes" was confirmed as a choice, not a constraint. With Rule A (no business rule in the apps)
the apps are thin, so splitting them buys little.

## Decision
- **Driver App** (phone only).
- **Staff App** with attendant, inspector and committee modes, plus a **web build of the Staff App only**, used for
  committee mode on a laptop and for maintenance. No web build for drivers.

## Alternatives rejected
- Three apps (committee split out): independent releases, but three codebases for a team of five and nothing to gain
  once the apps hold no rules.
- A web build for drivers: no need; drivers always have the phone that scans.

## Consequences
- Easier: one staff codebase, shared login and scanning, one release.
- Harder: the Staff App must hide modes a role does not have, and the server must still refuse the request if the app
  shows the wrong screen (Rule A).

## Related
ADR-02 (Rule A), ADR-10 (role checks on the server).
