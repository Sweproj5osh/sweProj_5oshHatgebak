# Fitness fixtures

Each folder is a tiny fake repository root that breaks exactly one fitness function, so the test suite can prove
that the function is able to fail. Nothing here is compiled, run or imported by production code.

## F1 and test files
F1 skips `*.test.ts` (P28 #28): `f1-violation` holds a test file importing the test runner and another module beside
the leaky production file, and the suite asserts that only the production file's two imports are reported.

## Known limit of the import scanner (F1, F2, F8)
The scanner reads import statements and `import('literal')` calls as text. A dynamic import whose path is built at run
time (`import('../../audit-log/internal/' + 'read-scope')`, a variable, a template string) is invisible to it; no
fixture plants one because none of the three functions can catch it. Review is the only guard against that shape, and
the review checklist names it.
