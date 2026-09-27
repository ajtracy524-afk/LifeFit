import { foodFeedback, type FoodFeedback } from '../../domain/foodFeedback';
import { daySummary, logFromMeal } from '../../domain/nutrition';
import type { ISODate, LogEntry, PlannedMeal } from '../../domain/types';
import { dayTargetFor } from '../../domain/week';
import { celebrate, type Celebration } from '../../lib/celebrate';
import { fmt } from '../../lib/format';
import { haptic } from '../../lib/motion';
import { withUndo } from '../../lib/undo';
import { getState } from '../../store/store';

type Content = Pick<LogEntry, 'macros' | 'micros' | 'unknown'>;
export type CelebrationInput = Omit<Celebration, 'id'>;

/**
 * The logging loop in one place:
 *   action → undo toast ("Skyr erfasst · Rückgängig")
 *          → ONE celebration from the entry's real values (or a fallback, e.g.
 *            "wieder verwendet"), otherwise just a light haptic tick.
 * The dashboard (ring, macros, micros, budget) animates by itself because the
 * store changed – see ProgressRing / MacroStrip / useCountUp.
 */

/** Feedback for an entry about to be logged on `date` – computed BEFORE the action (uses the day as it is). */
export function feedbackFor(date: ISODate, content: Content): FoodFeedback | undefined {
  const s = getState();
  const day = daySummary(s.logEntries, date).day;
  // Only nutrients with data count as "before" – an unknown sum is not 0.
  const microsBefore = Object.fromEntries(Object.entries(day.micros).filter(([, m]) => m.known > 0).map(([k, m]) => [k, m.value]));
  return foodFeedback({ entry: content, before: day.macros, sugarBefore: day.micros.sugar.known ? day.micros.sugar.value : undefined, microsBefore, target: dayTargetFor(s, date) });
}

/** Which animation and how strong – a reached goal is level 3, good progress level 2, information level 1. */
export function feedbackCelebration(fb: FoodFeedback): CelebrationInput {
  switch (fb.kind) {
    case 'protein_goal':
      return { kind: 'power', icon: '💪', title: 'Protein-Tagesziel erreicht', level: 3 };
    case 'calorie_zone':
      return { kind: 'target', icon: '🎯', title: 'Im Zielbereich', detail: 'Kalorien heute im Ziel', level: 3 };
    case 'sugar':
      return { kind: 'info', icon: 'ℹ️', title: `Zucker heute bei ${fmt.g(fb.amount ?? 0)}`, detail: 'über dem Referenzwert von 90 g', level: 1 };
    case 'protein':
      return { kind: 'power', icon: '💪', title: `+${fmt.g(fb.amount ?? 0)} Protein`, detail: 'Starker Protein-Boost', level: 2 };
    case 'fiber':
      return { kind: 'grow', icon: '🌱', title: `+${fmt.g(fb.amount ?? 0)} Ballaststoffe`, detail: 'Gute Ballaststoffquelle', level: 2 };
    case 'micro':
      return { kind: 'sparkle', icon: '✨', title: fb.text, detail: 'Referenzwert der Lebensmittelkennzeichnung (NRV)', level: 2 };
    case 'balanced':
      return { kind: 'sparkle', icon: '✨', title: 'Gute Balance', detail: 'Ausgewogenes Makroprofil', level: 2 };
  }
}

/**
 * Runs a log action with undo and its feedback. `fallback` is used when the
 * values themselves give no feedback (e.g. an own dish used again).
 * Returns whether something was logged.
 */
export function runLog(date: ISODate, message: string, content: Content | undefined, action: () => boolean | void, fallback?: () => CelebrationInput | undefined): boolean {
  const fb = content ? feedbackFor(date, content) : undefined;
  if (!withUndo(message, action)) return false;
  const c = fb ? feedbackCelebration(fb) : fallback?.();
  if (c) celebrate(c);
  else haptic(1);
  return true;
}

/** A planned meal marked eaten (its entry is derived from the recipe). */
export function runMealEaten(meal: PlannedMeal, message: string, action: () => boolean | void): boolean {
  return runLog(meal.date, message, logFromMeal(meal), action);
}
