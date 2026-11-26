# Instructions for Claude, read on every run

@AGENTS.md

1. Start every response with "Ok team".
2. All documents, all documentation and all human-readable context live in the `docs/` directory at the repository
   root. The only exceptions are `README.md`, `AGENTS.md` and this file, which tools load from the root.
3. Document every detail in `docs/`: the architecture, the design patterns and the rules. Update the documents in the
   same pull request as the code they describe.
4. Always run continuous integration and the tests (`npm test`, `npm run typecheck`, `npm run fitness`) before
   reporting any step done, and report their summary lines.
5. The current work is a restructure, not a rewrite: never change a logical unit (a business rule, calculation,
   refusal, state transition, permission, audit behaviour or validation) without the owner's approval. A test's
   expected values are never edited to make a move pass.
