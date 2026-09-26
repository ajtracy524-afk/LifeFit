import { addDays } from './dates';
import type { AppState, ISODate } from './types';

/**
 * Water tracking – deliberately tiny: one number per day (ml). A new day has
 * no entry, so it starts at 0 by itself. The goal is a personal tracking
 * value the user sets; LifeFit never states how much someone "must" drink.
 */

export const WATER_QUICK_ML = [250, 500, 750, 1000] as const;
/** Upper bound per day – protects against accidental taps, not a health statement. */
export const WATER_MAX_ML = 10_000;

export function waterOn(state: Pick<AppState, 'water'>, date: ISODate): number {
  return state.water?.[date] ?? 0;
}

/** Adds (or with negative ml removes) water on a draft; never below 0. */
export function addWater(draft: Pick<AppState, 'water'>, date: ISODate, ml: number): void {
  draft.water ??= {};
  const next = Math.min(WATER_MAX_ML, Math.max(0, waterOn(draft, date) + ml));
  if (next === 0) delete draft.water[date];
  else draft.water[date] = next;
}

/**
 * Optional starting value for the goal, offered to the user to adjust:
 * the widespread rule of thumb of about 35 ml per kg body weight, rounded to
 * 250 ml. Shown as "Startwert", never as a recommendation.
 */
export function waterStartValue(weightKg: number | undefined): number | undefined {
  if (!weightKg || weightKg <= 0) return undefined;
  return Math.round((weightKg * 35) / 250) * 250;
}

/** "1,5 L" – water is read in litres. */
export function formatLitres(ml: number): string {
  return `${(ml / 1000).toLocaleString('de-DE', { minimumFractionDigits: ml % 1000 === 0 ? 0 : 1, maximumFractionDigits: 2 })} L`;
}

/** Simple history: ml per given day. */
export function waterHistory(state: Pick<AppState, 'water'>, dates: ISODate[]): { date: ISODate; ml: number }[] {
  return dates.map((date) => ({ date, ml: waterOn(state, date) }));
}

/** A series is only worth mentioning from this many days on. */
export const WATER_STREAK_MIN_DAYS = 2;

/**
 * Days in a row on which at least `goalMl` was drunk – counted back from
 * yesterday, plus today once today reaches it (today is still running, so an
 * unfinished today never breaks the series). Read from the stored day values
 * only: a day without an entry is a day below the goal, nothing is assumed.
 * The threshold is the CURRENT goal and is shown with the number ("≥ 2 L"),
 * because earlier goals are not stored.
 */
export function waterStreak(state: Pick<AppState, 'water'>, today: ISODate, goalMl: number | undefined): number {
  if (!goalMl || goalMl <= 0) return 0;
  let days = waterOn(state, today) >= goalMl ? 1 : 0;
  // Bounded walk back – stops at the first day below the goal.
  for (let d = addDays(today, -1), i = 0; i < 366 && waterOn(state, d) >= goalMl; d = addDays(d, -1), i++) days++;
  return days;
}
