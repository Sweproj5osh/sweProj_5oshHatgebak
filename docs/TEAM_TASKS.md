# Team task sheet — Street Parking Management System

Written 4 November 2026 by Zeyad Khaled (architect) from the decisions in `adr/` and
`uml/architecture_walkthrough_decisions.md` section 16. Deadline 1 December 2026.

Five areas, one owner each. Each task says **what to build**, **what it must do**, **how to test it** and **what to
report**. How you build it inside your area is your call, within the rules below. A task is done when every test
passes, the numbers are reported, and the fitness functions stay green.

## Rules for everyone
1. Stay inside your area. You use another area only through its public interface; a build check fails otherwise.
2. Every write operation accepts a client request id. Sending the same id twice gives the same answer and changes
   the database once.
3. Every write operation leaves exactly one audit entry, written inside the same transaction. A failed write leaves none.
4. The apps hold no business rule: they display and collect; the server decides.
5. The server's clock is the only clock. No time, fee or count is ever taken from a phone.
6. Nothing merges without green tests, green fitness functions and one review by Zeyad.
7. Until the foundation (area 1) lands on day 3 (Saturday 7 November), build against in-memory stand-ins and unit tests. Do not wait.

Reading before you start: `adr/README.md`, then the records named in your area, then your area's rows in
`uml/architecture_walkthrough_decisions.md` Q12.

Two sprints, everything implemented by the end of the second.
- **Sprint 1: Wednesday 4 November → Saturday 14 November.** Foundation, then the driver path end to end (park, pay,
  receipt), attendant mode, licences and assignments, deposits and requests started. Days 1–3 are the foundation.
- **Sprint 2: Sunday 15 November → Tuesday 1 December.** Inspector and committee modes, the web build, approvals,
  money check, notifications, evidence, complaints, the Assistant service, and the real providers behind the ports.

---

## Area 1 — Foundation (Zeyad)
Records: ADR-03, ADR-07, ADR-08, ADR-10, ADR-11.

| # | Sprint | Build | It must | Test it by | Report |
|---|---|---|---|---|---|
| Z1 | 1 | The repository skeleton | Have one folder per module (fourteen) with a declared public interface and private internals; fail the build when a module reaches into another's internals | Importing a private file across modules → the build check fails; importing a public interface → passes | Number of modules; the check's run time |
| Z2 | 1 | The database bootstrap | One schema per module; a separate personal-data schema; an audit table the application cannot update or delete; an outbox table | As the application's database user, try to update and delete an audit row → both refused | Schemas created; the refusal messages |
| Z3 | 1 | The audit log | Append entries (who, role, what, when, why, approver, request id); chain each entry to the previous one by hash; verify the chain; read by scope (member: own district; Chair: all; others: entries about themselves) | Append 3 entries, verify → true; alter one in a test copy, verify → false; read as three roles and compare | Entries per second appended; verification time for 10,000 entries |
| Z4 | 1 | The entry point | Accept one token per request (one person, one role); refuse missing or bad tokens; check a permission table before any module runs | No token → 401; attendant calling a committee operation → 403; Chair → reaches the module | Count of operations in the permission table; refused-request latency |
| Z5 | 1 | Repeatable writes | Store each write's request id with its response; return the stored response on a repeat | Any write twice with one id → identical responses, one database change | Operations covered / total write operations (must be 100 %) |
| Z6 | 1 | Server clock rule | Reject any request body that carries a timestamp | Send a body with a time field → 400 | Endpoints scanned; violations (must be 0) |
| Z7 | 1 | The outbox and its delivery job | Write events in the caller's transaction; deliver each event to every subscriber at least once; mark delivered | Publish inside a rolled-back transaction → nothing; commit → one row; run the job → subscriber called; crash the job mid-way and rerun → no event lost | Events per second delivered; redelivery count |
| Z8 | 1 | The static fitness functions (F1, F2, F8-static, F10, F11) | Each one passes on the skeleton and fails on a planted violation | Run the suite; plant one violation per function and watch it go red | Suite run time; list of functions with a proving failure |
| Z9 | 1 | The audit-coverage check (F5) | Call every registered write operation once → one audit row; call it with bad input → zero rows | Run against every area as they merge | Operations covered / total |
| Z10 | 1 | Continuous integration | Run tests and fitness functions on every pull request; block merge on red | Open a pull request that breaks F1 → merge blocked | Average pipeline time |
| Z11 | 2 | The scheduler | Run due jobs once; retry failed jobs; never run a job twice for one due time | Register a job due now and one due tomorrow → one runs; make it fail → it retries | Jobs run; retries; duplicates (must be 0) |
| Z12 | 2 | Stale-ticket closing job | Close tickets open longer than the site's maximum, as the system, with an audit entry | A 30-hour ticket at a 24-hour site → closed; a 2-hour ticket → untouched | Tickets closed per run |
| Z13 | 2 | Retention job | Cut the ticket-to-person link 12 months after close; delete assistant history older than 90 days | Tickets aged 13 and 11 months → only the first loses its link | Links cut per run; history rows deleted |
| Z14 | 2 | Fault-containment test (F8-behavioural) | A failing reactor (notifications) never fails the action it reacts to | Make notifications throw; close a ticket → success | Pass/fail |
| Z15 | 2 | Assistant-isolation test (F9) | The whole main-system suite passes with the assistant service stopped | Stop the assistant; run everything | Pass/fail |
| Z16 | all | The decision records | Every rule change during the build gets a record in `adr/` | Review of each merged pull request | Records added |

