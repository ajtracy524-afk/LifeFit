import { describe, expect, it } from 'vitest';
import { getRecipe } from '../../data/recipes';
import { emptyState } from '../../store/persistence';
import { weekDays } from '../dates';
import { logFromMeal, plannedMealMacros, sumMacros } from '../nutrition';
import { effectivePrepMin, seededRandom, suggestWeek } from '../planner';
import { activeWorkouts, estimateMinutes, planSlotId, resolveWorkouts } from '../training';
import type { AppState, DayContext, PlannedMeal, Workout } from '../types';
import { applyWeekChange, type CascadeResult, type WeekChange } from './cascade';
import { dayTargetFor } from './dayTargets';
import { pantryEstimate } from './pantry';
import { weekShopping } from './weekPlan';

/**
 * Hardening of the weekly cascade: eating out, training bonus, the lived week,
 * re-planning boundaries and pantry corrections.
 */

const MON = '2026-09-21';
const TUE = '2026-09-22';
const WED = '2026-09-23';
const THU = '2026-09-24';
const FRI = '2026-09-25';
const SAT = '2026-09-26';
const WEEK = weekDays(MON);
const NOW = new Date(2026, 8, 21, 8, 0); // Monday morning

let seq = 0;
const meal = (date: string, slot: PlannedMeal['slot'], recipeId: string, patch: Partial<PlannedMeal> = {}): PlannedMeal => ({
  id: `h${++seq}`,
  date,
  slot,
  recipeId,
  servings: 1,
  status: 'planned',
  source: 'suggest',
  ...patch,
});

function state(patch: Partial<AppState> = {}): AppState {
  return {
    ...emptyState(),
    profile: { name: 'T', sex: 'male', age: 30, heightCm: 180, activity: 'moderate', experience: 'beginner', createdAt: '2026-09-01T08:00:00Z' },
    goal: { type: 'muscle_gain', startWeightKg: 80, startedAt: '2026-09-01' },
    nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['breakfast', 'lunch', 'dinner'] },
    targets: [{ id: 't', validFrom: '2026-09-01', method: 'formula', kcal: 2800, protein: 160, carbs: 330, fat: 80 }],
    training: { programId: 'full-body', weekdays: [0, 2, 4] },
    weights: [{ id: 'w', date: '2026-09-01', kg: 80 }],
    ...patch,
  };
}

function ok(r: CascadeResult) {
  if (!r.ok) throw new Error(r.reason);
  return r;
}
const ctx = (timeBudget: DayContext['timeBudget'] = 'normal', mode: DayContext['mode'] = 'normal'): DayContext => ({ timeBudget, mode });
const allNormal = () => Object.fromEntries(WEEK.map((d) => [d, ctx()]));
const planWeek = (trainingDays: number[], days: Record<string, DayContext> = allNormal()): WeekChange => ({ type: 'planWeek', week: MON, trainingDays, days });
const need = (s: AppState, foodId: string, today = MON) => weekShopping(s, MON, today).find((i) => i.foodId === foodId);
const servingsOf = (s: AppState, date: string) => s.plannedMeals.filter((m) => m.date === date).map((m) => [m.slot, m.servings, m.status]);
const done = (id: string, date: string, plannedId?: string): Workout => ({
  id,
  date,
  templateId: 'fb-a',
  name: 'Ganzkörper A',
  startedAt: `${date}T18:00:00Z`,
  status: 'completed',
  exercises: [],
  plannedId,
});

// ---------------------------------------------------------------------------

