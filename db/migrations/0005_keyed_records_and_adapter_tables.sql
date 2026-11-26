-- 0005_keyed_records_and_adapter_tables.sql — what the PostgreSQL adapters need (ADR-21). Additions only.
--
-- 1. Records stored whole, under their key, in their owner's schema. A module's store reads and writes plain records
--    through TableAccess; the adapter keeps each one as `json` (exactly the text written, key order included) in the
--    `records` table of the schema its table name starts with, so names, phones and plates stay in personal_data
--    (Rule F). `position` keeps the order records were first written, which `list` returns. The column tables of
--    0002 and 0004 stay as they are and unused.
-- 2. The repeat store keeps the hash of the body beside the stored answer (P19), and an answer may have no body.
-- 3. The sliding-window rate limiter shared by every server copy (ADR-15).
-- 4. The outbox delivers in the order events were published; payloads are kept exactly as written.
-- 5. An audit record without subjects keeps none: absent stays absent, so the hash chain verifies (ADR-10). This changes
--    a column's default and nullability only; no row of audit_log is updated or deleted, ever.
-- Run as the database owner after 0004 (npm run db:migrate).

CREATE TABLE IF NOT EXISTS personal_data.records (
  record_table text   NOT NULL,
  record_key   text   NOT NULL,
  position     bigint GENERATED ALWAYS AS IDENTITY,
  record       json   NOT NULL,
  PRIMARY KEY (record_table, record_key)
);
CREATE TABLE IF NOT EXISTS accounts_and_access_control.records (
  record_table text   NOT NULL,
  record_key   text   NOT NULL,
  position     bigint GENERATED ALWAYS AS IDENTITY,
  record       json   NOT NULL,
  PRIMARY KEY (record_table, record_key)
);
CREATE TABLE IF NOT EXISTS sites_and_areas.records (
  record_table text   NOT NULL,
  record_key   text   NOT NULL,
  position     bigint GENERATED ALWAYS AS IDENTITY,
  record       json   NOT NULL,
  PRIMARY KEY (record_table, record_key)
);
CREATE TABLE IF NOT EXISTS licensing_assignment_attendance.records (
  record_table text   NOT NULL,
  record_key   text   NOT NULL,
  position     bigint GENERATED ALWAYS AS IDENTITY,
  record       json   NOT NULL,
  PRIMARY KEY (record_table, record_key)
);
CREATE TABLE IF NOT EXISTS ticketing.records (
  record_table text   NOT NULL,
  record_key   text   NOT NULL,
  position     bigint GENERATED ALWAYS AS IDENTITY,
  record       json   NOT NULL,
  PRIMARY KEY (record_table, record_key)
);
CREATE TABLE IF NOT EXISTS payments.records (
  record_table text   NOT NULL,
  record_key   text   NOT NULL,
  position     bigint GENERATED ALWAYS AS IDENTITY,
  record       json   NOT NULL,
  PRIMARY KEY (record_table, record_key)
);
-- Records whose table name names no module schema (for example the foundation's example actions) live here.
CREATE TABLE IF NOT EXISTS foundation.records (
  record_table text   NOT NULL,
  record_key   text   NOT NULL,
  position     bigint GENERATED ALWAYS AS IDENTITY,
  record       json   NOT NULL,
  PRIMARY KEY (record_table, record_key)
);

-- Erasure removes personal records, so the application role may delete records (never audit_log rows).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  personal_data.records, accounts_and_access_control.records, sites_and_areas.records,
  licensing_assignment_attendance.records, ticketing.records, payments.records, foundation.records
TO sayes_application;
GRANT USAGE ON SCHEMA ticketing, payments, foundation TO sayes_application;

ALTER TABLE foundation.write_responses ADD COLUMN IF NOT EXISTS body_hash char(64) NOT NULL;
ALTER TABLE foundation.write_responses ALTER COLUMN body TYPE json USING body::json;
ALTER TABLE foundation.write_responses ALTER COLUMN body DROP NOT NULL;

CREATE TABLE IF NOT EXISTS foundation.rate_limit_attempts (
  position     bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attempt_key  text        NOT NULL,
  attempted_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limit_attempts_key_idx ON foundation.rate_limit_attempts (attempt_key, attempted_at);
GRANT SELECT, INSERT, DELETE ON foundation.rate_limit_attempts TO sayes_application;

ALTER TABLE foundation.outbox ADD COLUMN IF NOT EXISTS position bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE foundation.outbox ALTER COLUMN payload TYPE json USING payload::json;

ALTER TABLE audit_log.audit_log ALTER COLUMN subject_person_ids DROP DEFAULT;
ALTER TABLE audit_log.audit_log ALTER COLUMN subject_person_ids DROP NOT NULL;
