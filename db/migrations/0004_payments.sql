-- 0004_payments.sql — the payments table (Area 4, tasks C2 to C4; decisions P18 and P19).
-- One row per payment attempt. The row is written before the provider is asked and its state moves from pending to
-- paid or failed when the provider's final answer arrives; amounts are never edited, a correction is a new row (C7).
-- Grants as in 0001. Safe to run twice.

CREATE TABLE IF NOT EXISTS payments.payments (
  payment_id           text PRIMARY KEY,
  ticket_id            text NOT NULL,
  -- The write's request id, the provider's idempotency key (ADR-08). UNIQUE so the database refuses a double charge
  -- even if the pipeline's repeat check and the ledger's guard were both bypassed (P19).
  request_id           text NOT NULL UNIQUE,
  payer_id             text NOT NULL,
  amount               numeric(12, 2) NOT NULL CHECK (amount >= 0),
  method               text NOT NULL CHECK (method IN ('app', 'cash', 'correction')),
  -- The state of the attempt (P18), never of the ticket: pending until the provider's final answer.
  state                text NOT NULL CHECK (state IN ('pending', 'paid', 'failed')),
  provider_reference   text,
  -- What the provider literally said when it was not paid, declined or pending (an adapter error, Rule B).
  raw_provider_outcome text,
  reason               text,
  recorded_at          timestamptz NOT NULL,
  settled_at           timestamptz
);

-- One live attempt per ticket: a second pending or paid row for a ticket is refused by the database itself, which is
-- the guard across server copies where the ledger's per-process lock cannot reach (P18, P19).
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_live_attempt_per_ticket_idx
  ON payments.payments (ticket_id)
  WHERE state IN ('pending', 'paid');

CREATE INDEX IF NOT EXISTS payments_pending_idx ON payments.payments (recorded_at) WHERE state = 'pending';

-- The application role adds attempts and moves their state; it never deletes a payment row.
GRANT USAGE ON SCHEMA payments TO sayes_application;
GRANT SELECT, INSERT, UPDATE ON payments.payments TO sayes_application;
REVOKE DELETE, TRUNCATE ON payments.payments FROM sayes_application;
