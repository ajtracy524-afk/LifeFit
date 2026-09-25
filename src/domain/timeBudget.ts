import type { TimeBudget } from './types';

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
