-- Planted violation for F10: a plate column outside the personal_data schema.
CREATE SCHEMA IF NOT EXISTS ticketing;
CREATE TABLE ticketing.tickets (
  id bigint PRIMARY KEY,
  driver_ref text NOT NULL,
  plate text NOT NULL,
  CONSTRAINT one_open_per_plate UNIQUE (plate)
);
ALTER TABLE ticketing.tickets ADD COLUMN driver_phone text;
