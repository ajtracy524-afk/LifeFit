import { describe, expect, it } from 'vitest';
import { emptyState, loadState, migrateV1 } from '../../store/persistence';
import { weekDays } from '../dates';
import { planSlotId } from '../training';
import type { AppState, PlannedMeal } from '../types';
import { applyWeekChange, type CascadeResult, type WeekChange } from './cascade';
import { closeCompletedDays, dayTargetFor, MAX_DAY_SHIFT } from './dayTargets';

/**
 * Closed days keep the target they had – later changes of the week are carried
 * by the open days only (weekly sum kept, bounded, never below the floor).
 */

const MON = '2026-09-21';
const TUE = '2026-09-22';
const WED = '2026-09-23';
const THU = '2026-09-24';
const SAT = '2026-09-26';
const WEEK = weekDays(MON);
const WED_MORNING = new Date(2026, 8, 23, 8, 0);

function state(patch: Partial<AppState> = {}): AppState {
  return {
    ...emptyState(),
    profile: { name: 'T', sex: 'male', age: 30, heightCm: 180, activity: 'moderate', experience: 'beginner', createdAt: '2026-09-14T08:00:00Z' },
    goal: { type: 'muscle_gain', startWeightKg: 80, startedAt: '2026-09-14' },
    nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['breakfast', 'lunch', 'dinner'] },
    targets: [{ id: 't', validFrom: '2026-09-14', method: 'formula', kcal: 2800, protein: 160, carbs: 330, fat: 80 }],
    training: { programId: 'full-body', weekdays: [0, 2, 4, 5] },
    weights: [{ id: 'w', date: '2026-09-14', kg: 80 }],
    ...patch,
  };
}
const ok = (r: CascadeResult) => {
  if (!r.ok) throw new Error(r.reason);
  return r;
};
const kcal = (s: AppState, d: string) => dayTargetFor(s, d)!.kcal;
const weekSum = (s: AppState) => WEEK.reduce((sum, d) => sum + kcal(s, d), 0);
/** State as the app sees it on Wednesday: Monday and Tuesday are closed. */
const onWednesday = (patch: Partial<AppState> = {}) => closeCompletedDays(state(patch), WED);

describe('day close', () => {
  it('freezes yesterday and earlier days – not today, not tomorrow', () => {
    const s = onWednesday();
    expect(s.closedDayTargets[MON]).toBe(2950); // training day
    expect(s.closedDayTargets[TUE]).toBe(2600); // rest day: −150·4/3
    expect(s.closedDayTargets[WED]).toBeUndefined();
    expect(s.closedDayTargets[THU]).toBeUndefined();
  });

  it('is idempotent: running it again returns the very same state', () => {
    const s = onWednesday();
    expect(closeCompletedDays(s, WED)).toBe(s);
  });

  it('a new user (started today) has nothing to close; days before the start are never invented', () => {
    const fresh = state({ profile: { ...state().profile!, createdAt: `${WED}T07:00:00Z` } });
    expect(closeCompletedDays(fresh, WED)).toBe(fresh);
    expect(Object.keys(onWednesday().closedDayTargets).every((d) => d >= '2026-09-14')).toBe(true);
  });

  it('frozen values survive a reload', () => {
    const s = onWednesday();
    const data: Record<string, string> = { 'lifefit:v1': JSON.stringify(s) };
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => data[k] ?? null, setItem: () => {}, removeItem: () => {} };
    expect(loadState().state.closedDayTargets).toEqual(s.closedDayTargets);
  });

  it('older data without history gets no invented values', () => {
    const v1 = { ...state(), schemaVersion: 1, shopping: {} } as unknown as Record<string, unknown>;
    delete v1.closedDayTargets;
    expect(migrateV1(v1, WED_MORNING).closedDayTargets).toEqual({});
  });
});

