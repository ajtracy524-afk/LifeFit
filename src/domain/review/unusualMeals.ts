import { SLOT_LABEL, fmt } from '../../lib/format';
import { addDays } from '../dates';
import { dayTotals } from '../nutrition';
import type { AppState, ISODate, LogEntry, MealSlot } from '../types';

/**
 * "Außergewöhnliche Mahlzeit" – compared with the user's OWN usual amounts,
 * never a fixed calorie line and never the word "Cheat Meal". Without enough
 * history nothing is said.
 *
 *   meal: ≥ 1.8 × the median of the same meal slot over the last 30 days
 *         (at least 8 entries there) and at least 400 kcal more
 *   day:  ≥ 1.35 × the median day of the last 30 days (≥ 10 logged days)
 *         and ≥ 25 % over the day's target
 */
export const UNUSUAL_RULES = {
  lookbackDays: 30,
  minSlotEntries: 8,
  mealFactor: 1.8,
  mealMinExtraKcal: 400,
  minDays: 10,
  dayFactor: 1.35,
  dayOverTarget: 1.25,
} as const;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export interface UnusualMeal {
  entry: LogEntry;
  usualKcal: number;
  text: string;
}

/** Entries of `date` that are clearly above what the user usually eats in that slot. */
export function unusualMeals(state: AppState, date: ISODate): UnusualMeal[] {
  const R = UNUSUAL_RULES;
  const from = addDays(date, -R.lookbackDays);
  const before = state.logEntries.filter((e) => e.date >= from && e.date < date);
  // A slot's "meal" is everything logged in that slot on a day (several items = one meal).
  const slotDayKcal = (slot: MealSlot) => {
    const byDay = new Map<ISODate, number>();
    for (const e of before) if (e.slot === slot) byDay.set(e.date, (byDay.get(e.date) ?? 0) + e.macros.kcal);
    return [...byDay.values()];
  };
  const out: UnusualMeal[] = [];
  const today = state.logEntries.filter((e) => e.date === date);
  for (const slot of [...new Set(today.map((e) => e.slot))]) {
    const usual = slotDayKcal(slot);
    if (usual.length < R.minSlotEntries) continue;
    const med = median(usual);
    const entries = today.filter((e) => e.slot === slot);
    const kcal = entries.reduce((s, e) => s + e.macros.kcal, 0);
    if (kcal >= med * R.mealFactor && kcal - med >= R.mealMinExtraKcal) {
      const main = [...entries].sort((a, b) => b.macros.kcal - a.macros.kcal)[0]!;
      out.push({
        entry: main,
        usualKcal: Math.round(med),
        text: `${SLOT_LABEL[slot]} (${fmt.kcal(kcal)}) lag deutlich über deiner üblichen Menge (sonst etwa ${fmt.kcal(med)}).`,
      });
    }
  }
  return out;
}

/** The whole day clearly above the user's usual day – or undefined (also with too little history). */
export function unusualDay(state: AppState, date: ISODate, targetKcal: number | undefined): { kcal: number; usualKcal: number } | undefined {
  const R = UNUSUAL_RULES;
  const days = Array.from({ length: R.lookbackDays }, (_, i) => dayTotals(state.logEntries, addDays(date, -1 - i)).kcal).filter((k) => k > 0);
  if (days.length < R.minDays || !targetKcal) return undefined;
  const kcal = dayTotals(state.logEntries, date).kcal;
  const usual = median(days);
  return kcal >= usual * R.dayFactor && kcal >= targetKcal * R.dayOverTarget ? { kcal: Math.round(kcal), usualKcal: Math.round(usual) } : undefined;
}
