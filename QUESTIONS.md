# Questions for Zeyad from the foundation 2 branch

Where the brief was silent, the code keeps the behaviour `main` had and the question is written here. Nothing below
was decided; each item names what the branch does today so the decision can be checked against running code.

1. **Branch name.** `foundation/2-review-decisions` cannot exist: a branch named `foundation` already exists locally
   and on `origin`, and Git cannot hold both `foundation` and `foundation/<anything>`. The branch is
   `foundation-2-review-decisions`. Rename or delete `foundation` (`git branch -m foundation foundation/1-skeleton`,
   then the same on origin) if the `foundation/<task-ids>` rule of section 12.1 should hold.

2. **The in-memory server has nobody in it.** `main.ts` composes the real accounts module over empty in-memory stores,
   and the live-status check now refuses every token whose person the module does not know. So `npm start` serves
   401 and 403 and nothing else until a Chair exists. `bootstrapChair(phone, name)` is "for the system operator only".
   How should the in-memory server get its first Chair: environment variables read by `main.ts`, a one-off command, or
   not at all (only the PostgreSQL deployment is bootstrapped)? The smoke test used a scratch script that composes the
   application, bootstraps a Chair and creates an attendant and a driver through `PersonalData`, then listens.

3. **`SiteLocator` is filled with "no sites".** The accounts module needs a `SiteLocator`; no site registry
   implementation exists on `main`, so the composition root hands it one that knows no site or zone, and every
   staff-scoped request naming a place is refused as "unknown or inconsistent place" until Lino's registry fills the
   port. Who fills it: the composition root from Lino's module, or Lino's `operations(dependencies)` line?

4. **Lino's `signIn` must mint tokens, but modules may not import `src/entrypoint` (F2).** `issueToken` lives in
   `src/entrypoint/auth/token.ts`. Proposal, not built: a `TokenIssuer` port in `src/shared` (`issue(identity)`),
   filled by the composition root and handed to the accounts module through `ModuleDependencies`.

5. **The audit entry's actor is now a union and the migration does not know it.** `AuditEntry.personId` and `role`
   became `actor: { kind: 'person', personId, role } | { kind: 'anonymous', address }` (ADR-15). Migration
   `0001_schemas.sql` has `person_id` and `role` as NOT NULL columns and no `address`. A migration `0003_…` is needed
   (one migration per pull request, numbering at rebase time, P26 Q5); not written because it changes a schema Zeyad
   owns. Shape proposed: `actor_kind text NOT NULL`, `person_id` and `role` nullable, `address text` nullable, with a
   CHECK that exactly one of the two shapes is filled.

6. **Where a `replace` reference comes from.** The brief says `replace: { plate: 'carRef' }` writes `carRef` "from the
   outcome's detail". For type safety the handler returns it under `AuditDetail.references` (`{ references: { carRef:
   'car-7' } }`), not as a loose field on the detail. Confirm or flatten.

7. **F11's name heuristic still applies to `localDateTime` fields.** A committee operation may declare
   `closedFrom: 'localDateTime'`, but `startDate: 'localDateTime'` still fails F11 because the key name looks like a
   timestamp. Keep (names stay honest) or exempt declared `localDateTime` fields from the name rule?

8. **Rate-limit keys are global across public operations.** "5 per phone per 10 minutes" is counted over every public
   operation together (`requestSignInCode` and `signIn` share the phone's five), likewise 30 per address. Per
   operation would double both. Confirm.

9. **Telemetry obeys the server clock rule.** The brief lists "body validated" for telemetry and says nothing about
   timestamps; the branch applies Rule I to telemetry bodies too, and validates the body before counting the attempt
   against the one-per-minute limit, so a malformed reading does not use up the slot. Confirm.

10. **`open` reads skip the permission table entirely.** "open: any valid token" is implemented literally: the declared
    `allowedRoles` of an open read are documentation. If an open read should still be refused to some role, the table
    must apply and the owner must list all five roles.

11. **Staff-scoped reads take their place from the query string.** The keys read are exactly `siteId`, `zoneId` and
    `districtId`; a query naming none asks for the system-wide scope (Chair only under Lino's rules). Confirm the key
    names.

12. **Who may read an anonymous entry.** `readByScope` shows an anonymous (sign-in) entry to the Chair, to a Member whose
    district it names, and to any person named in `subjectPersonIds`; nobody "made" it. Confirm.

13. **"Touches personal data" is self-declared.** F5's rule "every read whose schema or result touches personal data
    must be logged" cannot be detected statically from a read (no schema, free result), so a read declares
    `audit: { touchesPersonalData: true }` and F5 fails it when it is not `logged`. An owner who omits the declaration
    escapes the check; review must look for it.

14. **`Row` is `object`.** `TableAccess` rows are typed as `object` so that module interfaces (`AuditRecord`,
    `StoredEvent`) fit without an index signature; the one cast lives in the in-memory adapter's `rows()` helper.
