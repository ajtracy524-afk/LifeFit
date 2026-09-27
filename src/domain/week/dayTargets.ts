import { addDays, weekDays, weekStart } from '../dates';
import { calorieFloor, targetForDate } from '../nutrition';
import { appStartDate, currentWeight } from '../progress';
import { sessionLoad } from '../adaptive/load';
import { activeWorkouts } from '../training';
import type { AppState, ISODate, Macros, NutritionTarget } from '../types';

/**
 * Training days get more energy, the other days correspondingly less – the
 * WEEKLY sum stays exactly the stored target × 7. Protein and fat stay
 * constant, the difference is carried by carbohydrates.
 */
export const TRAINING_DAY_KCAL = 150;

/**
 * At most this many days per week get the training bonus. With 6 training
 * days a single rest day would otherwise have to absorb −900 kcal; capped,
 * the two non-bonus days take −375 each – exactly like a 5-day week.
 * Only the calorie bonus is capped – sessions and rotation are unaffected.
 */
export const MAX_BONUS_DAYS = 5;

/** kcal shift of one day. 0 if no day gets a bonus. */
export function dayShift(isBonusDay: boolean, bonusDays: number): number {
  if (bonusDays <= 0 || bonusDays >= 7) return 0;
  return isBonusDay ? TRAINING_DAY_KCAL : -Math.round((TRAINING_DAY_KCAL * bonusDays) / (7 - bonusDays));
}

/** Training days that get the bonus: the first MAX_BONUS_DAYS of the week (deterministic). */
export function bonusDates(trainingDays: Set<ISODate>): Set<ISODate> {
  return new Set([...trainingDays].sort().slice(0, MAX_BONUS_DAYS));
}

export function shiftTarget<T extends Macros>(base: T, deltaKcal: number): T {
  if (deltaKcal === 0) return base;
  return { ...base, kcal: base.kcal + deltaKcal, carbs: Math.max(0, Math.round(base.carbs + deltaKcal / 4)) };
}

/**
 * Load-based split of the week's training energy: a bonus day whose session is
 * clearly more demanding than the week's average (leg day) gets more, a
 * clearly lighter one (arm day) less – between 70 % and 130 % of the bonus,
 * only when it differs by 10 % or more, rounded to 5 kcal. The rest days carry
 * exactly the sum of the bonuses, so the weekly total stays the same. With
 * similar sessions every bonus day keeps TRAINING_DAY_KCAL.
 */
export const LOAD_SPLIT = { min: 0.7, max: 1.3, threshold: 0.1 } as const;

export function bonusKcalByDate(state: Pick<AppState, 'training' | 'workoutOverrides' | 'workouts' | 'dayContexts'>, weekStartDate: ISODate): Map<ISODate, number> {
  const sessions = activeWorkouts(state.training, state.workoutOverrides, state.workouts, weekStartDate);
  const bonus = bonusDates(new Set(sessions.map((w) => w.date)));
  const loads = new Map<ISODate, number>();
  for (const w of sessions) if (bonus.has(w.date)) loads.set(w.date, (loads.get(w.date) ?? 0) + sessionLoad(w.template).score);
  const mean = [...loads.values()].reduce((a, b) => a + b, 0) / Math.max(1, loads.size);
  const out = new Map<ISODate, number>();
  for (const [date, load] of loads) {
    const raw = mean > 0 ? load / mean : 1;
    const factor = Math.abs(raw - 1) < LOAD_SPLIT.threshold ? 1 : Math.min(LOAD_SPLIT.max, Math.max(LOAD_SPLIT.min, raw));
    out.set(date, Math.round((TRAINING_DAY_KCAL * factor) / 5) * 5);
  }
  return out;
}

/** The training bonus of a day and its session's character ("Beintag") – for explanations. */
export function trainingDayBonus(state: AppState, date: ISODate): { kcal: number; label?: string } | undefined {
  const kcal = bonusKcalByDate(state, weekStart(date)).get(date);
  if (kcal === undefined) return undefined;
  const session = activeWorkouts(state.training, state.workoutOverrides, state.workouts, weekStart(date)).find((w) => w.date === date);
  const label = session ? sessionLoad(session.template).label : undefined;
  return { kcal, ...(label ? { label } : {}) };
}

