# ADR-03: One deployable unit — a modular monolith with Clean Architecture inside, run as stateless copies

**Status:** Accepted · **Date:** 2026-11-04 · **Decided by:** Zeyad Khaled

## Context
An architecture quantum is a piece deployed on its own with its own qualities. A second quantum is worth its cost only
when a part needs different qualities from the rest. The system must eventually serve millions of drivers (Greater
Cairo has roughly three million cars) and must stay on when a component fails (availability, rank 3). Integrity (rank 1)
needs the capacity check, the ticket insert and the audit entry to succeed or fail together.

## Decision
One quantum for the main system:
- **Modular monolith**: fourteen modules, each with a declared public interface; a build-time check fails any import of
  another module's internals.
- **Clean Architecture inside each module**: domain → use cases → adapters; the Dependency Rule means Committee Prices
  and Approvals hold no database or network code and are unit-tested in milliseconds.
- **Stateless server, horizontal copies** behind a load balancer; every request carries its token; nothing is kept in
  process memory between requests.
- **One database** with read copies for dashboards, partitionable by governorate later (every row already carries a
  district id).
- **Containment, not distribution, for availability**: components are split into a must-stay-on set (Accounts & Access
  Control, Sites & Areas, Ticketing, Committee Prices, Payments, Audit Log) and a may-fail set (everything else). **Rule
  D**: nothing in the must-stay-on set calls anything in the may-fail set synchronously; a failure in the may-fail set
  is caught at the module boundary and the request fails alone.

Capacity reasoning: one million tickets a day is about twelve scans a second on average and about a hundred at peak;
one server process serves thousands of requests a second and one PostgreSQL database thousands of writes a second. The
only lock is one site's row for milliseconds; different sites never block each other. Scale comes from copies.

## Alternatives rejected
- **Microservices**: a cross-network transaction weakens integrity and accountability for scale that is not needed below
  Egypt-wide, and costs operations work a five-student team cannot spend.
- **Plain layered monolith**: boundaries erode without enforcement; "Prices is pure" would not survive two sprints.
- **Separate Audit Log service**: a ticket could succeed while its audit entry fails over the network.
- **Separate Money Check service**: needs its own copy of the data, which drifts; a read copy or nightly totals cure the
  load risk instead.

## Consequences
- Easier: integrity and accountability live in one transaction; one deployment; one test suite.
- Harder: a bug in a must-stay-on module affects every copy; containment is a coding discipline (fitness function F8).
- The Money Check load on the hot path is a known risk with a known cure (read copy or nightly totals).

## Related
ADR-01, ADR-02, ADR-04 (the one exception), ADR-07.
