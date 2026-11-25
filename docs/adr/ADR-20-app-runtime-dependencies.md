# ADR-20: Runtime dependencies of the app: Expo, React, React Native, expo-crypto

**Status:** Accepted · **Date:** 2026-11-25 · **Decided by:** Lino (Teammate A), at the team's instruction to carry out the restructure without the usual review; Zeyad Khaled to confirm

## Context
The app is built with Expo (ADR-18). AGENTS.md rule 7 requires a decision record before any new runtime dependency.

## Decision
The workspace `src/apps/mobile` depends on `expo`, `react`, `react-native` and `expo-crypto` (and `expo-status-bar`,
which the Expo template uses), at the versions of the current Expo SDK. `expo-crypto` gives the request ids their
random version 4 UUID, because the phone's JavaScript engine has no `crypto.randomUUID`; the shared client's
`RequestIdKeeper` already takes the generator as a constructor parameter. The server never imports any of them.

## Alternatives rejected
- A bare React Native project: more native set-up for the same result.
- A UUID library: `expo-crypto` comes with the SDK.

## Consequences
- Easier: one toolchain for iPhone, Android and, later, the web.
- Harder: the app follows Expo's release cycle.

## Related
ADR-17, ADR-18.
