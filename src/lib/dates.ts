/**
 * Date handling. Task Together convention: date-only values are stored at noon UTC
 * (`YYYY-MM-DDT12:00:00Z`), which lands on the same calendar date in every inhabited
 * timezone. All "which day is it" math uses the user's stored IANA timezone.
 * Weeks start Monday.
 */

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a YYYY-MM-DD string to a Date at noon UTC. */
export function parseDateToNoonUTC(dateString: string): Date {
  if (!DATE_RE.test(dateString)) throw new Error(`Invalid date string: ${dateString}`);
  return new Date(`${dateString}T12:00:00Z`);
}

/** Format a stored noon-UTC Date back to YYYY-MM-DD. */
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The calendar date (YYYY-MM-DD) for an instant, in the given IANA timezone. */
export function dateStringInTz(instant: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(instant); // en-CA yields YYYY-MM-DD
}

/** Today's date string in the user's timezone. */
export function todayInTz(timezone: string, now: Date = new Date()): string {
  return dateStringInTz(now, timezone);
}

/** Add n days to a YYYY-MM-DD string. */
export function addDays(dateString: string, n: number): string {
  const d = parseDateToNoonUTC(dateString);
  d.setUTCDate(d.getUTCDate() + n);
  return toDateString(d);
}

/** ISO day of week for a date string: 1 = Monday … 7 = Sunday. */
export function isoDayOfWeek(dateString: string): number {
  const d = parseDateToNoonUTC(dateString).getUTCDay(); // 0 = Sun
  return d === 0 ? 7 : d;
}

/** Monday of the week containing dateString. */
export function weekStart(dateString: string): string {
  return addDays(dateString, 1 - isoDayOfWeek(dateString));
}

/** The 7 date strings (Mon..Sun) of the week containing dateString. */
export function weekDates(dateString: string): string[] {
  const start = weekStart(dateString);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Inclusive list of date strings from..to. Caps at `cap` entries (default 400). */
export function dateRange(from: string, to: string, cap = 400): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to && out.length < cap) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/** First and last date strings of the month containing dateString. */
export function monthBounds(dateString: string): { first: string; last: string } {
  const d = parseDateToNoonUTC(dateString);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12));
  return { first: toDateString(first), last: toDateString(last) };
}

/** Is the given IANA timezone valid? */
export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
