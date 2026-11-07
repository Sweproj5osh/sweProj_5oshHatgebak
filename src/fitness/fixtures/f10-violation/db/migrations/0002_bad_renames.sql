-- Planted violations for F10: a quoted camel-case personal column, and a column renamed INTO a personal name.
CREATE TABLE ticketing.receipts (id bigint PRIMARY KEY, "driverName" text);
ALTER TABLE ticketing.tickets RENAME COLUMN car_ref TO plate;
