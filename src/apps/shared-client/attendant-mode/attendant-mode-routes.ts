/**
 * HTTP routes the Staff App uses in attendant mode.
 *
 * Clock-in is Lino's `attendance.clockIn`, POST /attendance/clock-in with the scanned site code only (his branch
 * area-a/a13-attendance; not on main yet): the token says who the attendant is, the signed code says where they stand.
 *
 * The four paths below it are this app's proposals; no owner's operation file declares them yet (the pull request
 * lists them under "Needs Karim" and "Needs Amina").
 */
export const ATTENDANT_CLOCK_IN_PATH = '/attendance/clock-in';
export const ATTENDANT_CLOCK_IN_OPERATION = 'attendance.clockIn';

export const ATTENDANT_OPEN_TICKETS_PATH = '/staff/attendant/open-tickets';
export const ATTENDANT_CARS_WAITING_FOR_CASH_PATH = '/staff/attendant/cars-waiting-for-cash';
export const ATTENDANT_ASSISTED_TICKET_PATH = '/staff/attendant/assisted-ticket';
export const ATTENDANT_TICK_CASH_PATH = '/staff/attendant/tick-cash';
