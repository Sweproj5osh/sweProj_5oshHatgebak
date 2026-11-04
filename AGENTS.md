# Instructions for AI coding agents working in this repository

1. Read `ARCHITECTURE_RULES.md` in full before writing or changing anything. It binds you exactly as it binds the
   people on the team.
2. Then read `adr/README.md` and the decision records your area's tasks name, and your area's rows in
   `docs/TEAM_TASKS.md`.
3. Work only inside the modules your owner (the teammate who invoked you) owns. Never edit another area's module;
   propose the change to that area's owner instead.
4. Work on a branch named `area-<letter>/<task-id>-<short-name>`, never on `main`. Open a pull request per task with
   the task id, how to test it, and the numbers the task asks for.
5. Before you report done: `npm test` and `npm run fitness` are green. Say so with the summary lines.
6. Plain English in code, comments, commit messages and pull requests: no abbreviation without its full form first,
   no pronoun whose noun is unclear.
7. Never add a runtime dependency, name a provider as chosen, accept a timestamp from a client, or touch `audit_log`
   with an update or delete. If a task seems to need one of these, stop and ask the owner; a decision record comes
   first.
