/**
 * HTTP routes the Driver App uses for entry and exit scans: Karim's `ticketing.openTicket` (POST /tickets/open with
 * the site, the driver's car reference and the entry code) and `ticketing.closeTicket` (POST /tickets/close with the
 * ticket id and the exit code), both on main and both answering `{ ticket }`.
 */
export const DRIVER_OPEN_TICKET_PATH = '/tickets/open';
export const DRIVER_CLOSE_TICKET_PATH = '/tickets/close';

export const DRIVER_OPEN_TICKET_OPERATION = 'ticketing.openTicket';
export const DRIVER_CLOSE_TICKET_OPERATION = 'ticketing.closeTicket';
