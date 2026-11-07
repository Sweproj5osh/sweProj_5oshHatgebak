-- Migration 0003 (foundation 2, ADR-15 and item 15 of the review-day decisions): the audit record's actor and the
-- chain head.
--
-- 1. The actor of an audit record is one of three shapes. A signed-in person has person_id and role; an anonymous caller
--    of a public operation (sign-in, ADR-15) has only the client address; the system itself (the one-time bootstrap of
--    the first Chair) has neither. actor_kind names the shape and a CHECK keeps exactly one shape filled.
-- 2. audit_log.head is ONE row naming the last record's id and hash. Every append moves it inside the same transaction,
--    so a log cut at its tail no longer verifies. It is not the log itself: the application role may UPDATE it (the
--    log stays INSERT-only, migration 0001).

ALTER TABLE audit_log.audit_log ALTER COLUMN person_id DROP NOT NULL;
ALTER TABLE audit_log.audit_log ALTER COLUMN role DROP NOT NULL;
ALTER TABLE audit_log.audit_log ADD COLUMN IF NOT EXISTS actor_kind text NOT NULL DEFAULT 'person'
  CHECK (actor_kind IN ('person', 'anonymous', 'system'));
ALTER TABLE audit_log.audit_log ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE audit_log.audit_log ALTER COLUMN actor_kind DROP DEFAULT;

ALTER TABLE audit_log.audit_log ADD CONSTRAINT audit_log_actor_has_exactly_one_shape CHECK (
  (actor_kind = 'person'    AND person_id IS NOT NULL AND role IS NOT NULL AND address IS NULL) OR
  (actor_kind = 'anonymous' AND person_id IS NULL     AND role IS NULL     AND address IS NOT NULL) OR
  (actor_kind = 'system'    AND person_id IS NULL     AND role IS NULL     AND address IS NULL)
);

-- The head: one row, kept there by a primary key that can hold only the value true.
CREATE TABLE IF NOT EXISTS audit_log.head (
  one_row   boolean PRIMARY KEY DEFAULT true CHECK (one_row),
  last_id   bigint   NOT NULL REFERENCES audit_log.audit_log (id),
  last_hash char(64) NOT NULL
);

-- Grants as in 0001: the log is insert-only for the application role; the head may be updated because it is not the
-- log, only the pointer to its end, and the chain verification compares it against the records.
GRANT SELECT, INSERT, UPDATE ON audit_log.head TO sayes_application;
REVOKE DELETE, TRUNCATE ON audit_log.head FROM sayes_application;
GRANT SELECT, INSERT ON audit_log.audit_log TO sayes_application;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log.audit_log FROM sayes_application;
