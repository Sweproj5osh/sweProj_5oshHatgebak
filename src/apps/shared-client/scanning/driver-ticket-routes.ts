/**
 * HTTP routes the Driver App uses for entry and exit scans: Karim's `ticketing.openTicket` (POST /tickets with
 * the site, the driver's car reference and the entry code) and `ticketing.closeTicket` (POST /tickets/:ticketId/closure
 * with the ticket id and the exit code; the transport fills the path from the body, ADR-22), both on main and both answering `{ ticket }`.
 */
export const DRIVER_OPEN_TICKET_PATH = '/tickets';
export const DRIVER_CLOSE_TICKET_PATH = '/tickets/:ticketId/closure';

export const DRIVER_OPEN_TICKET_OPERATION = 'ticketing.openTicket';
export const DRIVER_CLOSE_TICKET_OPERATION = 'ticketing.closeTicket';
