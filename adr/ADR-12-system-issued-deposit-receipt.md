# ADR-12: The system issues the cash-deposit receipt; the inspector confirms

**Status:** Accepted · **Date:** 2026-11-04 · **Decided by:** Zeyad Khaled

## Context
Earlier documents said the attendant records a cash deposit "with a receipt photo" of an outside paper receipt. Zeyad:
"What receipt photo? We print the receipt." The deposit hand-off is where cash disappears, so it needs one owner and one
record.

## Decision
- The attendant records the deposit (amount, shift, site). **Cash Custody** creates a numbered deposit record and prints
  or shows the receipt. No photograph.
- The **inspector confirms or rejects** the deposit against that record (the 2 November rule stands).
- The confirmed deposit feeds the money check through the DepositConfirmed event.

## Alternatives rejected
- Receipt photo: an outside paper is unverifiable and needs photo storage on the hot cash path.
- Committee confirms: the inspector is the field role closest to the attendant; the committee sees the result in the
  money check.

## Consequences
- Easier: one state machine (recorded → confirmed or rejected); Evidence is not involved in deposits.
- Harder: wording to fix in the requirements, design, deck, architecture document, element dictionary and the Figma
  board (see `uml/architecture_walkthrough_decisions.md`, Q4 wording-to-fix list).

## Related
ADR-02 (Cash Custody), ADR-07 (event).
