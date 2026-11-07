# ADR-14: Audit entries carry no personal data; each write declares its redaction

**Status:** Accepted · **Date:** 2026-11-07 · **Decided by:** Zeyad Khaled

## Context
Review day (section 17, P2): "the pipeline copies the whole request body into the audit entry; plates, coordinates,
passwords and names would live for ever in the hash-chained log, defeating erasure. Four of Lino's writes (add car,
record location, set committee password, create person) are built but unregistered for this reason; Mahi's assisted
ticket too." An append-only, hash-chained log (ADR-10) cannot be erased, so whatever enters it must already be free of
personal data (Rule F, Law 151 of 2020).

## Decision
"(a) each write operation declares `audit: { omit: [...] }` or `replace: { field: 'reference' }`; the pipeline strips
or substitutes before writing the entry; a new fitness function (F12) fails any schema with a field named plate, phone,
name, password, latitude or longitude that has no redaction rule. References (b) are used where they already exist
(carRef)."

In code: `WriteOperation.audit` and `PublicWriteOperation.audit` take `AuditRedaction`. `omit` drops a body field.
`replace` drops the field and writes, under the declared name, the reference the handler returned in
`AuditDetail.references` (for example `{ replace: { plate: 'carRef' } }`). A `replace` whose reference the handler did
not return throws, so the write rolls back and no entry with the value exists. F12 reads the composed registry.

## Alternatives rejected
- (c) Modules writing their own entries: loses the one-entry-per-write guarantee of section 8 and gives every module a
  second way to touch the log.
- Redacting by a global field list at run time only: catches today's names and nothing else; the declaration makes the
  owner say what the entry may carry, and F12 makes forgetting fail the build.

## Consequences
- Easier: Lino's four writes and Mahi's assisted ticket can be registered; erasure stays possible because the log holds
  references, never values.
- Harder: an owner must think about the entry when writing a schema; a replaced field needs the handler to return the
  reference. The word list of F12 is a heuristic and will grow.

## Related
ADR-06 (Rule F, personal data behind pseudonyms), ADR-10 (append-only log), ADR-13, P9 (logged reads).
