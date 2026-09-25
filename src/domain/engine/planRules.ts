import { fmt } from '../../lib/format';
import { addDays, daysBetween } from '../dates';
import { calorieFloor, dayTotals, macrosForCalories, targetForDate } from '../nutrition';
import { weekShopping } from '../week';
import type { EngineContext } from './context';
import type { Recommendation } from './types';

// ---------- Shopping ----------

/**
 * "Für die geplanten Mahlzeiten fehlen noch 7 Lebensmittel."
 * The list itself is derived from the plan, so accepting any meal suggestion
 * updates it automatically. This rule only surfaces what is still missing.
 */
export function shoppingRule(ctx: EngineContext): Recommendation[] {
  // Same derived list the Einkauf tab shows: plan need minus pantry and purchases.
  const items = weekShopping(ctx.state, ctx.weekStart, ctx.date).filter((i) => i.state === 'open');
  if (items.length === 0) return [];

  const tomorrow = addDays(ctx.date, 1);
  const urgent = items.filter((i) => i.sources.some((s) => s.date <= tomorrow));
  const n = items.length;

  return [
    {
      id: `shopping_missing:${ctx.date}:${n}`,
      kind: 'shopping_missing',
      domain: 'shopping',
      priority: urgent.length > 0 ? 'high' : 'low',
      confidence: 'high',
      title: `Für die geplanten Mahlzeiten ${n === 1 ? 'fehlt' : 'fehlen'} noch ${n} Lebensmittel`,
      message: urgent.length
        ? `${urgent.length} davon brauchst du heute oder morgen: ${urgent
            .slice(0, 3)
            .map((i) => i.name)
            .join(', ')}${urgent.length > 3 ? ' …' : ''}.`
        : 'Die Einkaufsliste ist aktuell – sie passt sich jeder Planänderung automatisch an.',
      reasons: [],
      facts: { missing: n, urgent: urgent.length },
      actions: [{ type: 'open', label: 'Einkaufsliste öffnen', route: 'shopping' }],
    },
  ];
}

// ---------- Body weight trend ----------

export const BODY_RULES = {
  /** Weekly change as % of body weight that fits each goal. */
  band: {
    fat_loss: { min: -1.0, max: -0.2 },
    muscle_gain: { min: 0.05, max: 0.5 },
    maintain: { min: -0.3, max: 0.3 },
  },
  step: 150,
  /** At least this many days between two adaptive target changes. */
  cooldownDays: 14,
  /** Trend needs ≥ this many weigh-ins spanning ≥ minSpanDays. */
  minWeighIns: 4,
  minSpanDays: 14,
  /** Adherence: logged days in the last 14 and average within ±10 % of target. */
  minLoggedDays: 8,
  adherenceTolerance: 0.1,
} as const;

/**
 * Compares the real weight trend with the goal and proposes a small target
 * change (±150 kcal). Only if data is reliable, the user logs consistently,
 * the last change is ≥ 14 days ago and never below the calorie floor.
 */
export function bodyRateRule(ctx: EngineContext): Recommendation[] {
  const { state, weightKg, weeklyRateKg } = ctx;
  // The stored target – day shifts for training/rest days are not what gets adjusted.
  const target = targetForDate(state.targets, ctx.date);
  const B = BODY_RULES;
  if (!state.goal || !state.profile || !target || !weightKg || weeklyRateKg === undefined) return [];

  const weights = state.weights.filter((w) => w.date <= ctx.date).sort((a, b) => a.date.localeCompare(b.date));
  if (weights.length < B.minWeighIns || daysBetween(weights[0]!.date, ctx.date) < B.minSpanDays) return [];
  if (daysBetween(target.validFrom, ctx.date) < B.cooldownDays) return [];

  const days = Array.from({ length: 14 }, (_, i) => addDays(ctx.date, -(i + 1)));
  const logged = days.map((d) => ({ d, kcal: dayTotals(state.logEntries, d).kcal })).filter((x) => x.kcal > 0);
  if (logged.length < B.minLoggedDays) return [];
  const avgRatio = logged.reduce((s, x) => s + x.kcal / (targetForDate(state.targets, x.d)?.kcal ?? target.kcal), 0) / logged.length;
  if (Math.abs(avgRatio - 1) > B.adherenceTolerance) return [];

  const pct = (weeklyRateKg / weightKg) * 100;
  const band = B.band[state.goal.type];
  let delta = 0;
  if (pct < band.min) delta = B.step;
  else if (pct > band.max) delta = -B.step;
  if (delta === 0) return [];

  const floor = calorieFloor(state.profile, weightKg);
  const kcal = Math.round(Math.max(target.kcal + delta, floor) / 10) * 10;
  if (kcal === target.kcal) return [];
  delta = kcal - target.kcal;

  const direction = weeklyRateKg < 0 ? 'sinkt' : 'steigt';
  const tooFast = (state.goal.type === 'fat_loss' && delta > 0) || (state.goal.type === 'muscle_gain' && delta < 0);
  return [
    {
      id: `body_rate:${ctx.date}`,
      kind: 'body_rate',
      domain: 'body',
      priority: 'medium',
      confidence: weights.length >= 8 ? 'high' : 'medium',
      title: `Kalorienziel um ${fmt.int(Math.abs(delta))} kcal ${delta > 0 ? 'erhöhen' : 'senken'}?`,
      message: `Dein Gewicht ${direction} um ${fmt.dec(Math.abs(weeklyRateKg))} kg pro Woche – ${
        tooFast ? 'schneller' : 'langsamer'
      } als für dein Ziel sinnvoll. Neues Ziel: ${fmt.kcal(kcal)}. Protein bleibt gleich.`,
      reasons: [`${weights.length} Wiegungen, ${logged.length} erfasste Tage in 2 Wochen`, `Zielbereich: ${band.min} bis ${band.max} % pro Woche`],
      facts: { weeklyRateKg: Math.round(weeklyRateKg * 100) / 100, pct: Math.round(pct * 100) / 100, currentKcal: target.kcal, newKcal: kcal, delta },
      actions: [{ type: 'set_targets', label: `Ziel auf ${fmt.kcal(kcal)} setzen`, macros: macrosForCalories(kcal, target.protein, weightKg) }],
      increasesDeficit: delta < 0,
    },
  ];
}
