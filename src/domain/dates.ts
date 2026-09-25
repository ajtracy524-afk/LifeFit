import type { ISODate } from './types';

/** All dates are local calendar days – never UTC – so "today" matches the user's clock. */

export function toISODate(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromISODate(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

export function today(): ISODate {
  return toISODate(new Date());
}

export function addDays(iso: ISODate, days: number): ISODate {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** 0 = Monday … 6 = Sunday */
export function weekdayIndex(iso: ISODate): number {
  return (fromISODate(iso).getDay() + 6) % 7;
}

export function weekStart(iso: ISODate): ISODate {
  return addDays(iso, -weekdayIndex(iso));
}

export function weekDays(start: ISODate): ISODate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((fromISODate(b).getTime() - fromISODate(a).getTime()) / 86_400_000);
}

/** ISO-8601 week number, used for "KW 39". */
export function isoWeekNumber(iso: ISODate): number {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
}
