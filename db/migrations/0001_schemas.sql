-- 0001_schemas.sql — the database bootstrap (task Z2).
-- One schema per module (ADR-06: one writer per table), a separate personal_data schema (Rule F), a foundation
-- schema for the two tables no module owns (outbox, write_responses), the append-only audit_log table (ADR-10), and
-- the application role that may insert into and read audit_log but never update or delete it.
-- Run as the database owner. Safe to run twice.

-- One schema per module.
CREATE SCHEMA IF NOT EXISTS sites_and_areas;
CREATE SCHEMA IF NOT EXISTS ticketing;
CREATE SCHEMA IF NOT EXISTS committee_prices;
CREATE SCHEMA IF NOT EXISTS payments;
CREATE SCHEMA IF NOT EXISTS cash_custody;
CREATE SCHEMA IF NOT EXISTS accounts_and_access_control;
CREATE SCHEMA IF NOT EXISTS licensing_assignment_attendance;
CREATE SCHEMA IF NOT EXISTS approvals;
CREATE SCHEMA IF NOT EXISTS complaints_inspections_ratings;
CREATE SCHEMA IF NOT EXISTS money_check_dashboard;
CREATE SCHEMA IF NOT EXISTS audit_log;
CREATE SCHEMA IF NOT EXISTS scheduler;
CREATE SCHEMA IF NOT EXISTS notifications;
CREATE SCHEMA IF NOT EXISTS evidence;

-- Names, phones, plates and cars live here and nowhere else (fitness function F10).
CREATE SCHEMA IF NOT EXISTS personal_data;

-- Tables that belong to the foundation rather than to a module.
CREATE SCHEMA IF NOT EXISTS foundation;

-- The audit log: every row is chained to the previous one by hash (ADR-10).
-- The PostgreSQL adapter takes pg_advisory_xact_lock(<constant>) inside the write's transaction before reading the
-- last row and inserting the next, so that several server copies never fork the chain.
CREATE TABLE IF NOT EXISTS audit_log.audit_log (
  id                 bigint PRIMARY KEY,
  prev_hash          char(64) NOT NULL,
  hash               char(64) NOT NULL UNIQUE,
  person_id          text NOT NULL,
  role               text NOT NULL CHECK (role IN ('driver', 'attendant', 'inspector', 'member', 'chair', 'system')),
  operation          text NOT NULL,
  input              jsonb NOT NULL,
  reason             text,
  approver_id        text,
  request_id         text NOT NULL,
  recorded_at        timestamptz NOT NULL,
  district_id        text,
  subject_person_ids text[] NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS audit_log_district_idx ON audit_log.audit_log (district_id, id);
CREATE INDEX IF NOT EXISTS audit_log_person_idx ON audit_log.audit_log (person_id, id);

-- Events written in the publisher's transaction and delivered later by the outbox job (ADR-07).
CREATE TABLE IF NOT EXISTS foundation.outbox (
  id                uuid PRIMARY KEY,
  topic             text NOT NULL,
  payload           jsonb NOT NULL,
  published_at      timestamptz NOT NULL,
  delivered_at      timestamptz,
  delivery_attempts integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS outbox_undelivered_idx ON foundation.outbox (published_at) WHERE delivered_at IS NULL;

-- The first response of every committed write, keyed by person and request id (ADR-08, Rule H).
CREATE TABLE IF NOT EXISTS foundation.write_responses (
  response_key text PRIMARY KEY,
  status       integer NOT NULL,
  body         jsonb NOT NULL,
  stored_at    timestamptz NOT NULL
);

-- The role the server connects as. It can append to and read the audit log; it cannot change or remove a row.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sayes_application') THEN
    CREATE ROLE sayes_application NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA
  sites_and_areas, ticketing, committee_prices, payments, cash_custody, accounts_and_access_control,
  licensing_assignment_attendance, approvals, complaints_inspections_ratings, money_check_dashboard, audit_log,
  scheduler, notifications, evidence, personal_data, foundation
TO sayes_application;

GRANT SELECT, INSERT ON audit_log.audit_log TO sayes_application;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log.audit_log FROM sayes_application;

GRANT SELECT, INSERT, UPDATE ON foundation.outbox TO sayes_application;
GRANT SELECT, INSERT ON foundation.write_responses TO sayes_application;
