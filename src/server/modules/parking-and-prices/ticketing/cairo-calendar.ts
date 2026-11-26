/** The calendar every count "per month" follows: the committee's, in Cairo (P6 names Cairo time for the committee). */
export const CAIRO_TIME_ZONE = 'Africa/Cairo';

const cairoYearAndMonth = new Intl.DateTimeFormat('en-US', { timeZone: CAIRO_TIME_ZONE, year: 'numeric', month: 'numeric' });

export interface CalendarMonth {
  readonly year: number;
  readonly month: number;
}

/** The Cairo calendar month an instant falls in: an evening of 30 November in UTC is already December in Cairo. */
export function cairoCalendarMonth(instant: Date): CalendarMonth {
  const parts = cairoYearAndMonth.formatToParts(instant);
  const valueOf = (type: 'year' | 'month') => Number(parts.find((part) => part.type === type)?.value);
  return { year: valueOf('year'), month: valueOf('month') };
}
