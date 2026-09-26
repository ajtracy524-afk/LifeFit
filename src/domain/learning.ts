import { weekdayIndex } from './dates';
import type { ISODate, MealSlot, PreferenceStat, TimeBudget } from './types';

/**
 * Personalization layer – what LifeFit learned from real behaviour.
 *
 * ONE structure for everything: evidence per key. No ML, no black box – every
 * score can be traced back to counted events:
 *
 *   recipe:<id>            the recipe in general
 *   recipe:<id>@<budget>   the recipe on days with that time budget (context)
 *   weekday:<0-6>          training on that weekday
 *   hour:<0-23>            training starting at that hour
 *
 * Learning is deliberately slow (a prior of 4 "neutral" observations): one
 * skip barely moves a score, five do.
 */

/** Evidence per key: `pos` (eaten, completed …) and `neg` (skipped, swapped away …). */
export type Preferences = Record<string, PreferenceStat>;

export const prefKey = {
  recipe: (id: string) => `recipe:${id}`,
  recipeAt: (id: string, budget: TimeBudget) => `recipe:${id}@${budget}`,
  weekday: (index: number) => `weekday:${index}`,
  hour: (h: number) => `hour:${h}`,
};

export const LEARNING = {
  /** Neutral observations assumed before any evidence – makes learning slow. */
  prior: 4,
  /** A skip on a busy day says more about effort than about taste. */
  contextOnlyShare: 0.5,
  /** Choosing an alternative is a weaker signal than actually eating it. */
  swapTargetShare: 0.5,
  /** Evidence is capped so recent behaviour can still change a preference. */
  maxEvidence: 30,
  /** Below this confidence a preference is not mentioned to the user. */
  showFromConfidence: 0.5,
} as const;

export type LearningEvent =
  | { type: 'meal_eaten'; recipeId: string; slot: MealSlot; timeBudget: TimeBudget }
  | { type: 'meal_uneaten'; recipeId: string; slot: MealSlot; timeBudget: TimeBudget }
  | { type: 'meal_skipped'; recipeId: string; slot: MealSlot; timeBudget: TimeBudget }
  | { type: 'meal_swapped'; fromRecipeId: string; toRecipeId: string; slot: MealSlot; timeBudget: TimeBudget }
  | { type: 'workout_completed'; date: ISODate; hour: number }
  | { type: 'workout_skipped'; date: ISODate }
  | { type: 'workout_moved'; from: ISODate; to: ISODate };

/** Pure: returns new preferences with the event's evidence added. */
export function learnFromEvent(prefs: Preferences, event: LearningEvent, nowIso: string): Preferences {
  const next = { ...prefs };
  const add = (key: string, pos: number, neg: number) => {
    const s = next[key] ?? { pos: 0, neg: 0, updatedAt: nowIso };
    let p = Math.max(0, s.pos + pos);
    let n = Math.max(0, s.neg + neg);
    const total = p + n;
    if (total > LEARNING.maxEvidence) {
      p = (p * LEARNING.maxEvidence) / total;
      n = (n * LEARNING.maxEvidence) / total;
    }
    next[key] = { pos: round(p), neg: round(n), updatedAt: nowIso };
  };

  switch (event.type) {
    case 'meal_eaten':
      add(prefKey.recipe(event.recipeId), 1, 0);
      add(prefKey.recipeAt(event.recipeId, event.timeBudget), 1, 0);
      break;
    case 'meal_uneaten':
      add(prefKey.recipe(event.recipeId), -1, 0);
      add(prefKey.recipeAt(event.recipeId, event.timeBudget), -1, 0);
      break;
    case 'meal_skipped':
      negative(add, event.recipeId, event.timeBudget);
      break;
    case 'meal_swapped':
      negative(add, event.fromRecipeId, event.timeBudget);
      add(prefKey.recipe(event.toRecipeId), LEARNING.swapTargetShare, 0);
      add(prefKey.recipeAt(event.toRecipeId, event.timeBudget), LEARNING.swapTargetShare, 0);
      break;
    case 'workout_completed':
      add(prefKey.weekday(weekdayIndex(event.date)), 1, 0);
      add(prefKey.hour(event.hour), 1, 0);
      break;
    case 'workout_skipped':
      add(prefKey.weekday(weekdayIndex(event.date)), 0, 1);
      break;
    case 'workout_moved':
      add(prefKey.weekday(weekdayIndex(event.from)), 0, 0.5);
      add(prefKey.weekday(weekdayIndex(event.to)), 0.5, 0);
      break;
  }
  return next;
}

/** Records an event on a draft state (actions and cascade use this – never the UI). */
export function recordEvent(draft: { learning: { preferences: Preferences } }, event: LearningEvent, nowIso: string): void {
  draft.learning = { preferences: learnFromEvent(draft.learning?.preferences ?? {}, event, nowIso) };
}

/** On a normal day a skip counts fully against the recipe; on a busy day mostly against the context. */
function negative(add: (key: string, pos: number, neg: number) => void, recipeId: string, budget: TimeBudget) {
  add(prefKey.recipeAt(recipeId, budget), 0, 1);
  add(prefKey.recipe(recipeId), 0, budget === 'normal' ? 1 : LEARNING.contextOnlyShare);
}

export interface Preference {
  /** −1 (avoided) … +1 (liked). */
  score: number;
  /** 0 … 1 – how much evidence stands behind the score. */
  confidence: number;
  evidence: number;
}

export function preferenceOf(stat: PreferenceStat | undefined): Preference {
  if (!stat) return { score: 0, confidence: 0, evidence: 0 };
  const n = stat.pos + stat.neg;
  return { score: (stat.pos - stat.neg) / (n + LEARNING.prior), confidence: n / (n + LEARNING.prior), evidence: n };
}

/**
 * Aggregated lookup for the planner: built ONCE per planning run, so scoring a
 * candidate is a map lookup – no history is scanned per meal.
 * Score × confidence: one event barely counts, repeated behaviour does.
 * Context evidence (recipe@budget) is blended in by its own confidence.
 */
export function affinityIndex(prefs: Preferences): (recipeId: string, budget: TimeBudget) => number {
  const cache = new Map<string, number>();
  return (recipeId, budget) => {
    const key = `${recipeId}@${budget}`;
    let value = cache.get(key);
    if (value === undefined) {
      const general = preferenceOf(prefs[prefKey.recipe(recipeId)]);
      const context = preferenceOf(prefs[prefKey.recipeAt(recipeId, budget)]);
      const g = general.score * general.confidence;
      const c = context.score * context.confidence;
      value = g * (1 - context.confidence) + c * context.confidence;
      cache.set(key, value);
    }
    return value;
  };
}

/** Weekdays the user actually trains on – for suggestions in the weekly check-in. */
export function learnedTrainingDays(prefs: Preferences, minConfidence = LEARNING.showFromConfidence): number[] {
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => {
    const p = preferenceOf(prefs[prefKey.weekday(d)]);
    return p.confidence >= minConfidence && p.score > 0.3;
  });
}

/** The hour training usually starts, if there is enough evidence. */
export function learnedTrainingHour(prefs: Preferences): number | undefined {
  let best: { hour: number; evidence: number } | undefined;
  for (let h = 0; h < 24; h++) {
    const p = preferenceOf(prefs[prefKey.hour(h)]);
    if (p.confidence >= LEARNING.showFromConfidence && (!best || p.evidence > best.evidence)) best = { hour: h, evidence: p.evidence };
  }
  return best?.hour;
}

const round = (n: number) => Math.round(n * 100) / 100;
