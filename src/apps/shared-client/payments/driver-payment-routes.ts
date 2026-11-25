/**
 * HTTP routes the Driver App uses for the payment step and the receipt, as the owners' operation files declare them.
 * Pay: Amina's `payments.payInApp`, POST /payments with the ticket id (her branch area-c/c2-pay-in-app; not on
 * main yet). Receipt: Karim's `ticketing.receipt`, GET /tickets/:ticketId/receipt on main (the transport fills the path from the query, ADR-22); it shows the plate, so it
 * is a logged read and the app sends a request id with it (P9).
 */
export const DRIVER_PAY_PATH = '/payments';
export const DRIVER_RECEIPT_PATH = '/tickets/:ticketId/receipt';

export const DRIVER_PAY_OPERATION = 'payments.payInApp';
export const DRIVER_RECEIPT_OPERATION = 'ticketing.receipt';