describe('Auswärts – portions never grow, shopping follows exactly', () => {
  // Friday: breakfast, lunch and a chicken dinner.
  const fridayMeals = () => [
    meal(FRI, 'breakfast', 'overnight-oats'),
    meal(FRI, 'lunch', 'chicken-wraps'), // 150 g chicken
    meal(FRI, 'dinner', 'chicken-rice-bowl'), // 180 g chicken
  ];

  it('normal → auswärts: the other meals keep their servings, dinner leaves the plan', () => {
    const before = state({ plannedMeals: fridayMeals() });
    const r = ok(applyWeekChange(before, { type: 'setDayContext', date: FRI, context: { mode: 'eating_out' } }, NOW));
    const kept = (s: AppState) => s.plannedMeals.filter((m) => m.date === FRI && m.slot !== 'dinner').map((m) => m.servings);
    expect(kept(r.state)).toEqual(kept(before));
    expect(r.state.plannedMeals.find((m) => m.slot === 'dinner')!.status).toBe('skipped');
    // Planned calories drop by exactly the dinner – the space stays unplanned.
    const planned = (s: AppState) => sumMacros(s.plannedMeals.filter((m) => m.date === FRI && m.status === 'planned').map(plannedMealMacros)).kcal;
    const dinner = plannedMealMacros(before.plannedMeals.find((m) => m.slot === 'dinner')!).kcal;
    expect(planned(r.state)).toBeCloseTo(planned(before) - dinner);
    expect(r.summary.rebalanced).toHaveLength(0);
    // The day target itself stays (the restaurant meal is still eaten).
    expect(dayTargetFor(r.state, FRI)!.kcal).toBe(dayTargetFor(before, FRI)!.kcal);
  });

  it('shopping: 330 g → 150 g chicken; back to normal → 330 g again, no double counting', () => {
    const s0 = state({ plannedMeals: fridayMeals() });
    expect(need(s0, 'chicken')!.neededG).toBe(330);
    const out = ok(applyWeekChange(s0, { type: 'setDayContext', date: FRI, context: { mode: 'eating_out' } }, NOW)).state;
    expect(need(out, 'chicken')!.neededG).toBe(150);
    const back = ok(applyWeekChange(out, { type: 'setDayContext', date: FRI, context: { mode: 'normal' } }, NOW));
    expect(need(back.state, 'chicken')!.neededG).toBe(330);
    expect(back.state.plannedMeals.filter((m) => m.date === FRI && m.slot === 'dinner')).toHaveLength(1);
    expect(servingsOf(back.state, FRI)).toEqual(servingsOf(s0, FRI));
  });

  it('normal → auswärts → undo: the previous state is untouched', () => {
    const s0 = state({ plannedMeals: fridayMeals() });
    const copy = structuredClone(s0);
    ok(applyWeekChange(s0, { type: 'setDayContext', date: FRI, context: { mode: 'eating_out' } }, NOW));
    expect(s0).toEqual(copy);
  });

  it('pantry + auswärts: 200 g at home → nothing to buy while eating out, 130 g again afterwards', () => {
    const s0 = state({ plannedMeals: fridayMeals(), pantry: { chicken: { foodId: 'chicken', quantityG: 200, updatedAt: '2026-09-20T10:00:00Z' } } });
    expect(need(s0, 'chicken')!.remainingG).toBe(130);
    const out = ok(applyWeekChange(s0, { type: 'setDayContext', date: FRI, context: { mode: 'eating_out' } }, NOW)).state;
    expect(need(out, 'chicken')!.state).toBe('have');
    expect(pantryEstimate(out).chicken).toBe(200);
    const back = ok(applyWeekChange(out, { type: 'setDayContext', date: FRI, context: { mode: 'normal' } }, NOW)).state;
    expect(need(back, 'chicken')!.remainingG).toBe(130);
  });

  it('auswärts + F3: ingredient overlap still works without the dinner slot', () => {
    const profile = state().nutritionProfile!;
    const target = { kcal: 2800, protein: 160, carbs: 330, fat: 80 };
    const foods = (weights?: Record<string, number>) =>
      ['1', '2', '3', '4'].reduce((sum, seed) => {
        const plan = suggestWeek({ dates: WEEK, slots: profile.slots, target, profile, existing: [], random: seededRandom(seed), excludedSlotsFor: (d) => (d === FRI ? ['dinner'] : []), weights });
        expect(plan.some((m) => m.date === FRI && m.slot === 'dinner')).toBe(false);
        return sum + new Set(plan.flatMap((m) => getRecipe(m.recipeId)!.ingredients.map((i) => i.foodId))).size;
      }, 0);
    expect(foods()).toBeLessThan(foods({ newFood: 0, packageWaste: 0 }));
  });

  it('auswärts + F5: a busy day eating out gets quick meals for the rest of the day', () => {
    const r = ok(applyWeekChange(state(), planWeek([0, 2, 4], { ...allNormal(), [THU]: ctx('low', 'eating_out') }), NOW)).state;
    const thursday = r.plannedMeals.filter((m) => m.date === THU && m.status === 'planned');
    expect(thursday.map((m) => m.slot).sort()).toEqual(['breakfast', 'lunch']);
    const cooked = new Map<string, string[]>();
    r.plannedMeals.forEach((m) => cooked.set(m.recipeId, [...(cooked.get(m.recipeId) ?? []), m.date]));
    for (const m of thursday) expect(effectivePrepMin(getRecipe(m.recipeId)!, THU, cooked, false)).toBeLessThanOrEqual(20);
  });
});

