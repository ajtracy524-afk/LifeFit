import { daysBetween, weekDays, weekStart } from '../dates';
import { excludedSlotsOn, planTargetOn, slotPlanOn } from './slotPlans';
import { plannerAffinity } from '../preferences';
import { postWorkoutSlot } from '../schedule';
import { rankMealOptions, seededRandom, slotShare, suggestWeek, type MealOption } from '../planner';
import { plannedMealMacros, sumMacros } from '../nutrition';
import type { AppState, ISODate, Macros, MealSlot, PlannedMeal } from '../types';
import { dayTargetFor } from './dayTargets';
import { availablePantry, dayContextFor } from './weekPlan';
import { effectiveTimeBudget, maxPrepFor } from '../timeBudget';
import { syncPersonal } from '../personal';

/**
 * Inputs every planning path shares: free pantry, personalization (learned +
 * explicit, pre-aggregated once), budget, priority, pantry age. One place, so
 * the week planner and the slot suggestions can never disagree.
 */
function plannerContext(state: AppState, dates: ISODate[], today: ISODate) {
  // Own dishes/products are candidates like catalog recipes (no-op when the state is unchanged).
  syncPersonal(state);
  const first = dates[0]!;
  return {
    // Meals of this week are part of the score (context), so only stock that
    // earlier weeks still need is reserved – never counted twice.
    pantry: availablePantry(state, maxDate(weekStart(first), today), today),
    affinity: plannerAffinity(state.learning?.preferences ?? {}, state.nutritionProfile),
    priority: state.plannerSettings?.priority ?? 'balanced',
    // The weekly budget, pro rata for the days being planned.
    budgetChf: state.plannerSettings?.weeklyBudgetChf !== undefined ? (state.plannerSettings.weeklyBudgetChf * dates.length) / 7 : undefined,
    pantryAgeDays: pantryAge(state, today),
    pantryExpiryDays: pantryExpiry(state, today),
    mealPrep: mealPrepEnabled(state),
  };
}

/** "Ich koche gern vor" (E18): new users no, existing users migrated to yes (domain/onboarding/migrate). */
export function mealPrepEnabled(state: Pick<AppState, 'onboarding'>): boolean {
  return state.onboarding?.food.mealPrep?.value === true;
}

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
  const notPlannable = (d: ISODate) => [...new Set([...excludedSlotsOn(state, d), ...handledSlots(state, d, today)])];
  return suggestWeek({
    dates,
    slots: opts.slots ?? profile.slots,
    target,
    targetFor: (d) => {
      const t = dayTargetFor(state, d);
      if (!t) return t;
      const kcal = opts.targetKcalFor?.(d);
      if (kcal !== undefined) return { ...t, kcal };
      // Out meals reserve their budget (and leave more protein to the meals at home),
      // removed / otherwise eaten ones keep their share, skipped ones hand it on (E12).
      return planTargetOn(state, d, t, handledSlots(state, d, today)).target;
    },
    profile,
    existing: opts.existing ?? weekMeals(state, first),
    ...plannerContext(state, dates, today),
    timeBudgetFor: (d) => effectiveTimeBudget(dayContextFor(state, d)),
    // Only with an answer: the user's cooking time is held (Prompt 4); without it the soft time cost as before.
    ...(state.plannerSettings?.cookingTime ? { maxPrepFor: (d: ISODate) => maxPrepFor(state.plannerSettings, dayContextFor(state, d), d) } : {}),
    excludedSlotsFor: notPlannable,
    portableFor: (d, slot) => slotPlanOn(state, d, slot).kind === 'togo',
    postWorkoutSlotFor: (d) => postWorkoutSlot(state, d),
    random: seededRandom(opts.seed),
  });
}

/**
 * Slots the user already handled on a day that has begun: "Anders gegessen"
 * left the planned meal as skipped. Re-planning must not put a meal there
 * again – the user ate something else. (Food merely logged in a slot does not
 * block it: it may be an extra next to a planned meal that is still due.)
 */
function handledSlots(state: AppState, date: ISODate, today: ISODate): MealSlot[] {
  if (date > today) return [];
  return [...new Set(state.plannedMeals.filter((m) => m.date === date && m.status === 'skipped').map((m) => m.slot))];
}

export interface SlotSuggestions {
  options: MealOption[];
  /** What is still open for the day after everything eaten and planned elsewhere. */
  open: Macros;
}

/**
 * "Passend zu deinem Plan": options for one meal slot, ranked by the planner's
 * week score. Knows the day target, what was already eaten (also outside the
 * plan), the other meals of the day, pantry, budget, time budget, training
 * and learned + explicit preferences. `exclude` = recipes not to offer (e.g.
 * the meal already planned there).
 */
