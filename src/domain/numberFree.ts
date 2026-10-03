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

/** Portion sizes for logging without numbers – shares of an average meal of the day. */
export const PORTION_FACTOR = { klein: 0.6, normal: 1, groß: 1.4 } as const;

/** "klein / normal / groß" as calories in the background (the number is never shown). */
export function portionKcal(size: keyof typeof PORTION_FACTOR, dayTargetKcal: number, mealsPerDay: number): number {
  return Math.round((dayTargetKcal / Math.max(1, mealsPerDay)) * PORTION_FACTOR[size]);
}

const KCAL = /kcal|kilokalorien/i;

/**
 * Engine, coach and change texts in the number-free mode (E14): parts with a
 * kcal number are left out ("Pasta → Sandwich · −120 kcal" → "Pasta → Sandwich",
 * "Mehr Protein (ca. 300 kcal)" → "Mehr Protein"). A text whose message is the
 * number itself is dropped (undefined) rather than shown half.
 */
export function withoutKcal(text: string): string | undefined {
  let s = text.replace(/\s*\([^()]*(kcal|kilokalorien)[^()]*\)/gi, '');
  // "650 kcal und 50 g Protein" → "50 g Protein" (grams stay).
  s = s.replace(/\d[\d.'’]*\s*kcal\s+und\s+/gi, '');
  const parts = s.split(' · ');
  if (parts.length > 1) s = parts.filter((part) => !KCAL.test(part)).join(' · ');
  // A side clause with the number: "Gut gemacht – 300 kcal unter dem Ziel" → "Gut gemacht".
  s = s.replace(/\s*(,|\s[–—-])\s[^,–—.]*(kcal|kilokalorien)[^,–—.]*/gi, '');
  // Sentences that are about the number go; the advice around them stays.
  s = s
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !KCAL.test(sentence))
    .join(' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s || undefined;
}
