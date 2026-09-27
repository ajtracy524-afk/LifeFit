import { fmt } from '../lib/format';
import { calorieStatus } from './calorieStatus';
import { references, REPORT_RULES } from './nutrientReport';
import { NUTRIENTS } from '../data/nutrients';
import { VITAL_NUTRIENTS } from './nutrition';
import type { Macros, MacroKey, MicroNutrient, Micros, NutritionTarget } from './types';

/**
 * A small, honest reaction when food is logged – derived only from the
 * entry's real values and the day's totals. At most ONE line per entry, so it
 * stays special. Facts, no judgement, no health claims.
 *
 * Priority: a goal reached (protein, calorie zone, fiber) > sugar information > protein > fiber > a vitamin/
 * mineral reaching its reference > balance.
 */
export const FEEDBACK_RULES = {
  /** "Protein-Boost": at least this much protein in the entry … */
  proteinBoostG: 20,
  /** … and at least this share of the entry's energy from protein. */
  proteinEnergyShare: 0.25,
  /** "Gute Ballaststoffquelle" from this much fiber in the entry. */
  fiberG: 5,
  /** "Ausgewogen": energy shares inside these ranges, for a real meal (≥ 250 kcal). */
  balancedMinKcal: 250,
  balanced: { protein: [0.2, 0.35], carbs: [0.4, 0.55], fat: [0.2, 0.35] },
} as const;

export interface FoodFeedback {
  kind: 'protein_goal' | 'calorie_zone' | 'fiber_goal' | 'sugar' | 'protein' | 'fiber' | 'micro' | 'balanced';
  icon: string;
  text: string;
  /** The number behind it (g protein / g fiber of the entry, g sugar of the day) – for the celebration line. */
  amount?: number;
  /** What is still open towards the day target after this entry (protein), if a target exists. */
  remaining?: number;
  /** The reference the amount was compared with (sugar). */
  limit?: number;
  /** The vitamin/mineral behind a "micro" feedback. */
  nutrient?: MicroNutrient;
}

export interface FeedbackInput {
  entry: { macros: Macros; micros?: Micros; unknown?: MacroKey[] };
  /** Day totals BEFORE this entry. */
  before: Macros;
  /** Known sugar of the day before this entry (g), if any entry had sugar data. */
  sugarBefore?: number;
  /** Known vitamin/mineral sums of the day before this entry (only nutrients with data). */
  microsBefore?: Micros;
  target?: NutritionTarget;
}

export function foodFeedback({ entry, before, sugarBefore, microsBefore = {}, target }: FeedbackInput): FoodFeedback | undefined {
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
  // Fiber day goal (the one reference of nutrientReport: 14 g per 1'000 kcal) reached with this entry.
  // A partial day sum is a lower bound – reaching it with the known part is real.
  const fiberGoal = references(target, undefined).fiber?.amount;
  const fiberIn = entry.micros?.fiber;
  if (fiberGoal && fiberIn !== undefined && fiberIn > 0) {
    const was = microsBefore.fiber ?? 0;
    if (was < fiberGoal && was + fiberIn >= fiberGoal) return { kind: 'fiber_goal', icon: '🌱', text: 'Ballaststoff-Tagesziel erreicht', amount: Math.round(was + fiberIn) };
  }
  const sugar = entry.micros?.sugar;
  if (sugar !== undefined && sugar > 0) {
    // The ONE sugar reference of the app (nutrientReport): EU 90 g at 2'000 kcal, scaled to the day target.
    const limit = references(target, undefined).sugar?.amount ?? REPORT_RULES.sugarReferenceG;
    const day = (sugarBefore ?? 0) + sugar;
    if ((sugarBefore ?? 0) < limit && day >= limit) {
      return { kind: 'sugar', icon: 'ℹ️', text: `Zucker heute bei ${fmt.g(day)} – über dem Referenzwert von ${limit} g`, amount: day, limit };
    }
  }
  if (!unknown.has('protein') && m.protein >= F.proteinBoostG && (m.protein * 4) / m.kcal >= F.proteinEnergyShare) {
    return { kind: 'protein', icon: '💪', text: `Starker Protein-Boost · ${fmt.g(m.protein)}`, amount: m.protein, ...(target ? { remaining: Math.max(0, target.protein - before.protein - m.protein) } : {}) };
  }
  const fiber = entry.micros?.fiber;
  if (fiber !== undefined && fiber >= F.fiberG) return { kind: 'fiber', icon: '🌱', text: `Gute Ballaststoffquelle · ${fmt.g(fiber)}`, amount: fiber };
  // A vitamin or mineral crossing its labelling reference (NRV) with this entry – only from values both sides have.
  for (const key of VITAL_NUTRIENTS) {
    const nrv = NUTRIENTS[key].nrv;
    const v = entry.micros?.[key];
    if (nrv === undefined || v === undefined || !(v > 0)) continue;
    const was = microsBefore[key] ?? 0;
    if (was < nrv && was + v >= nrv) return { kind: 'micro', icon: '✨', text: `${NUTRIENTS[key].label}: Referenzwert erreicht`, nutrient: key };
  }
  if (!unknown.size && m.kcal >= F.balancedMinKcal) {
    const share = { protein: (m.protein * 4) / m.kcal, carbs: (m.carbs * 4) / m.kcal, fat: (m.fat * 9) / m.kcal };
    const inside = (Object.keys(F.balanced) as (keyof typeof F.balanced)[]).every((k) => share[k] >= F.balanced[k][0] && share[k] <= F.balanced[k][1]);
    if (inside) return { kind: 'balanced', icon: '✨', text: 'Ausgewogenes Makroprofil' };
  }
  return undefined;
}

/** "Skyr erfasst · 💪 Starker Protein-Boost · 27 g" */
export function withFeedback(message: string, feedback: FoodFeedback | undefined): string {
  return feedback ? `${message} · ${feedback.icon} ${feedback.text}` : message;
}
