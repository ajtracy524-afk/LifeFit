import type { DayContext, DayMode, MealSlot, TimeBudget } from './types';

/**
 * F5 – time budget per day. One place defines what "wenig / normal / viel
 * Zeit" means for cooking AND training; planner, training schedule and
 * cascade all read from here.
 */
export interface TimeBudgetRule {
  label: string;
  /** Longest preparation per meal that fits the day. */
  maxPrepMin: number;
  /** Sessions longer than this are shortened (fitTemplateToTime). */
  trainingMin?: number;
}

export const TIME_BUDGETS: Record<TimeBudget, TimeBudgetRule> = {
  low: { label: 'Wenig Zeit', maxPrepMin: 15, trainingMin: 30 },
  // 35 min covers every recipe of the catalog – normal days plan exactly as before.
  normal: { label: 'Normal', maxPrepMin: 35 },
  high: { label: 'Viel Zeit', maxPrepMin: Number.POSITIVE_INFINITY },
};

export const TIME_BUDGET_ORDER: TimeBudget[] = ['low', 'normal', 'high'];

/** A meal-prep dish cooked on one of the previous days only needs reheating. */
export const LEFTOVER_PREP_MIN = 5;
export const LEFTOVER_DAYS = 2;
export const MEAL_PREP_TAG = 'Meal Prep';

export const DAY_MODE_ORDER: DayMode[] = ['normal', 'eating_out', 'busy', 'travel'];

export const DAY_MODE_LABEL: Record<DayMode, string> = {
  normal: 'Normal',
  eating_out: 'Auswärts',
  busy: 'Busy',
  travel: 'Reise',
};

/**
 * "Auswärts essen" = dinner is eaten out. The slot is not planned (an already
 * planned dinner is marked skipped) – no restaurant dishes are invented, the
 * day target stays, the user logs what they eat.
 */
export const EATING_OUT_SLOTS: MealSlot[] = ['dinner'];

/** Meal slots a day does not plan because of its mode. */
export function excludedSlots(context: DayContext | undefined): MealSlot[] {
  return context?.mode === 'eating_out' ? EATING_OUT_SLOTS : [];
}

/**
 * The budget that actually applies to a day: "Busy" and "Reise" mean little
 * time, whatever budget was set – one time model, no second set of rules.
 */
export function effectiveTimeBudget(context: DayContext | undefined): TimeBudget {
  if (!context) return 'normal';
  return context.mode === 'busy' || context.mode === 'travel' ? 'low' : context.timeBudget;
}
