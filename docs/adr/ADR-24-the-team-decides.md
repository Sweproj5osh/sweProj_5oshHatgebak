# ADR-24: The team decides; any other teammate's review merges a pull request

**Status:** Accepted · **Date:** 2026-11-26 · **Decided by:** the team (recorded by Lino, Teammate A, the scrum master)

## Context
The rules named one person as "the architect and the only decision maker", required his review on every pull request
(`.github/CODEOWNERS`: `* @Zab-17`), made him the one who decides every rule change, and gave him Area 1 alone. The
team does not hold that arrangement: Zeyad Khaled is a teammate, not the architect or the only decision maker.

## Decision
- Decisions, including every rule change and every decision record, are the team's. A record says "Decided by: the
  team".
- A pull request merges after green tests, green fitness functions and one review by a teammate other than its author.
  `.github/CODEOWNERS` names no required reviewer.
- Area 1 (the foundation folders, the audit log, the scheduler) is owned by the team.
- The earlier records keep their history: ADR-01 to ADR-15 say who wrote them and when.

## Alternatives rejected
- One architect who decides alone: not how the team works.
- Naming a replacement architect: the team chose collective decisions.

## Consequences
- Easier: no single person blocks a merge or a rule change.
- Harder: the team must agree; a disagreement is settled by the team, recorded in a new decision record.

## Related
Supersedes the governance parts of `docs/rules/ARCHITECTURE_RULES.md` (the header, sections 12, 13 and 16) and of
`docs/team/TEAM_TASKS.md` (rule 6). Changes the status lines of ADR-01 to ADR-23.
