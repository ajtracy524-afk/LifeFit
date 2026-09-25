import type { ISODate, Macros, MealSlot, WorkoutTemplate } from '../types';

/**
 * Adaptive Fitness Engine – output contract.
 *
 * Every recommendation is produced by a deterministic rule, carries the raw
 * facts it was derived from (so the UI – or an LLM – can explain it) and only
 * PROPOSES actions. Nothing is applied without a tap by the user.
 */

export type EngineDomain = 'nutrition' | 'training' | 'shopping' | 'body' | 'safety';

export type RecommendationKind =
  | 'nutrition_gap'
  | 'nutrition_over'
  | 'protein_pattern'
  | 'leftovers'
  | 'training_recovery'
  | 'training_frequency'
  | 'training_undertrained'
  | 'training_missed'
  | 'training_time'
  | 'training_stall'
  | 'training_program'
  | 'shopping_missing'
  | 'body_rate'
  | 'safety';

export type Priority = 'high' | 'medium' | 'low';

/** How sure the rule is – low when it is based on little data. */
export type Confidence = 'high' | 'medium' | 'low';

export type EngineAction =
  | { type: 'add_meal'; label: string; date: ISODate; slot: MealSlot; recipeId: string; servings: number }
  | { type: 'log_food'; label: string; date: ISODate; slot: MealSlot; foodId: string; grams: number }
  | { type: 'swap_meal'; label: string; mealId: string; recipeId: string; servings: number }
  | { type: 'start_workout'; label: string; template: WorkoutTemplate }
  | { type: 'set_targets'; label: string; macros: Macros }
  | { type: 'open'; label: string; route: 'shopping' | 'training' | 'nutrition' | 'progress' };

export interface Recommendation {
  /** Stable per day and subject – used for dismissals. */
  id: string;
  kind: RecommendationKind;
  domain: EngineDomain;
  priority: Priority;
  confidence: Confidence;
  title: string;
  message: string;
  /** Short, factual bullet points ("Mittwoch: Beine, 14 Sätze"). */
  reasons: string[];
  /** Raw numbers behind the recommendation (UI, tests, LLM explanations). */
  facts: Record<string, number | string | boolean>;
  actions: EngineAction[];
  /** True if following it would lower the calorie intake – blocked in safe mode. */
  increasesDeficit?: boolean;
}

export interface EngineOptions {
  date: ISODate;
  /** Local hour 0–23 – influences meal sizes and slots. Default 12. */
  hour?: number;
  /** Training time available today (overrides the stored value). */
  availableMinutes?: number;
  /** Extra food ids the user has at home (on top of "have"/"checked" in the shopping list). */
  pantry?: string[];
  /** Maximum number of recommendations. Default 5. */
  limit?: number;
  /**
   * Only recommendations of these domains – each screen shows what belongs to
   * it (training hints in Training, plan changes in Ernährung, safety on Heute).
   */
  domains?: EngineDomain[];
}

export type SafetyFlag = 'minor' | 'underweight_deficit' | 'rapid_loss' | 'very_low_intake';

export interface SafetyStatus {
  /** In safe mode the engine never suggests eating less or a larger deficit. */
  restricted: boolean;
  flags: SafetyFlag[];
}
