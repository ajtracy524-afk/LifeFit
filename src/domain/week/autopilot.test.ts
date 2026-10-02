import { describe, expect, it } from 'vitest';
import { getRecipe } from '../../data/recipes';
import { emptyState, loadState, migrateV1 } from '../../store/persistence';
import { weekDays } from '../dates';
import { plannedMealMacros } from '../nutrition';
import { effectivePrepMin } from '../planner';
import { activeWorkouts, estimateMinutes, planSlotId, scheduleForWeek } from '../training';
import type { AppState, DayContext, PlannedMeal } from '../types';
import { applyWeekChange, type CascadeResult, type WeekChange } from './cascade';
import { dayTargetFor } from './dayTargets';
import { pantryEstimate } from './pantry';
import { buildWeekPlan, weekShopping } from './weekPlan';

/**
 * F1 – weekly autopilot. The check-in produces ONE cascade change (planWeek);
 * training, meals, targets and shopping are derived from the week plan.
 */

const MON = '2026-09-21';
const NEXT = '2026-09-28';
const NOW = new Date(2026, 8, 21, 8, 0);
const TUE = '2026-09-22';
const WED = '2026-09-23';
const THU = '2026-09-24';
const FRI = '2026-09-25';
const SAT = '2026-09-26';

function state(patch: Partial<AppState> = {}): AppState {
  return {
    ...emptyState(),
    profile: { name: 'T', sex: 'male', age: 30, heightCm: 180, activity: 'moderate', experience: 'beginner', createdAt: '2026-09-01T08:00:00Z' },
    goal: { type: 'muscle_gain', startWeightKg: 80, startedAt: '2026-09-01' },
    nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['breakfast', 'lunch', 'dinner'] },
    targets: [{ id: 't', validFrom: '2026-09-01', method: 'formula', kcal: 2700, protein: 160, carbs: 320, fat: 80 }],
    training: { programId: 'full-body', weekdays: [0, 2, 4] },
    weights: [{ id: 'w', date: '2026-09-01', kg: 80 }],
    ...patch,
  };
}

const ctx = (timeBudget: DayContext['timeBudget'] = 'normal', mode: DayContext['mode'] = 'normal'): DayContext => ({ timeBudget, mode });
const allNormal = (week: string) => Object.fromEntries(weekDays(week).map((d) => [d, ctx()]));
const plan = (_s: AppState, trainingDays: number[], days: Record<string, DayContext> = allNormal(MON), week = MON): WeekChange => ({ type: 'planWeek', week, trainingDays, days });

function ok(r: CascadeResult) {
  if (!r.ok) throw new Error(r.reason);
  return r;
}
const meals = (s: AppState, date: string) => s.plannedMeals.filter((m) => m.date === date && m.status !== 'skipped');
const shape = (s: AppState) => s.plannedMeals.map((m) => [m.date, m.slot, m.recipeId, m.servings, m.status]);

