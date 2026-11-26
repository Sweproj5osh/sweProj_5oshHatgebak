# Fitness functions

`npm run fitness` runs the static ones; `npm test` runs the ones that are tests. One function alone:
`npx tsx src/fitness/f14-production-code-never-reaches-test-code.ts`.

| | What it checks | Kind | Decision (ADR-16) | Why |
|---|---|---|---|---|
| F1 | committee-prices production files import nothing outside their folder | static | kept | pure fee calculation, Rule C |
| F2 | cross-module imports only through `public.ts`; modules and apps never import the entry point | static | dropped | it guarded folders, not a business rule; the `public.ts`/`internal/` split goes |
| F3 | twenty parallel opens on five spaces give five tickets | test | kept | never more tickets than spaces |
| F4 | fee never above the cap for any input | test | kept | integrity of the fee |
| F5 | one audit entry per successful write, none per failure or telemetry; personal reads logged | test | kept | accountability |
| F6 | the application role cannot update or delete `audit_log`; the chain verifies | test | kept | append-only audit log |
| F7 | the same request id twice gives the same answer and one change | test | kept | repeatable writes, Rule H |
| F8 | static half: no import from must-stay-on into may-fail | static | dropped; the behavioural half (Z14) stays | an import boundary; the may-fail modules are type-only today |
| F9 | the suite passes with the assistant stopped | test | kept (planned, Z15) | assistant isolation |
| F10 | no plate, phone or name column outside `personal_data` | static | kept | personal data stays in its store (Law 151, Rule F) |
| F11 | no timestamp field in a body schema; calendar times only on committee operations | static | kept | no timestamp from a client |
| F12 | every personal field in a write has a redaction rule | static | kept | personal-data redaction |
| F13 | only `requestSignInCode` and `signIn` are public | static | kept | sign-in is the only public operation |
| F14 | no production file imports test-only code (`*.test.ts`, `test-support/`, `testing/`, `src/fitness`); the composition root wires no storage adapter but the PostgreSQL ones | static | added | the running application never reaches a stand-in, a fake or any in-memory storage |

The fixtures live in `src/fitness/fixtures/`.

## Fitness fixtures

Each folder is a tiny fake repository root that breaks exactly one fitness function, so the test suite can prove
that the function is able to fail. Nothing here is compiled, run or imported by production code.

## F1 and test files
F1 skips `*.test.ts` (P28 #28): `f1-violation` holds a test file importing the test runner and another module beside
the leaky production file, and the suite asserts that only the production file's two imports are reported.

## Known limit of the import scanner (F1, F14)
The scanner reads import statements and `import('literal')` calls as text. A dynamic import whose path is built at run
time (`import('./testing/' + 'world')`, a variable, a template string) is invisible to it; no fixture plants one
because neither function can catch it. Review is the only guard against that shape, and
the review checklist names it.
