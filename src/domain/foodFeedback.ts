import { fmt } from '../lib/format';
import { calorieStatus } from './calorieStatus';
import type { Macros, MacroKey, Micros, NutritionTarget } from './types';

/**
 * A small, honest reaction when food is logged – derived only from the
 * entry's real values and the day's totals. At most ONE line per entry, so it
 * stays special. Facts, no judgement, no health claims.
 *
 * Priority: a goal reached > sugar information > protein > fiber > balance.
 */
export const FEEDBACK_RULES = {
  /** "Protein-Boost": at least this much protein in the entry … */
  proteinBoostG: 20,
  /** … and at least this share of the entry's energy from protein. */
  proteinEnergyShare: 0.25,
  /** "Gute Ballaststoffquelle" from this much fiber in the entry. */
  fiberG: 5,
  /**
   * Sugar: the EU reference intake for total sugars (Regulation 1169/2011,
   * Annex XIII part B: 90 g) – mentioned once, when the day crosses it.
   */
  sugarReferenceG: 90,
  /** "Ausgewogen": energy shares inside these ranges, for a real meal (≥ 250 kcal). */
  balancedMinKcal: 250,
  balanced: { protein: [0.2, 0.35], carbs: [0.4, 0.55], fat: [0.2, 0.35] },
} as const;

export interface FoodFeedback {
  kind: 'protein_goal' | 'calorie_zone' | 'sugar' | 'protein' | 'fiber' | 'balanced';
  icon: string;
  text: string;
}

export interface FeedbackInput {
  entry: { macros: Macros; micros?: Micros; unknown?: MacroKey[] };
  /** Day totals BEFORE this entry. */
  before: Macros;
  /** Known sugar of the day before this entry (g), if any entry had sugar data. */
  sugarBefore?: number;
  target?: NutritionTarget;
}

export function foodFeedback({ entry, before, sugarBefore, target }: FeedbackInput): FoodFeedback | undefined {
  const F = FEEDBACK_RULES;
  const m = entry.macros;
  const unknown = new Set(entry.unknown ?? []);
  if (!(m.kcal > 0)) return undefined;

  if (target && !unknown.has('protein') && before.protein < target.protein && before.protein + m.protein >= target.protein) {
    return { kind: 'protein_goal', icon: '💪', text: 'Protein-Tagesziel erreicht' };
  }
  if (target) {
    const was = calorieStatus({ eaten: before.kcal, planned: 0, targetKcal: target.kcal, finished: false });
    const now = calorieStatus({ eaten: before.kcal + m.kcal, planned: 0, targetKcal: target.kcal, finished: false });
    if (was?.key !== 'in_zone' && now?.key === 'in_zone') return { kind: 'calorie_zone', icon: '🎯', text: 'Kalorien jetzt im Ziel' };
  }
  const sugar = entry.micros?.sugar;
  if (sugar !== undefined && sugar > 0) {
    const day = (sugarBefore ?? 0) + sugar;
    if ((sugarBefore ?? 0) < F.sugarReferenceG && day >= F.sugarReferenceG) {
      return { kind: 'sugar', icon: 'ℹ️', text: `Zucker heute bei ${fmt.g(day)} – über dem Referenzwert von ${F.sugarReferenceG} g` };
    }
  }
  if (!unknown.has('protein') && m.protein >= F.proteinBoostG && (m.protein * 4) / m.kcal >= F.proteinEnergyShare) {
    return { kind: 'protein', icon: '💪', text: `Starker Protein-Boost · ${fmt.g(m.protein)}` };
  }
  const fiber = entry.micros?.fiber;
  if (fiber !== undefined && fiber >= F.fiberG) return { kind: 'fiber', icon: '🌱', text: `Gute Ballaststoffquelle · ${fmt.g(fiber)}` };
  if (!unknown.size && m.kcal >= F.balancedMinKcal) {
    const share = { protein: (m.protein * 4) / m.kcal, carbs: (m.carbs * 4) / m.kcal, fat: (m.fat * 9) / m.kcal };
    const inside = (Object.keys(F.balanced) as (keyof typeof F.balanced)[]).every((k) => share[k] >= F.balanced[k][0] && share[k] <= F.balanced[k][1]);
    if (inside) return { kind: 'balanced', icon: '🎯', text: 'Ausgewogenes Makroprofil' };
  }
  return undefined;
}

/** "Skyr erfasst · 💪 Starker Protein-Boost · 27 g" */
export function withFeedback(message: string, feedback: FoodFeedback | undefined): string {
  return feedback ? `${message} · ${feedback.icon} ${feedback.text}` : message;
}