describe('F1 · check-in → week plan', () => {
  it('uses the chosen training days for this week only – rotation from scheduleForWeek', () => {
    const r = ok(applyWeekChange(state(), plan(state(), [1, 3, 5]), NOW));
    const sessions = activeWorkouts(r.state.training, r.state.workoutOverrides, [], MON);
    expect(sessions.map((w) => w.date)).toEqual([TUE, THU, SAT]);
    expect(sessions.map((w) => w.template.id)).toEqual(scheduleForWeek({ programId: 'full-body', weekdays: [1, 3, 5] }, MON).map((w) => w.template.id));
    // Next week keeps the default days.
    expect(activeWorkouts(r.state.training, {}, [], NEXT).map((w) => w.date)).toEqual(scheduleForWeek(state().training, NEXT).map((w) => w.date));
    expect(r.state.training!.weekdays).toEqual([0, 2, 4]);
  });

  it('stores time budgets and exceptions in dayContexts', () => {
    const days = { ...allNormal(MON), [WED]: ctx('low'), [THU]: ctx('normal', 'eating_out'), [SAT]: ctx('high') };
    const r = ok(applyWeekChange(state(), plan(state(), [0, 2, 4], days), NOW));
    expect(r.state.dayContexts).toEqual({ [WED]: ctx('low'), [THU]: ctx('normal', 'eating_out'), [SAT]: ctx('high') });
  });

  it('creates training, meals and shopping from the same plan', () => {
    const r = ok(applyWeekChange(state(), plan(state(), [1, 3, 5]), NOW));
    const week = buildWeekPlan(r.state, MON, MON);
    expect(week.days.filter((d) => d.isTrainingDay).map((d) => d.date)).toEqual([TUE, THU, SAT]);
    for (const d of week.days) expect(d.meals.filter((m) => m.status === 'planned')).toHaveLength(3);
    expect(week.shopping.filter((i) => i.state === 'open').length).toBeGreaterThan(5);
    // Day targets follow the chosen days (+150 on training days).
    expect(dayTargetFor(r.state, TUE)!.kcal).toBe(2850);
    expect(r.summary.title).toBe('Woche geplant');
    expect(r.summary.details[0]).toBe('3 Trainings · 21 Mahlzeiten geplant');
  });

  it('is deterministic: same inputs → same week', () => {
    const a = ok(applyWeekChange(state(), plan(state(), [1, 3, 5]), NOW)).state;
    const b = ok(applyWeekChange(state(), plan(state(), [1, 3, 5]), NOW)).state;
    expect(shape(a)).toEqual(shape(b));
  });

  it('keeps meals the user chose, eaten meals and past days', () => {
    const own: PlannedMeal = { id: 'own', date: WED, slot: 'lunch', recipeId: 'bolognese', servings: 1.2, status: 'planned', source: 'user' };
    const past: PlannedMeal = { id: 'past', date: '2026-09-20', slot: 'dinner', recipeId: 'chili', servings: 1, status: 'eaten', source: 'suggest' };
    const r = ok(applyWeekChange(state({ plannedMeals: [own, past] }), plan(state(), [1, 3, 5]), new Date(2026, 8, 21, 8)));
    expect(r.state.plannedMeals).toContainEqual(own);
    expect(r.state.plannedMeals).toContainEqual(past);
    expect(meals(r.state, WED).filter((m) => m.slot === 'lunch')).toEqual([own]);
  });

  it('replaces only planner suggestions when re-running the check-in', () => {
    const first = ok(applyWeekChange(state(), plan(state(), [0, 2, 4]), NOW)).state;
    const second = ok(applyWeekChange(first, plan(first, [1, 3, 5]), NOW)).state;
    expect(second.plannedMeals.filter((m) => m.status === 'planned')).toHaveLength(21);
    expect(activeWorkouts(second.training, second.workoutOverrides, [], MON).map((w) => w.date)).toEqual([TUE, THU, SAT]);
  });

  it('in the current week past training days stay as they were', () => {
    const wed = new Date(2026, 8, 23, 8); // Wednesday – Monday already happened
    const r = ok(applyWeekChange(state(), plan(state(), [3, 5]), wed));
    expect(activeWorkouts(r.state.training, {}, [], MON).map((w) => w.date)).toEqual([MON, THU, SAT]);
    expect(r.state.plannedMeals.every((m) => m.date >= WED)).toBe(true);
  });

  it('uses the pantry – and stays with F3/F5 rules', () => {
    const s = state({ pantry: { salmon: { foodId: 'salmon', quantityG: 500, updatedAt: '2026-09-20T10:00:00Z' } } });
    const withPantry = ok(applyWeekChange(s, plan(s, [1, 3, 5]), NOW)).state;
    const salmonMeals = (st: AppState) => st.plannedMeals.filter((m) => getRecipe(m.recipeId)!.ingredients.some((i) => i.foodId === 'salmon')).length;
    expect(salmonMeals(withPantry)).toBeGreaterThanOrEqual(salmonMeals(ok(applyWeekChange(state(), plan(state(), [1, 3, 5]), NOW)).state));
    expect(salmonMeals(withPantry)).toBeGreaterThan(0);
    // F5: the low day gets quick meals and a short session.
    const low = ok(applyWeekChange(s, plan(s, [1, 3, 5], { ...allNormal(MON), [THU]: ctx('low') }), NOW)).state;
    const cooked = new Map<string, string[]>();
    low.plannedMeals.forEach((m) => cooked.set(m.recipeId, [...(cooked.get(m.recipeId) ?? []), m.date]));
    for (const m of meals(low, THU)) expect(effectivePrepMin(getRecipe(m.recipeId)!, THU, cooked, false)).toBeLessThanOrEqual(20);
    const thuSession = activeWorkouts(low.training, low.workoutOverrides, [], MON, low.dayContexts).find((w) => w.date === THU)!;
    expect(estimateMinutes(thuSession.template)).toBeLessThanOrEqual(30);
  });

  it('fails safely without touching the week', () => {
    const s = state({ nutritionProfile: null });
    const r = applyWeekChange(s, plan(s, [1, 3, 5]), NOW);
    expect(r.ok).toBe(false);
  });
});

