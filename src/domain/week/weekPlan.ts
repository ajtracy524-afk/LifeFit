import { addDays, weekDays } from '../dates';
import { ZERO_MACROS, dayTotals, plannedMealMacros, sumMacros } from '../nutrition';
import { applyStock, buildShoppingList, shoppingRange, type ShoppingListItem } from '../shopping';
import { hardExclusionsOf, substituteFood, swapContextOf } from '../catalogTags';
import { resolveWorkouts, type PlannedWorkout } from '../training';
import { excludedSlotsOn, planTargetOn, slotPlanOn } from './slotPlans';
import type { AppState, DayContext, ISODate, Macros, MealSlot, NutritionTarget, PlannedMeal, SlotPlan } from '../types';
import { dayTargetFor } from './dayTargets';
import { getFood } from '../../data/foods';
import { ingredientCostRange, priceLookup, purchaseCost, type CostItem, type CostRange } from '../costs';
import { getRecipe } from '../../data/recipes';
import { pantryEstimate } from './pantry';
import { syncPersonal } from '../personal';
import { applyRestock, applyStaples, restockRules } from './restock';

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

export interface ClosedMeal {
  date: ISODate;
  slot: MealSlot;
  /** Eaten out (typical week or "Auswärts"), skipped on purpose (E12), or removed in the plan. */
  reason: 'eating_out' | 'skip' | 'removed';
  /** Out meals: place / size as planned. */
  plan?: Extract<SlotPlan, { kind: 'out' }>;
  /** Out and removed meals: the budget kept for them. */
  reserved?: { kcal: number; protein: number };
  /** The dish that was planned before "Auswärts" – comes back with "Zuhause". */
  recipeId?: string;
}

/**
 * Meals of a day the plan leaves out on purpose (see excludedSlots) with the
 * reason – ONE answer for Heute, the week plan and the shopping list.
 */
export function closedMeals(state: AppState, date: ISODate): ClosedMeal[] {
  const context = dayContextFor(state, date);
  const slots = state.nutritionProfile?.slots;
  const target = dayTargetFor(state, date);
  const reserved = target ? planTargetOn(state, date, target).reserved : [];
  return excludedSlotsOn(state, date)
    .filter((slot) => !slots || slots.includes(slot))
    .map((slot): ClosedMeal => {
      const plan = slotPlanOn(state, date, slot);
      const removed = context.removedSlots?.includes(slot) && plan.kind !== 'out';
      const reason = removed ? 'removed' : plan.kind === 'out' ? 'eating_out' : plan.kind === 'skip' ? 'skip' : 'removed';
      const recipeId = state.plannedMeals.find((m) => m.date === date && m.slot === slot && m.skippedFor === 'eating_out')?.recipeId;
      const budget = reserved.find((r) => r.slot === slot);
      return {
        date,
        slot,
        reason,
        ...(recipeId ? { recipeId } : {}),
        ...(plan.kind === 'out' ? { plan } : {}),
        ...(budget ? { reserved: { kcal: budget.kcal, protein: budget.protein } } : {}),
      };
    });
}

export interface PlanDay {
  date: ISODate;
  context: DayContext;
  /** Session on this day (moved sessions appear on their new day, skipped ones not at all). */
  workout?: PlannedWorkout;
  isTrainingDay: boolean;
  target?: NutritionTarget;
  /** What the planned meals should reach: the target minus out / removed meals (Prompt 5). */
  planTarget?: Macros;
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
    for (const earlier of buildShoppingList(state.plannedMeals, today, addDays(from, -1), undefined, householdOf(state))) {
      if (available[earlier.foodId] !== undefined) available[earlier.foodId] = Math.max(0, available[earlier.foodId]! - earlier.grams);
    }
  }
  return available;
}

/** People who eat along – only the shopping amounts scale (Prompt 4). */
export function householdOf(state: Pick<AppState, 'plannerSettings'>): number {
  return Math.max(1, state.plannerSettings?.householdSize ?? 1);
}

