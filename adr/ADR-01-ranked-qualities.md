# ADR-01: Qualities ranked — integrity, accountability, reliability and availability, security

**Status:** Accepted · **Date:** 2026-11-04 · **Decided by:** Zeyad Khaled

## Context
The system exists to organize street parking that today has no organization at all, and to prevent stealing, bullying
and every other abuse (goal 1). Revenue reaching the committee and lawful handling of personal data are important but
are not the reason the system is built (goal 2). Every architecture characteristic adds complexity to every component,
so only a few can be first-class, and the team needs one rule for settling conflicts between them.

## Decision
1. **Integrity**: the data can never be wrong or forged (exactly as many tickets as spaces; a fee never above the cap;
   ticket times frozen at the exit scan).
2. **Accountability**: every action is traceable to one person, with the reason and the approver.
3. **Reliability and availability**, together: the system behaves correctly when something fails, and stays up when a
   component fails.
4. **Security**: only the right role, in the right scope, can act.

Conflict rule: the lower rank gives way. When the server cannot be reached, the system refuses rather than guesses
(reliability yields to integrity). If the audit log cannot be written, the action does not happen (accountability
outranks availability). Deliverability never justifies weakening ranks 1–4.

Privacy (Law 151 of 2020) is a constraint that is obeyed, not a ranked quality. Usability for attendants is a design
principle (one or two taps per action). Performance, scalability and cost are unranked and get no quality gate.

## Alternatives rejected
- Ranking usability or deliverability: the team accepts a harder build; "too hard for December" is not an argument.
- Ranking scalability: Greater Cairo's volume is met by running copies of one server (ADR-03), not by a quality gate.

## Consequences
- Easier: every later decision has a tie-breaker; fitness functions F3–F7 follow directly from ranks 1–2.
- Harder: the system will sometimes refuse a driver or an attendant rather than risk a wrong record.

## Related
All other records depend on this ranking.