describe('F1 · exception days', () => {
  it('Auswärts: no dinner planned, its ingredients leave the shopping list, target stays', () => {
    const base = ok(applyWeekChange(state(), plan(state(), [1, 3, 5]), NOW)).state;
    const out = ok(applyWeekChange(state(), plan(state(), [1, 3, 5], { ...allNormal(MON), [WED]: ctx('normal', 'eating_out') }), NOW)).state;
    expect(meals(out, WED).map((m) => m.slot).sort()).toEqual(['breakfast', 'lunch']);
    expect(dayTargetFor(out, WED)!.kcal).toBe(dayTargetFor(base, WED)!.kcal);
    // Planning a different week re-rolls the other days, so the whole list is no measure –
    // what Wednesday needs is: no dinner ingredients any more, less in total.
    const fromWed = (st: AppState) => weekShopping(st, MON, MON).flatMap((i) => i.sources.filter((src) => src.date === WED));
    expect(fromWed(out).some((src) => src.slot === 'dinner')).toBe(false);
    expect(fromWed(out).reduce((sum, src) => sum + src.grams, 0)).toBeLessThan(fromWed(base).reduce((sum, src) => sum + src.grams, 0));
    // Training is not moved because of it.
    expect(activeWorkouts(out.training, out.workoutOverrides, [], MON).map((w) => w.date)).toEqual([TUE, THU, SAT]);
  });

  it('Wenig Zeit (formerly "Busy"): quick meals, short training', () => {
    const r = ok(applyWeekChange(state(), plan(state(), [1, 3, 5], { ...allNormal(MON), [THU]: ctx('low') }), NOW)).state;
    expect(meals(r, THU).every((m) => getRecipe(m.recipeId)!.prepMin <= 20 || m.recipeId === 'chili')).toBe(true);
    const session = activeWorkouts(r.training, r.workoutOverrides, [], MON, r.dayContexts).find((w) => w.date === THU)!;
    expect(session.template.name).toMatch(/\(kurz\)$/);
  });

  it('Wenig Zeit on a weekend (formerly "Reise"): simple quick meals, training shortened but kept', () => {
    const r = ok(applyWeekChange(state(), plan(state(), [1, 3, 5], { ...allNormal(MON), [SAT]: ctx('low') }), NOW)).state;
    const cooked = new Map<string, string[]>();
    r.plannedMeals.forEach((m) => cooked.set(m.recipeId, [...(cooked.get(m.recipeId) ?? []), m.date]));
    expect(meals(r, SAT).filter((m) => effectivePrepMin(getRecipe(m.recipeId)!, SAT, cooked, false) > 15).length).toBeLessThanOrEqual(1);
    const session = activeWorkouts(r.training, r.workoutOverrides, [], MON, r.dayContexts).find((w) => w.date === SAT)!;
    expect(estimateMinutes(session.template)).toBeLessThanOrEqual(30);
  });

  it('adding "Auswärts" later skips the dinner; removing it brings the dinner back', () => {
    const planned = ok(applyWeekChange(state(), plan(state(), [1, 3, 5]), NOW)).state;
    const dinner = meals(planned, FRI).find((m) => m.slot === 'dinner')!;
    const out = ok(applyWeekChange(planned, { type: 'setDayContext', date: FRI, context: { mode: 'eating_out' } }, NOW));
    expect(out.state.plannedMeals.find((m) => m.id === dinner.id)!.status).toBe('skipped');
    expect(out.summary.title).toBe('Freitag: Auswärts');
    expect(out.summary.shopping.removed.length + out.summary.shopping.changed.length).toBeGreaterThan(0);
    const back = ok(applyWeekChange(out.state, { type: 'setDayContext', date: FRI, context: { mode: 'normal' } }, NOW));
    expect(back.state.plannedMeals.find((m) => m.id === dinner.id)!.status).toBe('planned');
    expect(back.summary.details.join(' ')).toMatch(/Abendessen wieder eingeplant/);
  });
});

