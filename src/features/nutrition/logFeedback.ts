import { foodFeedback, withFeedback, type FoodFeedback } from '../../domain/foodFeedback';
import { daySummary, logFromMeal } from '../../domain/nutrition';
import type { ISODate, LogEntry, PlannedMeal } from '../../domain/types';
import { dayTargetFor } from '../../domain/week';
import { getState } from '../../store/store';

type Content = Pick<LogEntry, 'macros' | 'micros' | 'unknown'>;

/** Feedback for an entry about to be logged on `date` – call BEFORE the action (uses the day as it is). */
export function feedbackFor(date: ISODate, content: Content): FoodFeedback | undefined {
  const s = getState();
  const day = daySummary(s.logEntries, date).day;
  return foodFeedback({ entry: content, before: day.macros, sugarBefore: day.micros.sugar.known ? day.micros.sugar.value : undefined, target: dayTargetFor(s, date) });
}

/** "Skyr erfasst · 💪 Starker Protein-Boost · 27 g" – the toast text for a log. */
export function loggedMessage(date: ISODate, message: string, content: Content): string {
  return withFeedback(message, feedbackFor(date, content));
}

/** Same for a planned meal marked eaten (its entry is derived from the recipe). */
export function mealLoggedMessage(meal: PlannedMeal | undefined, message: string): string {
  return meal ? loggedMessage(meal.date, message, logFromMeal(meal)) : message;
}
