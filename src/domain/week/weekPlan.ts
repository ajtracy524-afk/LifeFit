import { addDays, weekDays } from '../dates';
import { ZERO_MACROS, dayTotals, plannedMealMacros, sumMacros } from '../nutrition';
import { applyStock, buildShoppingList, shoppingRange, type ShoppingListItem } from '../shopping';
import { resolveWorkouts, type PlannedWorkout } from '../training';
import type { AppState, DayContext, ISODate, Macros, NutritionTarget, PlannedMeal } from '../types';
import { dayTargetFor } from './dayTargets';
import { getFood } from '../../data/foods';
import { purchaseCost } from '../costs';
import { pantryEstimate } from './pantry';
import { applyRestock, restockRules } from './restock';

/**
 * WeekPlan is a DERIVED view – never stored. Sources of truth are
 * plannedMeals, training + workoutOverrides, dayContexts, pantry, logEntries
 * and shopping purchases. Every screen reads the week from here, so nutrition,
 * training and shopping can never disagree.
 */

export const DEFAULT_DAY_CONTEXT: DayContext = { timeBudget: 'normal', mode: 'normal' };

export function dayContextFor(state: Pick<AppState, 'dayContexts'>, date: ISODate): DayContext {
  return state.dayContexts[date] ?? DEFAULT_DAY_CONTEXT;
}

export interface PlanDay {
  date: ISODate;
  context: DayContext;
  /** Session on this day (moved sessions appear on their new day, skipped ones not at all). */
  workout?: PlannedWorkout;
  isTrainingDay: boolean;
  target?: NutritionTarget;
  meals: PlannedMeal[];
  /** Planned + eaten meals of the day (skipped ones excluded). */
  planned: Macros;
  eaten: Macros;
}

export interface WeekPlan {
  weekStart: ISODate;
  days: PlanDay[];
  /** All sessions incl. skipped ones – the original plan stays visible. */
  workouts: PlannedWorkout[];
  shopping: ShoppingListItem[];
  pantry: Record<string, number>;
}

/**
 * Pantry that is still free on `from`: the estimate minus what planned meals
 * from today until the day before will use. Shopping and planner both use
 * this, so a later week never counts stock the current week still needs.
 */
export function availablePantry(state: AppState, from: ISODate, today: ISODate, estimate = pantryEstimate(state)): Record<string, number> {
  const available = { ...estimate };
  if (from > today) {
    for (const earlier of buildShoppingList(state.plannedMeals, today, addDays(from, -1))) {
      if (available[earlier.foodId] !== undefined) available[earlier.foodId] = Math.max(0, available[earlier.foodId]! - earlier.grams);
    }
  }
  return available;
}

/** Shopping list of a week: gross need from the plan minus free pantry and purchases. */
export function weekShopping(state: AppState, week: ISODate, today: ISODate, estimate = pantryEstimate(state)): ShoppingListItem[] {
  const { from, to } = shoppingRange(week, today);
  const available = availablePantry(state, from, today, estimate);
  const purchased = state.shopping[week]?.purchased ?? {};
  const items = applyStock(buildShoppingList(state.plannedMeals, from, to), available, purchased);
  // F8: basics are topped up to their minimum stock – on the same list, one position per food.
  return applyRestock(items, restockRules(state, week, today), available, purchased).map((item) => {
    const food = getFood(item.foodId);
    return item.state === 'open' && food ? { ...item, estCostEur: purchaseCost(food, item.remainingG) } : item;
  });
}

/** Estimated cost of what is still open on a week's list (plus how many items have no price). */
export function shoppingCost(items: ShoppingListItem[]): { totalEur: number; unpriced: number } {
  const open = items.filter((i) => i.state === 'open');
  return {
    totalEur: open.reduce((sum, i) => sum + (i.estCostEur ?? 0), 0),
    unpriced: open.filter((i) => i.estCostEur === undefined).length,
  };
}

/** Open generated + open manual items – the number on the Einkauf tab. */
export function openShoppingCount(state: AppState, week: ISODate, today: ISODate): number {
  const open = weekShopping(state, week, today).filter((i) => i.state === 'open').length;
  const manual = state.shopping[week]?.manual.filter((m) => !m.checked).length ?? 0;
  return open + manual;
}

export function buildWeekPlan(state: AppState, weekStartDate: ISODate, today: ISODate): WeekPlan {
  const workouts = resolveWorkouts(state.training, state.workoutOverrides, state.workouts, weekStartDate, state.dayContexts);
  const estimate = pantryEstimate(state);

  const days = weekDays(weekStartDate).map((date): PlanDay => {
    const meals = state.plannedMeals.filter((m) => m.date === date);
    const active = meals.filter((m) => m.status !== 'skipped');
    const workout = workouts.find((w) => w.date === date && w.status !== 'skipped');
    return {
      date,
      context: dayContextFor(state, date),
      workout,
      isTrainingDay: !!workout,
      target: dayTargetFor(state, date),
      meals,
      planned: active.length ? sumMacros(active.map(plannedMealMacros)) : ZERO_MACROS,
      eaten: dayTotals(state.logEntries, date),
    };
  });

  return { weekStart: weekStartDate, days, workouts, shopping: weekShopping(state, weekStartDate, today, estimate), pantry: estimate };
}
