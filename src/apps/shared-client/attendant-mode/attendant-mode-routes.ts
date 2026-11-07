/**
 * HTTP route the Staff App uses in attendant mode: Lino's `attendance.clockIn`, POST /attendance/clock-in with the
 * scanned site code only (his branch area-a/a13-attendance; not on main yet). The token says who the attendant is,
 * the signed code says where they stand.
 */
export const ATTENDANT_CLOCK_IN_PATH = '/attendance/clock-in';
export const ATTENDANT_CLOCK_IN_OPERATION = 'attendance.clockIn';