---

## Area 2 — Identity and registry (Teammate A)
Records: ADR-02, ADR-05, ADR-06, ADR-10. Covers people, roles, scope, personal data, districts and sites, licences,
assignments and attendance.

| # | Sprint | Build | It must | Test it by | Report |
|---|---|---|---|---|---|
| A1 | 1 | People and sign-in | Create a person with a role; sign in by phone and one-time code (fake sender for now); issue a token | Sign in with the right code → token; wrong code → refused; three wrong codes → locked for a while | Sign-in success rate in tests; lock-out threshold |
| A2 | 1 | The personal-data store | Keep names, phones, plates and cars only in the separate store; everything else holds a reference | Search every other schema for a name, phone or plate column → none (fitness function F10) | Columns scanned; violations (0) |
| A3 | 1 | Permission and scope rules | Answer "may this person do this operation on this site/zone/district?" using the hierarchy Chair > Member (district) > Inspector (zone) > Attendant (site); re-check the live licence and account status on every request; bind an attendant session to a site at clock-in so a ticket request already carries its proven site | Inspector of zone 3 on a site in zone 4 → no; same zone → yes; Chair anywhere → yes; a revoked attendant → no on the very next call without a new login | Decision latency; number of rules |
| A4 | 1 | Cars and the plate on the receipt | Save a car to a driver; give a plate to the receipt, the attendant's cash list and the inspector's look-up only through a logged join | Read a receipt → plate shown and one "plate read" audit entry; an unrelated attendant asks for it → refused | Plate reads logged / plate reads served (100 %) |
| A5 | 1 | Erasure | Remove a person's name, phone, plates and cars; keep their tickets with an unresolvable reference | Erase, then open the person's old ticket → exists, plate not resolvable | Time to erase; tables touched |
| A6 | 1 | Districts, zones and sites | Create and edit districts, zones, sites (outline, capacity, hours); only a member of that district, or the Chair | Member of district 1 editing district 2 → refused; own district → saved | Sites created in test; refusal count |
| A7 | 1 | Site entry and exit codes | Generate signed codes bound to one site; recognise a forged or foreign code | Change one character → "forged"; present site 2's code at site 1 → "wrong site" | Forgeries detected / attempted (100 %) |
| A8 | 1 | Capacity changes with history | Change capacity with a reason; keep every past value with its date | Change 5 → 8; history shows both with dates; no reason → refused | History rows per site |
| A9 | 1 | Hours and special events | Say whether a site is open at a given moment, including declared closures and free periods | Ask during a declared event → closed/free as declared | Checks per second |
| A10 | 1 | Nearby sites | Return sites within a radius with price and a free-space band (free, few, full, unknown), sorted by distance | Seed 3 sites; ask from a point → correct order and bands | Query time for 1,000 sites |
| A11 | 1 | Licences | Issue a licence; move it through valid → suspended → revoked only when an approved request says so | Suspend directly → refused "needs an approved request"; via an approved request → suspended | Licence state changes logged / made (100 %) |
| A12 | 1 | Assignments | Assign an attendant to one fixed site and a changeable shift; assign an inspector to a zone; manage members (Chair only) | Assign a second site → refused "one site per attendant"; change the shift → saved; member creating a member → refused | Assignments in test |
| A13 | 2 | Attendance | Clock in and out by scanning the own site's code; refuse another site's code | Scan own code → clocked in; scan another site → refused | Clock-ins; refusals |
| A14 | 2 | Off-site flag | Raise a flag for the inspector when repeated location points during a shift are far from the site | 5 points 600 m away → flag; 1 point → no flag | Flags raised; false flags in test (0) |
| A15 | 2 | Committee two-step login | Require a second step (password plus code) for members and the Chair only | Member with phone code only → "second step required"; attendant → unaffected | Pass/fail per role |

