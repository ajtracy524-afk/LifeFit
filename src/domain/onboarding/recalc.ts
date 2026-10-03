import { fmt } from '../../lib/format';
import { targetOptionsFor } from '../body';
import { calculateTargets, targetForDate } from '../nutrition';
import { currentWeight } from '../progress';
import type { AppState, GoalType, ISODate, Macros, Profile } from '../types';

/**
 * Profile changes after the onboarding (Prompt 9): what the new values would do
 * to the daily target – "Vorher / Nachher". Nothing is stored here; a new
 * target version is written only when the preview is confirmed (E10).
 */

export interface ProfileChange {
  profile?: Partial<Pick<Profile, 'sex' | 'age' | 'heightCm' | 'activity'>>;
  goalType?: GoalType;
  trainingDays?: number;
}

export interface RecalcPreview {
  before: Macros;
  after: Macros;
  /** Whether the new target differs from the current one. */
  changed: boolean;
  /** "Kalorien: 2'400 → 2'550 kcal (+150)" – or portions in the number-free mode. */
  lines: string[];
}

const n = fmt.int;
const signed = (d: number) => (d > 0 ? `+${n(d)}` : n(d));

export function recalcPreview(state: AppState, change: ProfileChange, today: ISODate): RecalcPreview | undefined {
  if (!state.profile || !state.goal || !state.training) return undefined;
  const before = targetForDate(state.targets, today);
  if (!before) return undefined;
  const weight = currentWeight(state.weights) ?? state.goal.startWeightKg;
  const calc = calculateTargets(
    { ...state.profile, ...change.profile },
    change.goalType ?? state.goal.type,
    weight,
    change.trainingDays ?? state.training.weekdays.length,
    targetOptionsFor(state),
  );
  const after: Macros = { kcal: calc.kcal, protein: calc.protein, carbs: calc.carbs, fat: calc.fat };
  const was: Macros = { kcal: before.kcal, protein: before.protein, carbs: before.carbs, fat: before.fat };
  const changed = (['kcal', 'protein', 'carbs', 'fat'] as const).some((k) => was[k] !== after[k]);
  return { before: was, after, changed, lines: previewLines(was, after, state.onboarding?.health.numberFree?.value === true) };
}

export function previewLines(before: Macros, after: Macros, numberFree: boolean): string[] {
  if (numberFree) {
    const d = after.kcal - before.kcal;
    // ±3 % is below what a portion shows.
    if (Math.abs(d) < before.kcal * 0.03) return ['Deine Portionen bleiben etwa gleich.'];
    return [d > 0 ? 'Deine Portionen werden etwas größer.' : 'Deine Portionen werden etwas kleiner.'];
  }
  const row = (label: string, k: keyof Macros, unit: string) =>
    `${label}: ${n(before[k])} → ${n(after[k])} ${unit}${after[k] !== before[k] ? ` (${signed(after[k] - before[k])})` : ''}`;
  return [row('Kalorien', 'kcal', 'kcal'), row('Protein', 'protein', 'g'), row('Kohlenhydrate', 'carbs', 'g'), row('Fett', 'fat', 'g')];
}
