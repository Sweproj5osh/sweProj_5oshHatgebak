# ADR-18: One app for every role; the first screen asks the role

**Status:** Accepted · **Date:** 2026-11-25 · **Decided by:** the team (recorded by Lino, Teammate A, the scrum master; ADR-24)

## Context
ADR-05 chose two apps (a Driver App, and a Staff App with a web build). The team chose one app instead: the first
screen asks who is signing in (driver, attendant, inspector, committee).

## Decision
- One Expo app at `src/apps/mobile`.
- The first screen asks the role. The choice only selects the sign-in flow: the phone and code (`POST /sessions`) for
  a driver, attendant or inspector, or the phone, code and password (`POST /committee-sessions`) for the committee.
- The server still decides who the person is and what their role is (Rule A, ADR-10). Sending the chosen role to the
  server and refusing a mismatch would change sign-in and is not part of this decision.

## Alternatives rejected
- Two apps (ADR-05): two release trains for a team of five.

## Consequences
- Easier: one codebase, one release, one sign-in screen.
- Harder: drivers download staff screens; the app must still hide what a role may not do, and the server still refuses.
  Whether a web build exists for committee work is left open.

## Related
Supersedes ADR-05. ADR-02 (Rule A), ADR-10, ADR-15.
