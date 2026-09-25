import { addDays, weekStart } from '../dates';
import { ZERO_MACROS, dayTotals, plannedMealMacros, sumMacros } from '../nutrition';
import { SLOT_ORDER } from '../planner';
import { currentWeight, weeklyRate } from '../progress';
import { activeWorkouts, isCompletedOn, type PlannedWorkout } from '../training';
import { TIME_BUDGETS } from '../timeBudget';
import { dayContextFor, dayTargetFor, pantryEstimate } from '../week';
import type { AppState, ISODate, Macros, MealSlot, NutritionTarget, PlannedMeal } from '../types';
import { computeSafety } from './guardrails';
import type { EngineOptions, SafetyStatus } from './types';

/**
 * Normalised facts for one day. Rules read ONLY from this object, which keeps
 * them pure and makes every rule testable with a hand-built state.
 */
export interface EngineContext {
  state: AppState;
  date: ISODate;
  hour: number;
  weekStart: ISODate;
  target?: NutritionTarget;
  /** Logged today (planned meals marked eaten + free entries). */
  eaten: Macros;
  /** Today's meals that are still planned. */
  plannedOpen: PlannedMeal[];
  plannedOpenMacros: Macros;
  slots: MealSlot[];
  /** Slots without a meal or log entry whose time is not over yet. */
  freeSlots: MealSlot[];
  /** Food ids available at home. */
  pantry: Set<string>;
  weightKg?: number;
  weeklyRateKg?: number;
  /** Today's planned session (after overrides) if it is not completed yet. */
  todaysSession?: PlannedWorkout;
  trainedToday: boolean;
  availableMinutes?: number;
  safety: SafetyStatus;
}

/** Latest hour at which a slot still makes sense. */
const SLOT_UNTIL: Record<MealSlot, number> = { breakfast: 11, lunch: 15, snack: 22, dinner: 23 };

export function buildContext(state: AppState, options: EngineOptions): EngineContext {
  const { date } = options;
  const hour = options.hour ?? 12;
  const ws = weekStart(date);
  // Day-specific target: training days get more, rest days less (weekly sum unchanged).
  const target = dayTargetFor(state, date);
  const slots = state.nutritionProfile?.slots ?? SLOT_ORDER;

  const eaten = dayTotals(state.logEntries, date);
  const plannedOpen = state.plannedMeals.filter((m) => m.date === date && m.status === 'planned');
  const usedSlots = new Set<MealSlot>([
    ...state.plannedMeals.filter((m) => m.date === date && m.status !== 'skipped').map((m) => m.slot),
    ...state.logEntries.filter((e) => e.date === date).map((e) => e.slot),
  ]);
  const freeSlots = slots.filter((s) => !usedSlots.has(s) && hour < SLOT_UNTIL[s]);

  const stock = pantryEstimate(state);
  const pantry = new Set<string>([...Object.keys(stock).filter((id) => stock[id]! > 0), ...(options.pantry ?? [])]);

  // Only data up to the evaluated day – keeps results reproducible.
  const weights = state.weights.filter((w) => w.date <= date);
  const weightKg = currentWeight(weights) ?? state.goal?.startWeightKg;
  const weeklyRateKg = weeklyRate(weights);

  const session = activeWorkouts(state.training, state.workoutOverrides, state.workouts, ws, state.dayContexts).find((s) => s.date === date && !s.completedWorkoutId);
  const trainedToday = !!isCompletedOn(state.workouts, date);

  // Time for training comes from the day's time budget (F5) – one time model for the whole app.
  const availableMinutes = options.availableMinutes ?? TIME_BUDGETS[dayContextFor(state, date).timeBudget].trainingMin;

  const recentDays = Array.from({ length: 7 }, (_, i) => addDays(date, -(i + 1)));
  const recentTotals = recentDays.map((d) => dayTotals(state.logEntries, d)).filter((m) => m.kcal > 0);
  const recentIntake = target
    ? {
        loggedDays: recentTotals.length,
        avgKcal: recentTotals.length ? recentTotals.reduce((s, m) => s + m.kcal, 0) / recentTotals.length : 0,
        targetKcal: target.kcal,
      }
    : undefined;

  return {
    state,
    date,
    hour,
    weekStart: ws,
    target,
    eaten,
    plannedOpen,
    plannedOpenMacros: plannedOpen.length ? sumMacros(plannedOpen.map(plannedMealMacros)) : ZERO_MACROS,
    slots,
    freeSlots,
    pantry,
    weightKg,
    weeklyRateKg,
    todaysSession: session && !trainedToday ? session : undefined,
    trainedToday,
    availableMinutes,
    safety: computeSafety({ profile: state.profile, goal: state.goal, weightKg, weeklyRateKg, recentIntake }),
  };
}
