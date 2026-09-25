import { weekDays, weekStart } from '../dates';
import { seededRandom, suggestWeek } from '../planner';
import type { AppState, ISODate, PlannedMeal } from '../types';
import { dayTargetFor } from './dayTargets';
import { availablePantry, dayContextFor } from './weekPlan';
import { effectiveTimeBudget } from '../timeBudget';

/**
 * The ONE entry into the week planner. Onboarding, "Woche vorschlagen",
 * the weekly check-in and the cascade all plan through here, so every path
 * uses the same rules: day targets, free pantry, time budgets, seed.
 */
export function planMeals(
  state: AppState,
  opts: { dates: ISODate[]; today: ISODate; seed: string; slots?: PlannedMeal['slot'][]; existing?: PlannedMeal[]; targetKcalFor?: (date: ISODate) => number | undefined },
): PlannedMeal[] {
  const { dates, today } = opts;
  const first = dates[0];
  const profile = state.nutritionProfile;
  const target = first ? dayTargetFor(state, first) : undefined;
  if (!first || !profile || !target) return [];
  return suggestWeek({
    dates,
    slots: opts.slots ?? profile.slots,
    target,
    targetFor: (d) => {
      const t = dayTargetFor(state, d);
      const kcal = opts.targetKcalFor?.(d);
      return t && kcal !== undefined ? { ...t, kcal } : t;
    },
    profile,
    existing: opts.existing ?? weekMeals(state, first),
    // Meals of this week are part of the score (context), so only stock that
    // earlier weeks still need is reserved – never counted twice.
    pantry: availablePantry(state, maxDate(weekStart(first), today), today),
    timeBudgetFor: (d) => effectiveTimeBudget(dayContextFor(state, d)),
    random: seededRandom(opts.seed),
  });
}

/** Non-skipped meals of the week containing `date` – context for foods, variety and leftovers. */
export function weekMeals(state: AppState, date: ISODate): PlannedMeal[] {
  const days = weekDays(weekStart(date));
  return state.plannedMeals.filter((m) => m.date >= days[0]! && m.date <= days[6]! && m.status !== 'skipped');
}

/** Days of `week` that can still be planned (from today on). */
export function plannableDays(week: ISODate, today: ISODate): ISODate[] {
  return weekDays(week).filter((d) => d >= today);
}

/** Fills every empty slot of the week from today on. Mutates the draft, returns the new meals. */
export function fillWeek(draft: AppState, week: ISODate, today: ISODate): PlannedMeal[] {
  const dates = plannableDays(week, today);
  const added = planMeals(draft, { dates, today, seed: week });
  draft.plannedMeals.push(...added);
  return added;
}

const maxDate = (a: ISODate, b: ISODate) => (a > b ? a : b);