// ---------------------------------------------------------------------------

describe('training bonus: +150 kcal, weekly sum constant, max 5 bonus days', () => {
  const DAYS: Record<number, number[]> = { 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6] };
  const targets = (s: AppState) => WEEK.map((d) => dayTargetFor(s, d)!);
  const check = (s: AppState) => {
    const t = targets(s);
    expect(Math.abs(t.reduce((sum, x) => sum + x.kcal, 0) - 2800 * 7)).toBeLessThanOrEqual(5);
    expect(t.every((x) => x.protein === 160)).toBe(true);
    expect(t.every((x) => Math.abs(x.kcal - 2800) <= 375)).toBe(true);
    expect(t.filter((x) => x.kcal === 2950).length).toBeLessThanOrEqual(5);
  };

  it.each([3, 4, 5, 6, 7])('%i training days', (n) => {
    const s = state({ training: { programId: 'full-body', weekdays: DAYS[n]! } });
    check(s);
    expect(targets(s).filter((x) => x.kcal === 2950)).toHaveLength(Math.min(n, 5));
    expect(activeWorkouts(s.training, {}, [], MON)).toHaveLength(n);
  });

  it.each([3, 4, 5, 6])('%i training days: moving and skipping keep the rules; the other day is unchanged', (n) => {
    const s = state({ training: { programId: 'full-body', weekdays: DAYS[n]! } });
    const sessions = activeWorkouts(s.training, {}, [], MON);
    const free = WEEK.find((d) => d > MON && !sessions.some((w) => w.date === d));
    const last = sessions[sessions.length - 1]!;
    if (free) {
      const moved = ok(applyWeekChange(s, { type: 'moveWorkout', slotId: last.id, toDate: free }, NOW));
      check(moved.state);
      for (const t of moved.summary.targetChanges) expect([last.date, free]).toContain(t.date);
    }
    const skipped = ok(applyWeekChange(s, { type: 'skipWorkout', slotId: last.id }, NOW));
    check(skipped.state);
  });

  it('the bonus goes to the day target, the servings follow proportionally – not the whole day twice', () => {
    const s = state({ plannedMeals: [meal(TUE, 'breakfast', 'overnight-oats'), meal(TUE, 'lunch', 'chicken-wraps'), meal(TUE, 'dinner', 'bolognese')] });
    const kcal = (st: AppState) => sumMacros(st.plannedMeals.filter((m) => m.date === TUE).map(plannedMealMacros)).kcal;
    const moved = ok(applyWeekChange(s, { type: 'moveWorkout', slotId: planSlotId(MON, 1), toDate: TUE }, NOW));
    const delta = moved.summary.targetChanges.find((t) => t.date === TUE)!;
    expect(Math.abs(kcal(moved.state) - kcal(s) - (delta.toKcal - delta.fromKcal))).toBeLessThan(150);
  });

  it('time budget changes training length but never the calorie target', () => {
    const s = state();
    const low = ok(applyWeekChange(s, { type: 'setDayContext', date: WED, context: { timeBudget: 'low' } }, NOW)).state;
    expect(WEEK.map((d) => dayTargetFor(low, d)!.kcal)).toEqual(WEEK.map((d) => dayTargetFor(s, d)!.kcal));
    const wed = activeWorkouts(low.training, low.workoutOverrides, [], MON, low.dayContexts).find((w) => w.date === WED)!;
    expect(estimateMinutes(wed.template)).toBeLessThanOrEqual(30);
  });

  it('undo after move/skip = untouched previous state', () => {
    const s = state({ plannedMeals: [meal(WED, 'lunch', 'bolognese')] });
    const copy = structuredClone(s);
    ok(applyWeekChange(s, { type: 'moveWorkout', slotId: planSlotId(MON, 1), toDate: THU }, NOW));
    ok(applyWeekChange(s, { type: 'skipWorkout', slotId: planSlotId(MON, 1) }, NOW));
    expect(s).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------

describe('the lived week is never rewritten', () => {
  const WED_MORNING = new Date(2026, 8, 23, 8, 0);

  it('a check-in on Wednesday keeps past sessions, their templates and missed sessions', () => {
    // 4 templates, so a changed day count would visibly shift the rotation.
    const s = state({ training: { programId: 'upper-lower', weekdays: [0, 2, 4] }, workouts: [done('w-mon', MON, planSlotId(MON, 0))] });
    const before = resolveWorkouts(s.training, {}, s.workouts, MON);
    // Wednesday: choose Thu + Fri + Sat → 4 days incl. Monday (count changes 3 → 4).
    const r = ok(applyWeekChange(s, planWeek([3, 4, 5]), WED_MORNING)).state;
    const after = resolveWorkouts(r.training, r.workoutOverrides, r.workouts, MON);
    const mon = (list: typeof before) => list.find((w) => w.date === MON)!;
    expect(mon(after).template.id).toBe(mon(before).template.id);
    expect(mon(after).completedWorkoutId).toBe('w-mon');
    expect(after.map((w) => w.date)).toEqual([MON, THU, FRI, SAT]);
  });

  it('a past session that was missed stays in the past (not moved, not re-planned)', () => {
    const s = state(); // Monday session not done
    const r = ok(applyWeekChange(s, planWeek([4]), WED_MORNING)).state;
    const mon = resolveWorkouts(r.training, r.workoutOverrides, r.workouts, MON).find((w) => w.originalDate === MON)!;
    expect(mon.status).toBe('scheduled');
    expect(mon.date).toBe(MON);
    expect(mon.completedWorkoutId).toBeUndefined();
  });

  it('today with a completed session stays a training day even if deselected', () => {
    const s = state({ workouts: [done('w-wed', WED, planSlotId(MON, 1))] });
    const r = ok(applyWeekChange(s, planWeek([4]), new Date(2026, 8, 23, 19, 0))).state;
    const wed = resolveWorkouts(r.training, r.workoutOverrides, r.workouts, MON).find((w) => w.date === WED)!;
    expect(wed.completedWorkoutId).toBe('w-wed');
  });

  it('past days cannot get a new context and sessions cannot be moved into the past', () => {
    expect(applyWeekChange(state(), { type: 'setDayContext', date: MON, context: { timeBudget: 'low' } }, WED_MORNING).ok).toBe(false);
    expect(applyWeekChange(state(), { type: 'moveWorkout', slotId: planSlotId(MON, 2), toDate: TUE }, WED_MORNING).ok).toBe(false);
  });

  it('a completed session can be neither moved nor skipped', () => {
    const s = state({ workouts: [done('w-mon', MON, planSlotId(MON, 0))] });
    expect(applyWeekChange(s, { type: 'moveWorkout', slotId: planSlotId(MON, 0), toDate: TUE }, NOW).ok).toBe(false);
    expect(applyWeekChange(s, { type: 'skipWorkout', slotId: planSlotId(MON, 0) }, NOW).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('week re-planning only touches future planner meals', () => {
  const WED_NOON = new Date(2026, 8, 23, 12, 0);
  const fixture = () => ({
    pastPlanned: meal(MON, 'lunch', 'chili'), // past, never eaten
    pastEaten: meal(TUE, 'lunch', 'bolognese', { status: 'eaten' }),
    todayEaten: meal(WED, 'breakfast', 'overnight-oats', { status: 'eaten' }),
    todaySuggest: meal(WED, 'dinner', 'oven-salmon'),
    own: meal(THU, 'lunch', 'tuna-pasta-salad', { source: 'user' }),
    sized: meal(FRI, 'dinner', 'chili', { servingsLocked: true }),
    swapped: meal(FRI, 'lunch', 'chicken-wraps', { source: 'swap' }),
    futureSuggest: meal(SAT, 'dinner', 'bolognese'),
  });

  it('keeps past, eaten, own, sized and swapped meals – replaces only future suggestions', () => {
    const f = fixture();
    const s = state({ plannedMeals: Object.values(f) });
    const r = ok(applyWeekChange(s, planWeek([2, 4]), WED_NOON)).state;
    for (const keep of [f.pastPlanned, f.pastEaten, f.todayEaten, f.own, f.sized, f.swapped]) expect(r.plannedMeals).toContainEqual(keep);
    expect(r.plannedMeals.some((m) => m.id === f.todaySuggest.id)).toBe(false);
    expect(r.plannedMeals.some((m) => m.id === f.futureSuggest.id)).toBe(false);
    // Nothing new is planned before today.
    const newIds = new Set(r.plannedMeals.map((m) => m.id));
    for (const m of r.plannedMeals.filter((x) => !Object.values(f).some((o) => o.id === x.id))) {
      expect(m.date >= WED).toBe(true);
      expect(newIds.has(m.id)).toBe(true);
    }
  });

  it('a fully future week is planned completely', () => {
    const r = ok(applyWeekChange(state(), planWeek([1, 3, 5]), new Date(2026, 8, 20, 12, 0))).state;
    expect(r.plannedMeals.filter((m) => m.status === 'planned')).toHaveLength(21);
  });

  it('re-running the check-in does not duplicate meals', () => {
    const first = ok(applyWeekChange(state(), planWeek([1, 3, 5]), NOW)).state;
    const second = ok(applyWeekChange(first, planWeek([1, 3, 5]), NOW)).state;
    for (const d of WEEK) for (const slot of ['breakfast', 'lunch', 'dinner']) {
      expect(second.plannedMeals.filter((m) => m.date === d && m.slot === slot && m.status === 'planned')).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------

describe('pantry correction wins over older logs', () => {
  it('500 g, −200 g eaten = 300 g; corrected to 250 g; deleting the old log keeps 250 g', async () => {
    const store = await import('../../store/store');
    const actions = await import('../../store/actions');
    const bowl = meal(MON, 'lunch', 'chicken-rice-bowl', { servings: 200 / 180 });
    const log = logFromMeal({ ...bowl, status: 'eaten' }, '2026-09-21T12:00:00Z');
    store.commit(
      state({
        plannedMeals: [{ ...bowl, status: 'eaten' }],
        logEntries: [log],
        pantry: { chicken: { foodId: 'chicken', quantityG: 500, updatedAt: '2026-09-21T08:00:00Z' } },
      }),
    );
    expect(pantryEstimate(store.getState()).chicken).toBe(300);

    actions.applyChange({ type: 'setPantry', foodId: 'chicken', quantityG: 250 });
    expect(pantryEstimate(store.getState()).chicken).toBe(250);

    actions.removeLogEntry(log.id);
    expect(pantryEstimate(store.getState()).chicken).toBe(250);
  });

  it('logs after the correction still count', async () => {
    const store = await import('../../store/store');
    const s = state({ pantry: { chicken: { foodId: 'chicken', quantityG: 250, updatedAt: '2026-09-21T13:00:00Z' } } });
    const later = logFromMeal(meal(MON, 'dinner', 'chicken-rice-bowl', { status: 'eaten' }), '2026-09-21T19:00:00Z');
    store.commit({ ...s, logEntries: [later] });
    expect(pantryEstimate(store.getState()).chicken).toBe(70);
  });
});