---

## Area 3 — Parking and prices (Teammate B)
Records: ADR-01, ADR-02, ADR-06, ADR-08, ADR-09. Covers the committee's prices, the fee, tickets, the free-space count,
the receipt, and fitness functions F3 and F4.

| # | Sprint | Build | It must | Test it by | Report |
|---|---|---|---|---|---|
| B1 | 1 | The fee calculator | Compute the fee from entry time, exit time and a dated price version (first hour, each later hour, daily cap) with no database, network or other module involved | 10:00→10:30 at {10, 5, cap 50} → 10; 10:00→13:10 → 25; 10:00→next day → 50; fitness function F1 passes | Test count; computations per second |
| B2 | 1 | The cap guarantee (F4) | Never return a fee above the version's cap or below zero, for any input | 1,000 random time pairs and versions | Cases run; violations (0) |
| B3 | 1 | Dated price versions | Return the version valid at a given moment; accept new versions only from the approvals area | Versions dated 1 Oct and 1 Nov; ask for 15 Oct → October's; write a version directly → refused | Lookup time |
| B4 | 1 | Resident exemption | Charge 0 to a car registered to a street address at that site | Resident car 10:00→12:00 → 0 | Pass/fail |
| B5 | 1 | Opening a ticket | From a valid entry code: check the site is open, one open ticket per car, space available; then insert the ticket, set the entry time from the server clock and write the audit entry, all in one transaction | Open → ticket with server time; open again for the same car → refused; open at a closed site → refused | Open latency (median, 95th percentile) |
| B6 | 1 | The last-space rule (F3) | Never open more tickets than spaces | 20 simultaneous opens on 5 free spaces → exactly 5 tickets, 15 clean refusals, free count 0; repeat 50 times | Runs; failures (0) |
| B7 | 1 | Repeat-safe opening | The same request id twice returns the same ticket | Send the same open twice → one ticket, identical answers | Pass/fail |
| B8 | 1 | Closing a ticket | From the exit code: freeze the exit time at the server clock, get the fee from the calculator, mark unpaid, write the audit entry, publish "ticket closed"; refuse another site's exit code | Close → exit time and fee; wrong site's code → refused | Close latency |
| B9 | 1 | Payment status on the ticket | Allow only unpaid → paid, unpaid → disputed, → waived; the ticket itself is only open or closed; no other status exists | Mark paid on an open ticket → refused; on a closed one → paid; search the code for "left unpaid" → none | Pass/fail |
| B10 | 1 | Assisted tickets | Let an assigned attendant open a ticket for a driver without a phone; flag it; count it per site per month | Attendant opens → ticket flagged; count for the month → 1; an attendant of another site → refused | Assisted tickets per site per month |
| B11 | 1 | The free-space count | Compute capacity minus open tickets from the tickets themselves, never from a stored counter | Open 3 of 5 → 2; close one → 3; no counter table exists | Count query time |
| B12 | 1 | Ticket status and history | Show a driver their tickets with status; show one ticket's state | List and detail match the database | Pass/fail |
| B13 | 1 | The receipt | Produce ticket id, site, times, hours, fee and the plate (through the identity area's logged join) | Read a receipt → all fields; one "plate read" audit entry | Pass/fail |
| B14 | 2 | Stale-ticket closing | Close tickets older than a site's maximum when the scheduler asks | 30-hour ticket at a 24-hour site → closed; 2-hour → untouched | Closed per run |
| B15 | 2 | Far-away scan flag | Accept a scan whose phone location is far from the site but flag it for the inspector's list | Scan with a location 2 km away → ticket opened and flagged | Flags per day in test |
| B16 | 2 | Frequent places | Give the assistant a driver's most visited sites | Seed 11 visits to site A and 2 to site B → A first | Query time |

---

## Area 4 — Money and governance (Teammate C)
Records: ADR-02, ADR-07, ADR-08, ADR-10, ADR-12. Covers payments, cash custody, requests and approvals, the money check
and the dashboard.

| # | Sprint | Build | It must | Test it by | Report |
|---|---|---|---|---|---|
| C1 | 1 | The payment-provider port and a fake provider | Define charge and status behind a port; the fake answers paid, declined, pending or times out, chosen by the amount's last digit | Amount 11 → paid; 12 → declined; 13 → pending; 19 → no answer for 8 seconds | Pass/fail per branch |
| C2 | 1 | Paying in the app | Charge through the port using the request id as the idempotency key; record the result; mark the ticket paid; publish "ticket paid" | Pay → paid with provider reference; ticket shows paid | Pay latency |
| C3 | 1 | One charge per request id | A repeated pay with the same id charges once | Two pays, one id → one payment row, the fake's charge called once | Pass/fail |
| C4 | 1 | Timeout behaviour | Give up after 8 seconds; leave the ticket unpaid; tell the driver "pay later or pay cash" | Amount 19 → retryable answer; ticket unchanged | Timeout honoured (seconds) |
| C5 | 1 | Pending behaviour | Record a pending payment; settle it later by polling the provider | Amount 13 → pending; switch the fake to paid; run the poll → ticket paid | Pending settled per run |
| C6 | 1 | Cash ticked by the attendant | Mark a ticket paid in cash, only by the attendant assigned to that site | Assigned attendant → paid (cash); another attendant → refused | Pass/fail |
| C7 | 1 | Corrections | Add a correction row with a reason; never update a payment row | Add −5 with a reason → two rows, sum reflects both; without a reason → refused | Pass/fail |
| C8 | 1 | Cash due per shift | Sum the cash ticks of one attendant in one shift | Three ticks → the sum | Pass/fail |
| C9 | 1 | Cash deposits with a system-issued receipt | Record a deposit (amount, shift, site); issue a numbered receipt the attendant can print or show; no photo | Record → receipt number and text; the receipt lists amount, shift, site, date | Deposits recorded |
| C10 | 2 | Deposit confirmation | Let the inspector of that zone confirm or reject (reason required) against the record; publish "deposit confirmed" | Zone's inspector confirms → confirmed; another zone → refused; reject without reason → refused; confirm a rejected one → refused | Confirmations; rejections |
| C11 | 1 | Requests | Let a member file a request (price change, licence suspension, licence revocation) with a mandatory reason; publish "request awaiting the Chair" | File with reason → pending; without → refused | Requests filed |
| C12 | 2 | Approval | Let the Chair approve: apply the change (new price version, or licence state) and the audit entry naming requester and approver in one transaction; or reject with a reason | Approve a price request → the new version is live; audit row names both; reject → rejected with reason | Approve latency; audit rows naming both (100 %) |
| C13 | 2 | No self-approval | Refuse approval of one's own request; refuse approval by a member | Chair approving the Chair's own → refused; member → refused | Pass/fail |
| C14 | 2 | The Chair acting directly | Let the Chair set a price or a licence state directly, through the same approval path, so the audit entry has the same shape | Direct set → one audit row with requester = approver = Chair | Pass/fail |
| C15 | 2 | Waivers | Let a member waive a ticket with a reason | Waive → waived; no reason → refused | Waivers |
| C16 | 2 | The money check | For a site and period, compute money due, paid in app, cash ticked, deposits confirmed, and the gap (cash ticked minus deposited), by reading other areas; store nothing | Seed 10 tickets, 4 cash ticks, 1 deposit → the five numbers add up; no new table | Query time for one month of one district |
| C17 | 2 | Dashboard scope | Show a member their district, the Chair all districts, nobody else anything | Three tokens → three results, two refusals | Pass/fail |
| C18 | 2 | A real payment provider behind the same port | Swap the fake for a real adapter by configuration only, after the free tier is verified on the vendor's page | All C1–C7 tests pass unchanged with the real adapter in test mode | Vendor page URL; tests passing |

---

## Area 5 — Apps, messages, complaints, then the assistant (Teammate D)
Records: ADR-04, ADR-05, ADR-07, ADR-09. Covers the Driver App, the Staff App (three modes and the web build),
notifications, photo evidence, complaints, inspections, ratings and disputes, and in week 4 the assistant service.

| # | Sprint | Build | It must | Test it by | Report |
|---|---|---|---|---|---|
| D1 | 1 | Driver App: sign-in and cars | Sign in by phone and code; save a car | Sign in on a phone; add a plate → it appears in the driver's cars | Taps to sign in |
| D2 | 1 | Driver App: the map | Show nearby sites with price and free-space band; refresh every 15 seconds | Change a ticket on the server → the band changes within 15 seconds | Refresh interval measured; data per refresh |
| D3 | 1 | Driver App: scanning | Open a ticket from the entry code and close it from the exit code; keep the request id until the answer arrives | Scan twice quickly → one ticket; airplane mode mid-scan, then retry → one ticket | Duplicate tickets in test (0) |
| D4 | 1 | Driver App: paying and the receipt | Pay in the app; show "pay later or pay cash" on a timeout; show the receipt with the plate | Amount 11 → paid screen; 19 → retry screen; receipt shows the plate | Taps from exit scan to receipt |
| D5 | 1 | Staff App: attendant mode | Clock in by scanning; list open tickets and cars waiting to pay cash; tick cash in one tap; open an assisted ticket in two taps | Tick a plate → paid on the server; assisted ticket → flagged on the server | Taps per action (1 and 2) |
| D6 | 1 | Offline behaviour | Show a clear refusal for any write without a connection; never save locally | Airplane mode, tap "cash paid" → message; server unchanged | Local writes in test (0) |
| D7 | 2 | Staff App: inspector mode | Show the priority list (flags), plate look-up (logged), the inspection form, deposit confirm or reject | Confirm a deposit from the phone → confirmed on the server; look up a plate → one "plate read" audit entry | Taps per action |
| D8 | 2 | Staff App: committee mode and the web build | Sites and capacity, requests, approve or reject (Chair), money check, dashboard, audit view; the same mode in a laptop browser | Approve a request from the laptop → the price version is live | Pages; load time on the laptop |
| D9 | 2 | Mode visibility | Show only the modes the token's role has; the server still refuses a crafted request to the wrong operation | Attendant token → attendant mode only; crafted committee call → refused by the server | Pass/fail |
| D10 | 2 | Notifications | React to ticket closed, ticket paid, request awaiting the Chair, deposit confirmed; send through a delivery port with a fake that records messages | Close a ticket → one message to the driver; file a request → one to the Chair | Messages per event (exactly 1) |
| D11 | 2 | Notifications never block | A failing delivery never fails the action; the delivery is retried by a job | Make the fake throw; close a ticket → success; run the job → message recorded | Retries; actions failed because of notifications (0) |
| D12 | 2 | Photo evidence | Attach photos to complaints, road blocks and inspections through a storage port with a local fake; save the report even when storage is down, with the photo pending | Upload → photo id; storage down → report saved, photo pending; job uploads later | Pending photos cleared per run |
| D13 | 2 | Complaints | Let anyone file about a person below them, and a driver about an attendant; route it to the person directly above the filer, or to the district's member for a driver's complaint; assign, decide with a reason, escalate to the Chair | Driver about attendant → the district member sees it; attendant about inspector → refused; decide without reason → refused | Complaints routed correctly / filed (100 %) |
| D14 | 2 | Inspections and road blocks | File an inspection report with photos; confirm or reject a road-block report | Report → saved with photo ids; confirm a block → site marked blocked until cleared | Reports filed |
| D15 | 2 | Ratings | One rating per closed ticket; an average per attendant | Rate twice → refused; average correct | Pass/fail |
| D16 | 2 | Disputes | Let a driver dispute a closed ticket; the member decides: waive, or back to unpaid | Dispute → disputed; decide waive → waived | Disputes decided |
| D17 | 2 | The assistant service | A separate service with its own database; take a driver's token and English text; answer with sites, prices, directions or ticket status by calling the main system as the app does; time out and say "assistant unavailable" when the language model fails | "find parking near the AUC gate" → sites list; stop the language model → unavailable within the timeout; the main system untouched | Answer latency; timeout honoured |
| D18 | 2 | Actions with a confirm tap | Prepare an action (open my ticket, pay) as a pending action; the Driver App shows it; nothing happens until the driver taps confirm | "open my ticket at site 12" → pending; confirm → ticket opened; no confirm → nothing | Actions executed without a tap (0) |
| D19 | 2 | Conversation history | Keep history only in the assistant's database under the pseudonym; delete on request; purge after 90 days | History survives a restart; delete → empty; the main database has no chat table | Rows purged per run |
| D20 | 2 | Isolation proof (with Zeyad) | The main-system suite passes with the assistant stopped | Run fitness function F9 | Pass/fail |

---

## First-week checklist (everyone)
- [ ] Read `adr/README.md` and your area's records.
- [ ] Create your module folders with their public interfaces; the boundary check is green.
- [ ] Write the tests for your first three tasks before the code.
- [ ] Use in-memory stand-ins until the foundation lands on day 3.
- [ ] First pull request by day 5, however small, with the numbers your tasks ask you to report.