/** Dates with a session that takes place (moved sessions count on their new day). */
export function trainingDates(state: Pick<AppState, 'training' | 'workoutOverrides' | 'workouts'>, weekStartDate: ISODate): Set<ISODate> {
  return new Set(activeWorkouts(state.training, state.workoutOverrides, state.workouts, weekStartDate).map((w) => w.date));
}

/** No open day moves further than this from its base target (same bound as a 5-day week). */
export const MAX_DAY_SHIFT = 375;

/**
 * The target that applies to one concrete day. Every screen and the planner
 * use this – never the raw stored target – so all views agree.
 *
 * Closed (past) days use their frozen value. Open days follow the training
 * rule; if frozen days of the same week differ from what the rule would give
 * them now (the week changed later), the open days carry the difference, so
 * the weekly sum stays – bounded by ±MAX_DAY_SHIFT and the calorie floor.
 */
export function dayTargetFor(state: AppState, date: ISODate): NutritionTarget | undefined {
  const base = targetForDate(state.targets, date);
  if (!base) return undefined;
  const frozen = state.closedDayTargets?.[date];
  if (frozen !== undefined) return shiftTarget(base, frozen - base.kcal);

  const week = weekDays(weekStart(date));
  const bonus = bonusKcalByDate(state, week[0]!);
  const floor = floorFor(state);
  let kcal = ruleKcal(state, date, bonus, floor)!;

  const closed = week.filter((d) => state.closedDayTargets?.[d] !== undefined);
  if (closed.length > 0) {
    const open = week.filter((d) => !closed.includes(d) && targetForDate(state.targets, d));
    const residual = closed.reduce((sum, d) => sum + ((ruleKcal(state, d, bonus, floor) ?? 0) - state.closedDayTargets[d]!), 0);
    kcal += Math.round(residual / Math.max(1, open.length));
    kcal = Math.min(base.kcal + MAX_DAY_SHIFT, Math.max(base.kcal - MAX_DAY_SHIFT, kcal));
    if (floor !== undefined) kcal = Math.max(kcal, Math.ceil(floor(base.kcal)));
  }
  return shiftTarget(base, kcal - base.kcal);
}

/** kcal of a day by the training rule alone (no frozen values involved). */
function ruleKcal(state: AppState, date: ISODate, bonus: Map<ISODate, number>, floor: ((baseKcal: number) => number) | undefined): number | undefined {
  const base = targetForDate(state.targets, date);
  if (!base) return undefined;
  const total = [...bonus.values()].reduce((a, b) => a + b, 0);
  let delta = bonus.size <= 0 || bonus.size >= 7 ? 0 : (bonus.get(date) ?? -Math.round(total / (7 - bonus.size)));
  // Rest days never drop below the safety floor.
  if (delta < 0 && floor) delta = Math.max(delta, Math.min(0, Math.ceil(floor(base.kcal) - base.kcal)));
  return base.kcal + delta;
}

function floorFor(state: AppState): ((baseKcal: number) => number) | undefined {
  if (!state.profile) return undefined;
  const weight = currentWeight(state.weights) ?? state.goal?.startWeightKg;
  if (!weight) return undefined;
  const value = calorieFloor(state.profile, weight);
  return () => value;
}

/** Days before today not yet frozen – from the app start, at most this far back. */
const CLOSE_LOOKBACK_DAYS = 14;

/**
 * Freezes the target of every completed day (before `today`) that has none yet.
 * Idempotent: returns the SAME state object if nothing had to be frozen.
 * Days before the app start or without a target are never invented.
 */
export function closeCompletedDays(state: AppState, today: ISODate): AppState {
  if (!state.profile || state.targets.length === 0) return state;
  const start = maxDate(appStartDate(state), addDays(today, -CLOSE_LOOKBACK_DAYS));
  const toClose: ISODate[] = [];
  for (let d = start; d < today; d = addDays(d, 1)) {
    if (state.closedDayTargets?.[d] === undefined && targetForDate(state.targets, d)) toClose.push(d);
  }
  if (toClose.length === 0) return state;
  const closedDayTargets = { ...(state.closedDayTargets ?? {}) };
  // Values are computed from the state as it is (before adding any of them), day by day.
  for (const d of toClose) closedDayTargets[d] = dayTargetFor(state, d)!.kcal;
  return { ...state, closedDayTargets };
}

const maxDate = (a: ISODate, b: ISODate) => (a > b ? a : b);
