import type { AppState } from './types';

/**
 * Zahlenfreier Modus (E14): a setting, not a diagnosis. Instead of kcal the
 * app speaks in meal portions and progress rings. Grams of protein stay (they
 * are no calorie numbers). Pure helpers, the UI only renders them.
 */

export function isNumberFree(state: Pick<AppState, 'onboarding'>): boolean {
  return state.onboarding?.health.numberFree?.value === true;
}

/** A meal's size relative to an average meal of the day (day target / meals per day). */
export function mealSize(kcal: number, dayTargetKcal: number, mealsPerDay: number): 'klein' | 'normal' | 'groß' {
  const typical = dayTargetKcal / Math.max(1, mealsPerDay);
  if (!typical || kcal < typical * 0.7) return 'klein';
  return kcal > typical * 1.3 ? 'groß' : 'normal';
}

/** "Portion: normal" */
export function portionText(kcal: number, dayTargetKcal: number, mealsPerDay: number): string {
  return `Portion: ${mealSize(kcal, dayTargetKcal, mealsPerDay)}`;
}

/** Eaten amount of the day in average meals, in halves: "1½ von 4 Mahlzeiten". */
export function dayPortions(eatenKcal: number, dayTargetKcal: number, mealsPerDay: number): { eaten: number; total: number; amount: string; text: string } {
  const total = Math.max(1, mealsPerDay);
  const eaten = dayTargetKcal > 0 ? Math.round(((eatenKcal / dayTargetKcal) * total) * 2) / 2 : 0;
  const whole = Math.floor(eaten);
  const half = eaten - whole >= 0.5;
  const amount = half ? (whole ? `${whole}½` : '½') : String(whole);
  return { eaten, total, amount, text: `ca. ${amount} von ${total} Mahlzeiten` };
}
