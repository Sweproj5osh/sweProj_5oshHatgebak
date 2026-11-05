-- 0002_identity_and_registry.sql — the tables of Area 2, Identity and registry (Teammate A).
-- Names, phones and plates live only in the personal_data schema (ADR-06, Rule F, fitness function F10). Every other
-- table holds a person reference or a car reference, never the data itself.
-- Run as the database owner after 0001_schemas.sql. Safe to run twice.

-- People as the rest of the system sees them: a reference, one role and an account status (task A1, A2).
CREATE TABLE IF NOT EXISTS accounts_and_access_control.people (
  person_id  text PRIMARY KEY,
  role       text NOT NULL CHECK (role IN ('driver', 'attendant', 'inspector', 'member', 'chair')),
  status     text NOT NULL CHECK (status IN ('active', 'suspended', 'revoked')),
  erased     boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A person's name and phone (task A2). Removed by erasure (task A5); the people row stays.
CREATE TABLE IF NOT EXISTS personal_data.person_details (
  person_ref   text PRIMARY KEY REFERENCES accounts_and_access_control.people (person_id),
  display_name text NOT NULL,
  phone        text NOT NULL UNIQUE
);

-- Cars and their plates (task A4). Other tables hold car_ref only; showing a plate is a logged join.
CREATE TABLE IF NOT EXISTS personal_data.cars (
  car_ref   text PRIMARY KEY,
  owner_ref text NOT NULL REFERENCES accounts_and_access_control.people (person_id),
  plate     text NOT NULL,
  UNIQUE (owner_ref, plate)
);

-- Erasure deletes personal rows, so the application role may delete in personal_data but nowhere in audit_log.
GRANT SELECT, INSERT, UPDATE ON accounts_and_access_control.people TO sayes_application;
GRANT SELECT, INSERT, DELETE ON personal_data.person_details, personal_data.cars TO sayes_application;

-- What access control knows about each person's licence and posts (task A3). Written by the licensing module inside
-- its own transaction, so that permission answers never wait on that may-fail module (Rule D). bound_site_id is the
-- site an attendant's session is bound to at clock-in.
CREATE TABLE IF NOT EXISTS accounts_and_access_control.access_facts (
  person_id          text PRIMARY KEY REFERENCES accounts_and_access_control.people (person_id),
  licence_state      text CHECK (licence_state IN ('valid', 'suspended', 'revoked')),
  attendant_site_id  text,
  inspector_zone_id  text,
  member_district_id text,
  bound_site_id      text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON accounts_and_access_control.access_facts TO sayes_application;