/** Shopping list of a week: gross need from the plan minus free pantry and purchases. */
export function weekShopping(state: AppState, week: ISODate, today: ISODate, estimate = pantryEstimate(state)): ShoppingListItem[] {
  syncPersonal(state); // own products / dishes on the list like catalog foods (no-op when unchanged)
  const { from, to } = shoppingRange(week, today);
  const available = availablePantry(state, from, today, estimate);
  const purchased = state.shopping[week]?.purchased ?? {};
  // E20: with lactose intolerance the list buys the lactose-free variant (stock stays on the original).
  const swap = swapContextOf(hardExclusionsOf(state.nutritionProfile));
  const buyAs = (foodId: string) => substituteFood(foodId, swap);
  const items = applyStock(buildShoppingList(state.plannedMeals, from, to, buyAs, householdOf(state)), available, purchased);
  // F8: basics are topped up to their minimum stock – on the same list, one position per food.
  const restocked = applyRestock(items, restockRules(state, week, today), available, purchased);
  // E19: staples only when marked empty.
  return applyStaples(restocked, state.pantry, available, purchased).map((item) => {
    const food = getFood(item.buyFoodId ?? item.foodId);
    return item.state === 'open' && food ? { ...item, estCostChf: purchaseCost(food, item.remainingG) } : item;
  });
}

/** Estimated cost of what is still open on a week's list (plus how many items have no price). */
export function shoppingCost(items: ShoppingListItem[]): { totalChf: number; unpriced: number } {
  const open = items.filter((i) => i.state === 'open');
  return {
    totalChf: open.reduce((sum, i) => sum + (i.estCostChf ?? 0), 0),
    unpriced: open.filter((i) => i.estCostChf === undefined).length,
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
    const target = dayTargetFor(state, date);
    return {
      date,
      context: dayContextFor(state, date),
      workout,
      isTrainingDay: !!workout,
      target,
      ...(target && state.nutritionProfile ? { planTarget: planTargetOn(state, date, target).target } : {}),
      meals,
      planned: active.length ? sumMacros(active.map(plannedMealMacros)) : ZERO_MACROS,
      eaten: dayTotals(state.logEntries, date),
    };
  });

  return { weekStart: weekStartDate, days, workouts, shopping: weekShopping(state, weekStartDate, today, estimate), pantry: estimate };
}

/**
 * Rough food cost of a week – for the compact budget line on Heute and
 * Ernährung (one calculation for both). Counts what the week really eats:
 * planned and eaten meals (skipped ones not), plus food eaten outside the plan
 * (a replacement is therefore counted once, instead of the skipped meal).
 * Real product prices first, catalog estimates otherwise; undefined without
 * reliable prices (see ingredientCostRange).
 */
export function weekFoodCost(state: AppState, week: ISODate, opts: { eatenUntil?: ISODate; day?: ISODate } = {}): CostRange | undefined {
  const days = weekDays(week);
  // eatenUntil: only what was really eaten up to that day ("bisher") – same prices, same 80 % rule.
  const last = opts.eatenUntil && opts.eatenUntil < days[6]! ? opts.eatenUntil : days[6]!;
  // day: one day only (planned + eaten + extras of that day) – the "Heute" line of the budget.
  const inWeek = (d: ISODate) => (opts.day ? d === opts.day : d >= days[0]! && d <= last);
  const items: CostItem[] = state.plannedMeals
    .filter((m) => inWeek(m.date) && (opts.eatenUntil ? m.status === 'eaten' : m.status !== 'skipped'))
    .flatMap((m) => (getRecipe(m.recipeId)?.ingredients ?? []).map((i) => ({ foodId: i.foodId, grams: i.grams * m.servings })));
  for (const e of state.logEntries) {
    if (!inWeek(e.date) || e.plannedMealId) continue;
    // A real price counts even without a weight (manual "1 Portion" with price).
    if (e.costChf !== undefined) items.push({ grams: e.grams ?? 0, exactChf: e.costChf });
    // An own dish: its ingredients, priced like recipe ingredients (unlinked ones count as unpriced weight).
    else if (e.ingredients?.length) items.push(...e.ingredients.filter((i) => i.grams > 0));
    else if (!e.grams) continue;
    else if (e.foodId) items.push({ foodId: e.foodId, grams: e.grams });
    // A product without price and without catalog link: its weight counts as unpriced.
    else items.push({ foodId: '', grams: e.grams });
  }
  return ingredientCostRange(items, priceLookup(state.products));
}
