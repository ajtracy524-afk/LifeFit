import { daysBetween, weekDays, weekStart } from '../dates';
import { affinityIndex } from '../learning';
import { postWorkoutSlot } from '../schedule';
import { seededRandom, slotShare, suggestWeek } from '../planner';
import type { AppState, ISODate, PlannedMeal } from '../types';
import { dayTargetFor } from './dayTargets';
import { availablePantry, dayContextFor } from './weekPlan';
import { effectiveTimeBudget, excludedSlots } from '../timeBudget';

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
      if (!t) return t;
      const kcal = opts.targetKcalFor?.(d);
      if (kcal !== undefined) return { ...t, kcal };
      // Slots eaten out keep their share of the day for the restaurant meal –
      // the planned meals do not grow to make up for it.
      const out = excludedSlots(dayContextFor(state, d)).filter((sl) => profile.slots.includes(sl));
      if (out.length === 0) return t;
      const share = 1 - slotShare(out, profile.slots);
      return { ...t, kcal: t.kcal * share, protein: t.protein * share };
    },
    profile,
    existing: opts.existing ?? weekMeals(state, first),
    // Meals of this week are part of the score (context), so only stock that
    // earlier weeks still need is reserved – never counted twice.
    pantry: availablePantry(state, maxDate(weekStart(first), today), today),
    timeBudgetFor: (d) => effectiveTimeBudget(dayContextFor(state, d)),
    excludedSlotsFor: (d) => excludedSlots(dayContextFor(state, d)),
    // Personalization layer, pre-aggregated once for the whole run.
    affinity: affinityIndex(state.learning?.preferences ?? {}),
    priority: state.plannerSettings?.priority ?? 'balanced',
    // The weekly budget, pro rata for the days being planned.
    budgetEur: state.plannerSettings?.weeklyBudgetEur !== undefined ? (state.plannerSettings.weeklyBudgetEur * dates.length) / 7 : undefined,
    postWorkoutSlotFor: (d) => postWorkoutSlot(state, d),
    pantryAgeDays: pantryAge(state, today),
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

/** Days since each pantry amount was last set (its only known "age"). */
function pantryAge(state: AppState, today: ISODate): Record<string, number> {
  return Object.fromEntries(Object.values(state.pantry).map((p) => [p.foodId, Math.max(0, daysBetween(p.updatedAt.slice(0, 10), today))]));
}
