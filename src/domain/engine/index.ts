import type { AppState } from '../types';
import { buildContext, type EngineContext } from './context';
import { applyGuardrails } from './guardrails';
import { leftoversRule, nutritionGapRule, nutritionOverRule, ownDishRule, proteinPatternRule, waterPaceRule } from './nutritionRules';
import { bodyRateRule, shoppingRule } from './planRules';
import { frequencyRule, missedRule, programRule, recoveryRule, stallRule, timeRule, undertrainedRule } from './trainingRules';
import { cardioRule, levelRule, preWorkoutRule } from './adaptiveRules';
import { habitTipsRule } from './tipRules';
import type { EngineDomain, EngineOptions, Priority, Recommendation } from './types';

export * from './types';
export { buildContext, type EngineContext } from './context';
export { DISCLAIMER, validateCoachText } from './guardrails';
export { regionLoad, REGION_LABEL } from './trainingRules';
export { fitTemplateToTime } from '../training';
export { suggestMealsForGap } from './nutritionRules';

type Rule = (ctx: EngineContext) => Recommendation[];

/** Order = tie-breaker within the same priority. */
/** `only`: the rule produces only these domains – skipped when a screen asks for others (the tips read 30 days). */
export const RULES: { name: string; run: Rule; only?: EngineDomain[] }[] = [
  { name: 'training_time', run: timeRule },
  { name: 'pre_workout', run: preWorkoutRule },
  { name: 'training_recovery', run: recoveryRule },
  { name: 'training_frequency', run: frequencyRule },
  { name: 'own_dish', run: ownDishRule },
  { name: 'nutrition_gap', run: nutritionGapRule },
  { name: 'water_pace', run: waterPaceRule },
  { name: 'shopping_missing', run: shoppingRule },
  { name: 'training_missed', run: missedRule },
  { name: 'protein_pattern', run: proteinPatternRule },
  { name: 'body_rate', run: bodyRateRule },
  { name: 'training_undertrained', run: undertrainedRule },
  { name: 'leftovers', run: leftoversRule },
  { name: 'training_stall', run: stallRule },
  { name: 'training_program', run: programRule },
  { name: 'training_level', run: levelRule },
  { name: 'training_cardio', run: cardioRule },
  { name: 'tips', run: habitTipsRule, only: ['tips'] },
  { name: 'nutrition_over', run: nutritionOverRule },
];

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/**
 * Adaptive Fitness Engine.
 *   state → context (facts) → rules → guardrails → dismissals → ranking
 * Pure and deterministic: same state + options ⇒ same recommendations.
 */
export function runEngine(state: AppState, options: EngineOptions): Recommendation[] {
  if (!state.profile) return [];
  const ctx = buildContext(state, options);

  const raw: Recommendation[] = [];
  for (const rule of RULES) {
    if (rule.only && options.domains && !rule.only.some((d) => options.domains!.includes(d))) continue;
    try {
      raw.push(...rule.run(ctx));
    } catch (err) {
      // One broken rule must never take down the "Heute" screen.
      console.error(`[engine] rule ${rule.name} failed`, err);
    }
  }

  // Recovery and frequency both propose a replacement for today's session – show one.
  const hasRecovery = raw.some((r) => r.kind === 'training_recovery');
  // A level step and a program change are both about the program – the level step (from real progress) wins.
  const hasLevel = raw.some((r) => r.kind === 'training_level');
  const deduped = raw.filter((r) => !(hasRecovery && (r.kind === 'training_frequency' || r.kind === 'training_undertrained')) && !(hasLevel && r.kind === 'training_program'));

  const dismissed = state.coach?.dismissed ?? {};
  return applyGuardrails(deduped, ctx.safety, ctx.date)
    .filter((r) => r.kind === 'safety' || !dismissed[r.id])
    .filter((r) => !options.domains || options.domains.includes(r.domain))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => PRIORITY_RANK[a.r.priority] - PRIORITY_RANK[b.r.priority] || a.i - b.i)
    .map(({ r }) => r)
    .slice(0, options.limit ?? 5);
}
