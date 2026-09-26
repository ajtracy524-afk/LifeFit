import { fromISODate, today, addDays } from '../domain/dates';
import type { ISODate, MealSlot } from '../domain/types';

const num = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const num2 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

export const fmt = {
  int: (n: number) => num.format(Math.round(n)),
  dec: (n: number) => num1.format(n),
  kcal: (n: number) => `${num.format(Math.round(n))} kcal`,
  g: (n: number) => `${num.format(Math.round(n))} g`,
  kg: (n: number) => `${num1.format(n)} kg`,
  servings: (n: number) => (n === 1 ? '1 Portion' : `${num1.format(n)} Portionen`),
  /** Optional nutrients: salt below 1 g gets two decimals (0,03 g is not "0 g"), above that one is enough. */
  micro: (key: 'fiber' | 'sugar' | 'salt', n: number) => `${key === 'salt' && n < 1 ? num2.format(n) : num1.format(n)} g`,
};

export function formatGrams(g: number): string {
  if (g >= 1000) return `${num1.format(g / 1000)} kg`;
  return `${num.format(Math.round(g / 5) * 5 || Math.round(g))} g`;
}

const WEEKDAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const WEEKDAY_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

export const weekdayShort = (i: number) => WEEKDAY_SHORT[i] ?? '';
export const weekdayLong = (i: number) => WEEKDAY_LONG[i] ?? '';

export function formatDateLong(iso: ISODate): string {
  return fromISODate(iso).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function formatDateShort(iso: ISODate): string {
  return fromISODate(iso).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });
}

/** "Heute", "Morgen", "Gestern" or a short date. */
export function relativeDay(iso: ISODate): string {
  const t = today();
  if (iso === t) return 'Heute';
  if (iso === addDays(t, 1)) return 'Morgen';
  if (iso === addDays(t, -1)) return 'Gestern';
  return formatDateShort(iso);
}

export const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: 'Frühstück',
  snack: 'Snack',
  lunch: 'Mittagessen',
  dinner: 'Abendessen',
};

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 11) return 'Guten Morgen';
  if (h < 17) return 'Hallo';
  return 'Guten Abend';
}

export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  if (totalMin < 60) return `${totalMin} min`;
  return `${Math.floor(totalMin / 60)} h ${totalMin % 60} min`;
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rest = String(s % 60).padStart(2, '0');
  if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${rest}`;
  return `${m}:${rest}`;
}
