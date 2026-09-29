import type { CostRange } from '../costs';
import type { Experience, ISODate, Macros, MealSlot, WorkoutTemplate } from '../types';

/**
 * Adaptive Fitness Engine – output contract.
 *
 * Every recommendation is produced by a deterministic rule, carries the raw
 * facts it was derived from (so the UI – or an LLM – can explain it) and only
 * PROPOSES actions. Nothing is applied without a tap by the user.
 */

export type EngineDomain = 'nutrition' | 'training' | 'shopping' | 'body' | 'safety' | 'tips';

export type RecommendationKind =
  | 'nutrition_gap'
  | 'nutrition_over'
  | 'own_dish'
  | 'protein_pattern'
  | 'leftovers'
  | 'training_recovery'
  | 'training_frequency'
  | 'training_undertrained'
  | 'training_missed'
  | 'training_time'
  | 'training_stall'
  | 'training_program'
  | 'training_level'
  | 'training_cardio'
  | 'pre_workout'
  | 'heavy_meal'
  | 'tip_habit'
  | 'tip_progress'
  | 'shopping_missing'
  | 'body_rate'
  | 'safety';

export type Priority = 'high' | 'medium' | 'low';

/** How sure the rule is – low when it is based on little data. */
export type Confidence = 'high' | 'medium' | 'low';

export type EngineAction =
  | { type: 'add_meal'; label: string; date: ISODate; slot: MealSlot; recipeId: string; servings: number; details?: MealSuggestionDetails }
  | { type: 'log_food'; label: string; date: ISODate; slot: MealSlot; foodId: string; grams: number }
  | { type: 'log_dish'; label: string; date: ISODate; slot: MealSlot; dishId: string; portions: number; details?: MealSuggestionDetails }
  | { type: 'swap_meal'; label: string; mealId: string; recipeId: string; servings: number }
  | { type: 'start_workout'; label: string; template: WorkoutTemplate }
  | { type: 'set_targets'; label: string; macros: Macros }
  /** Next level of the plan (adaptive level) – program, days and optionally the experience in the profile. */
  | { type: 'set_program'; label: string; programId: string; weekdays: number[]; experience?: Experience }
  | { type: 'open'; label: string; route: 'shopping' | 'training' | 'nutrition' | 'progress' };

/** What the UI shows for a suggested meal – facts only, cost only with enough price data. */
export interface MealSuggestionDetails {
  title: string;
  /** Unknown for own dishes (no preparation time stored). */
  prepMin?: number;
  kcal: number;
  protein: number;
  cost?: CostRange;
  /** Why it was chosen ("nur 15 min – passt zu „Wenig Zeit“"). */
  because: string[];
}

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
  /** Recurring subject without date ("tip:fiber:low") – for the coach's memory (see tipRules.ts). */
  topic?: string;
}

export interface EngineOptions {
  date: ISODate;
  /** Local hour 0–23 – influences meal sizes and slots. Default 12. */
  hour?: number;
  /** Minute of the hour – for "Training in 45 min". Default 0. */
  minute?: number;
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