describe('F1 · re-planning after the check-in (cascade) and undo', () => {
  const planned = () => ok(applyWeekChange(state(), plan(state(), [1, 3, 5]), NOW)).state;

  it('move, skip, time budget and pantry changes work on the planned week', () => {
    const s = planned();
    const thuSlot = planSlotId(MON, 1);
    const moved = ok(applyWeekChange(s, { type: 'moveWorkout', slotId: thuSlot, toDate: FRI }, NOW));
    expect(moved.summary.targetChanges.map((t) => t.date).sort()).toEqual([THU, FRI]);
    expect(moved.summary.rebalanced.length).toBeGreaterThan(0);

    const skipped = ok(applyWeekChange(s, { type: 'skipWorkout', slotId: thuSlot }, NOW));
    expect(activeWorkouts(skipped.state.training, skipped.state.workoutOverrides, [], MON).map((w) => w.date)).toEqual([TUE, SAT]);

    const low = ok(applyWeekChange(s, { type: 'setDayContext', date: SAT, context: { timeBudget: 'low' } }, NOW));
    expect(low.summary.details.some((d) => d.startsWith('Training: '))).toBe(true);

    const food = weekShopping(s, MON, MON).find((i) => i.state === 'open')!;
    const pantry = ok(applyWeekChange(s, { type: 'setPantry', foodId: food.foodId, quantityG: 5000 }, NOW));
    expect(weekShopping(pantry.state, MON, MON).find((i) => i.foodId === food.foodId)!.state).toBe('have');
    expect(pantryEstimate(pantry.state)[food.foodId]).toBe(5000);
  });

  it('every change leaves the previous state untouched (undo = restore snapshot)', () => {
    const s = planned();
    const copy = structuredClone(s);
    const changes: WeekChange[] = [
      plan(s, [0, 6]),
      { type: 'moveWorkout', slotId: planSlotId(MON, 1), toDate: FRI },
      { type: 'skipWorkout', slotId: planSlotId(MON, 2) },
      { type: 'setDayContext', date: THU, context: { timeBudget: 'low' } },
      { type: 'setDayContext', date: WED, context: { mode: 'eating_out' } },
      { type: 'setPantry', foodId: 'rice', quantityG: 800 },
      { type: 'purchase', week: MON, foodId: 'rice' },
    ];
    for (const c of changes) {
      ok(applyWeekChange(s, c, NOW));
      expect(s).toEqual(copy);
    }
  });

  it('planning the next week counts the pantry rest of this week', () => {
    let s = planned();
    s = ok(applyWeekChange(s, { type: 'setPantry', foodId: 'salmon', quantityG: 1000 }, NOW)).state;
    const next = ok(applyWeekChange(s, plan(s, [1, 3, 5], allNormal(NEXT), NEXT), NOW)).state;
    const shopping = weekShopping(next, NEXT, MON);
    const salmon = shopping.find((i) => i.foodId === 'salmon');
    if (salmon) expect(salmon.remainingG).toBeLessThan(salmon.neededG + 1);
    expect(next.plannedMeals.filter((m) => m.date >= NEXT && m.status === 'planned')).toHaveLength(21);
  });
});

describe('F1 · persistence', () => {
  it('a v2 state without week overrides loads unchanged and keeps working', () => {
    const v2 = state();
    localStorageMock({ 'lifefit:v1': JSON.stringify(v2) });
    const loaded = loadState().state;
    expect(loaded.training).toEqual(v2.training);
    expect(activeWorkouts(loaded.training, {}, [], MON).map((w) => w.date)).toEqual([MON, WED, FRI]);
  });

  it('v1 migration still works and invents no pantry', () => {
    const v1 = { ...state(), schemaVersion: 1, shopping: { '2026-09-14': { status: { rice: 'checked' }, manual: [] } } } as unknown as Record<string, unknown>;
    const s = migrateV1(v1, NOW);
    expect(s.pantry).toEqual({});
    expect(s.training).toEqual(state().training);
  });
});

function localStorageMock(data: Record<string, string>) {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => void (data[k] = v),
    removeItem: (k: string) => void delete data[k],
  };
}

describe('F1 · eating out and day-target changes', () => {
  it('moving training onto an eating-out day only scales the planned meals by their share', () => {
    const s = ok(applyWeekChange(state(), plan(state(), [1, 3, 5], { ...allNormal(MON), [FRI]: ctx('normal', 'eating_out') }), NOW)).state;
    const kcal = (st: AppState) => st.plannedMeals.filter((m) => m.date === FRI && m.status === 'planned').reduce((sum, m) => sum + plannedMealMacros(m).kcal, 0);
    const moved = ok(applyWeekChange(s, { type: 'moveWorkout', slotId: planSlotId(MON, 2), toDate: FRI }, NOW));
    const delta = moved.summary.targetChanges.find((t) => t.date === FRI)!;
    // Dinner (28 % of 3 meals incl. dinner → 0.28/0.85) stays with the restaurant.
    const expected = (delta.toKcal - delta.fromKcal) * (1 - 0.28 / 0.85);
    expect(Math.abs(kcal(moved.state) - kcal(s) - expected)).toBeLessThan(120);
  });
});