describe('later changes never rewrite closed days', () => {
  const meals = (): PlannedMeal[] =>
    ['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'].flatMap((date) =>
      (['breakfast', 'lunch', 'dinner'] as const).map((slot, i) => ({
        id: `${date}-${slot}`,
        date,
        slot,
        recipeId: ['overnight-oats', 'chicken-wraps', 'bolognese'][i]!,
        servings: 1,
        status: 'planned' as const,
        source: 'suggest' as const,
      })),
    );

  const changes: [string, WeekChange][] = [
    ['skip Saturday', { type: 'skipWorkout', slotId: planSlotId(MON, 3) }],
    ['move Saturday → Sunday', { type: 'moveWorkout', slotId: planSlotId(MON, 3), toDate: '2026-09-27' }],
    ['time budget', { type: 'setDayContext', date: THU, context: { timeBudget: 'low' } }],
    ['eating out', { type: 'setDayContext', date: SAT, context: { mode: 'eating_out' } }],
    ['re-plan the week', { type: 'planWeek', week: MON, trainingDays: [3], days: {} }],
  ];

  it.each(changes)('%s: Monday and Tuesday keep their targets, the week sum stays', (_, change) => {
    const s = onWednesday({ plannedMeals: meals() });
    const r = ok(applyWeekChange(s, change, WED_MORNING));
    expect(kcal(r.state, MON)).toBe(2950);
    expect(kcal(r.state, TUE)).toBe(2600);
    expect(Math.abs(weekSum(r.state) - 2800 * 7)).toBeLessThanOrEqual(7);
    expect(r.summary.targetChanges.every((t) => t.date >= WED)).toBe(true);
  });

  it('without freezing the same skip WOULD have changed Tuesday (the bug this fixes)', () => {
    const unfrozen = state();
    const r = ok(applyWeekChange(unfrozen, { type: 'skipWorkout', slotId: planSlotId(MON, 3) }, new Date(2026, 8, 21, 8)));
    expect(kcal(r.state, TUE)).not.toBe(kcal(unfrozen, TUE));
  });

  it('the cascade closes past days itself before changing anything', () => {
    const s = state(); // nothing frozen yet
    const r = ok(applyWeekChange(s, { type: 'skipWorkout', slotId: planSlotId(MON, 3) }, WED_MORNING));
    expect(r.state.closedDayTargets[TUE]).toBe(kcal(s, TUE));
  });

  it('undo (restoring the previous state) keeps the frozen values', async () => {
    const store = await import('../../store/store');
    const actions = await import('../../store/actions');
    store.commit(onWednesday({ plannedMeals: meals() }));
    const before = store.snapshot();
    actions.applyChange({ type: 'skipWorkout', slotId: planSlotId(MON, 3) });
    store.restore(before);
    expect(store.getState().closedDayTargets[TUE]).toBe(2600);
    expect(kcal(store.getState(), TUE)).toBe(2600);
  });
});

describe('frozen days with 6 and 7 training days', () => {
  it.each([
    [6, [0, 1, 2, 3, 4, 5]],
    [7, [0, 1, 2, 3, 4, 5, 6]],
  ])('%i days: open days carry the difference within ±375 kcal and above the floor', (_, weekdays) => {
    const s = onWednesday({ training: { programId: 'full-body', weekdays } });
    const frozen = { mon: kcal(s, MON), tue: kcal(s, TUE) };
    for (const slot of [5, 4, 3]) {
      const r = applyWeekChange(s, { type: 'skipWorkout', slotId: planSlotId(MON, slot) }, WED_MORNING);
      if (!r.ok) continue;
      expect(kcal(r.state, MON)).toBe(frozen.mon);
      expect(kcal(r.state, TUE)).toBe(frozen.tue);
      for (const d of WEEK) {
        expect(Math.abs(kcal(r.state, d) - 2800)).toBeLessThanOrEqual(MAX_DAY_SHIFT);
        expect(kcal(r.state, d)).toBeGreaterThan(1900);
      }
    }
  });

  it('extreme history is bounded: open days never leave ±375 kcal', () => {
    // Pretend the closed days were frozen very high – open days cannot drop below 2800 − 375.
    const s = { ...onWednesday(), closedDayTargets: { [MON]: 3400, [TUE]: 3400 } };
    for (const d of WEEK.filter((x) => x >= WED)) expect(kcal(s, d)).toBeGreaterThanOrEqual(2800 - MAX_DAY_SHIFT);
  });
});