export function slotSuggestions(state: AppState, date: ISODate, slot: MealSlot, today: ISODate, limit = 3, exclude: string[] = []): SlotSuggestions {
  const target = dayTargetFor(state, date);
  const profile = state.nutritionProfile;
  const empty = { options: [], open: { kcal: 0, protein: 0, carbs: 0, fat: 0 } };
  if (!target || !profile) return empty;

  const week = weekMeals(state, date);
  const fixed = week.filter((m) => m.date === date && m.slot !== slot);
  // Eaten outside the plan (searched, scanned, manual) – the plan's meals are already in `fixed`.
  const extra = sumMacros(state.logEntries.filter((e) => e.date === date && !e.plannedMealId).map((e) => e.macros));
  const fixedKcal = sumMacros(fixed.map(plannedMealMacros)).kcal;
  const dayTarget = { ...target, kcal: Math.max(0, target.kcal - extra.kcal), protein: Math.max(1, target.protein - extra.protein) };
  const slotKcal = target.kcal * slotShare([slot], profile.slots.includes(slot) ? profile.slots : [...profile.slots, slot]);
  // Fill what is left of the day, within sensible bounds of a normal portion for this slot.
  const kcal = Math.min(slotKcal * 1.5, Math.max(slotKcal * 0.5, dayTarget.kcal - fixedKcal));

  const options = rankForSlot(state, { date, slot, today, fixed, kcal, target: dayTarget, week, exclude, limit });
  const openKcal = Math.max(0, dayTarget.kcal - fixedKcal);
  const openProtein = Math.max(0, target.protein - extra.protein - fixed.reduce((s, m) => s + plannedMealMacros(m).protein, 0));
  return { options, open: { kcal: openKcal, protein: openProtein, carbs: 0, fat: 0 } };
}

/**
 * Alternatives for ONE planned meal, filling exactly its calories – ranked by
 * the planner's week score under the day's current time budget. The rest of
 * the day and week is fixed context. With `includeCurrent` the meal's own
 * recipe is ranked too (to compare old vs. new with the same measure).
 */
export function mealAlternatives(state: AppState, meal: PlannedMeal, today: ISODate, opts: { limit?: number; includeCurrent?: boolean } = {}): MealOption[] {
  const target = dayTargetFor(state, meal.date);
  if (!target || !state.nutritionProfile) return [];
  const week = weekMeals(state, meal.date).filter((m) => m.id !== meal.id);
  const fixed = week.filter((m) => m.date === meal.date);
  // Like the week planner: a recipe already on this day is not offered a second time.
  const taken = fixed.map((m) => m.recipeId).filter((id) => id !== meal.recipeId);
  const kcal = plannedMealMacros(meal).kcal;
  return rankForSlot(state, {
    date: meal.date,
    slot: meal.slot,
    today,
    fixed,
    kcal,
    target,
    week,
    exclude: opts.includeCurrent ? taken : [...taken, meal.recipeId],
    limit: opts.limit ?? 3,
  });
}

/** The shared core: planner context once, then the planner's own ranking. */
function rankForSlot(
  state: AppState,
  p: { date: ISODate; slot: MealSlot; today: ISODate; fixed: PlannedMeal[]; kcal: number; target: Macros; week: PlannedMeal[]; exclude: string[]; limit: number },
): MealOption[] {
  const ctx = plannerContext(state, [p.date], p.today);
  return rankMealOptions(
    {
      date: p.date,
      slot: p.slot,
      target: p.target,
      fixed: p.fixed,
      kcal: p.kcal,
      timeBudget: effectiveTimeBudget(dayContextFor(state, p.date)),
      postWorkoutSlot: postWorkoutSlot(state, p.date),
      profile: state.nutritionProfile,
      context: p.week.filter((m) => m.date !== p.date),
      pantry: ctx.pantry,
      extras: { affinity: ctx.affinity, budgetChf: ctx.budgetChf, pantryAgeDays: ctx.pantryAgeDays, pantryExpiryDays: ctx.pantryExpiryDays, mealPrep: ctx.mealPrep },
      priority: ctx.priority,
      exclude: p.exclude,
      portableOnly: slotPlanOn(state, p.date, p.slot).kind === 'togo',
    },
    p.limit,
  );
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
/** Days until the best-before date of each pantry item that has one (Prompt 6). */
function pantryExpiry(state: AppState, today: ISODate): Record<string, number> {
  return Object.fromEntries(Object.values(state.pantry).flatMap((p) => (p.bestBefore ? [[p.foodId, daysBetween(today, p.bestBefore)]] : [])));
}

function pantryAge(state: AppState, today: ISODate): Record<string, number> {
  return Object.fromEntries(Object.values(state.pantry).map((p) => [p.foodId, Math.max(0, daysBetween(p.updatedAt.slice(0, 10), today))]));
}
