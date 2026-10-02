import { describe, expect, it } from 'vitest';
import { getRecipe } from '../../data/recipes';
import { emptyState, migrateV1 } from '../../store/persistence';
import { addDays, weekDays } from '../dates';
import { logFromMeal, plannedMealMacros } from '../nutrition';
import { effectivePrepMin, suggestWeek } from '../planner';
import { activeWorkouts, estimateMinutes, planSlotId, resolveWorkouts, scheduleForWeek, templateForDay } from '../training';
import type { AppState, PlannedMeal, Workout } from '../types';
import { applyWeekChange, type CascadeResult } from './cascade';
import { bonusKcalByDate, dayShift, dayTargetFor, MAX_BONUS_DAYS, TRAINING_DAY_KCAL } from './dayTargets';
import { pantryEstimate, purchaseAmount } from './pantry';
import { buildWeekPlan, weekShopping } from './weekPlan';
import { getFood } from '../../data/foods';

// Week of Monday 2026-09-21. Training Monday + Thursday → slot #1 is Thursday.
const MON = '2026-09-21';
const THU = '2026-09-24';
const FRI = '2026-09-25';
const NOW = new Date(2026, 8, 21, 8, 0); // Monday 08:00 local
const THU_SLOT = planSlotId(MON, 1);

let seq = 0;
const meal = (date: string, slot: PlannedMeal['slot'], recipeId = 'chicken-rice-bowl', patch: Partial<PlannedMeal> = {}): PlannedMeal => ({
  id: `m${++seq}`,
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
    nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['lunch', 'dinner'] },
    targets: [{ id: 't', validFrom: '2026-09-01', method: 'formula', kcal: 2500, protein: 160, carbs: 300, fat: 75 }],
    training: { programId: 'full-body', weekdays: [0, 3] },
    weights: [{ id: 'w', date: '2026-09-01', kg: 80 }],
    ...patch,
  };
}

function ok(result: CascadeResult) {
  if (!result.ok) throw new Error(result.reason);
  return result;
}

const logAt = (m: PlannedMeal, iso: string) => logFromMeal({ ...m, status: 'eaten' }, iso);

// ---------- Workout overrides ----------

describe('workout overrides', () => {
  it('without overrides the concrete week equals the rotation', () => {
    const s = state();
    const resolved = resolveWorkouts(s.training, {}, [], MON);
    const base = scheduleForWeek(s.training, MON);
    expect(resolved.map((w) => [w.date, w.template.id, w.status])).toEqual(base.map((b) => [b.date, b.template.id, 'scheduled']));
  });

  it('moves a session: Thursday is no training day any more, Friday is – the original day stays known', () => {
    const s = ok(applyWeekChange(state(), { type: 'moveWorkout', slotId: THU_SLOT, toDate: FRI }, NOW)).state;
    const plan = buildWeekPlan(s, MON, '2026-09-21');
    expect(plan.days.find((d) => d.date === THU)!.isTrainingDay).toBe(false);
    expect(plan.days.find((d) => d.date === FRI)!.isTrainingDay).toBe(true);
    const moved = plan.workouts.find((w) => w.id === THU_SLOT)!;
    expect(moved).toMatchObject({ status: 'moved', originalDate: THU, date: FRI });
  });

  it('skipping keeps the rotation (calendar based) and the session visible as skipped', () => {
    const before = resolveWorkouts(state().training, {}, [], MON);
    const s = ok(applyWeekChange(state(), { type: 'skipWorkout', slotId: THU_SLOT }, NOW)).state;
    const after = resolveWorkouts(s.training, s.workoutOverrides, s.workouts, MON);
    expect(after.find((w) => w.id === THU_SLOT)!.status).toBe('skipped');
    expect(activeWorkouts(s.training, s.workoutOverrides, s.workouts, MON)).toHaveLength(1);
    // Next week's rotation is untouched.
    const nextWeek = addDays(MON, 7);
    expect(resolveWorkouts(s.training, s.workoutOverrides, [], nextWeek).map((w) => w.template.id)).toEqual(
      scheduleForWeek(s.training, nextWeek).map((w) => w.template.id),
    );
    expect(before.map((w) => w.template.id)).toEqual(after.map((w) => w.template.id));
  });

  it('moving back to the original day removes the override', () => {
    const moved = ok(applyWeekChange(state(), { type: 'moveWorkout', slotId: THU_SLOT, toDate: FRI }, NOW)).state;
    const back = ok(applyWeekChange(moved, { type: 'moveWorkout', slotId: THU_SLOT, toDate: THU }, NOW)).state;
    expect(back.workoutOverrides).toEqual({});
  });

  it('rejects invalid moves', () => {
    expect(applyWeekChange(state(), { type: 'moveWorkout', slotId: THU_SLOT, toDate: MON }, NOW).ok).toBe(false); // Monday has training
    expect(applyWeekChange(state(), { type: 'moveWorkout', slotId: THU_SLOT, toDate: addDays(MON, 8) }, NOW).ok).toBe(false); // other week
    expect(applyWeekChange(state(), { type: 'moveWorkout', slotId: THU_SLOT, toDate: FRI }, new Date(2026, 8, 26)).ok).toBe(false); // past
    expect(applyWeekChange(state(), { type: 'skipWorkout', slotId: 'nope#9' }, NOW).ok).toBe(false);
  });

  it('a workout with plannedId completes its session on the new day; old workouts match by date', () => {
    const s = ok(applyWeekChange(state(), { type: 'moveWorkout', slotId: THU_SLOT, toDate: FRI }, NOW)).state;
    const done = (id: string, date: string, plannedId?: string): Workout => ({
      id, date, templateId: 'fb-b', name: 'B', startedAt: `${date}T18:00:00Z`, status: 'completed', exercises: [], plannedId,
    });
    const linked = resolveWorkouts(s.training, s.workoutOverrides, [done('w1', FRI, THU_SLOT)], MON);
    expect(linked.find((w) => w.id === THU_SLOT)!.completedWorkoutId).toBe('w1');
    const legacy = resolveWorkouts(s.training, {}, [done('w2', MON)], MON);
    expect(legacy.find((w) => w.date === MON)!.completedWorkoutId).toBe('w2');
  });
});

// ---------- Day targets ----------

describe('day targets', () => {
  it('training days get +150 kcal, rest days less – the weekly sum stays the same', () => {
    const s = state();
    const days = weekDays(MON).map((d) => dayTargetFor(s, d)!.kcal);
    expect(dayTargetFor(s, MON)!.kcal).toBe(2500 + TRAINING_DAY_KCAL);
    expect(dayTargetFor(s, '2026-09-22')!.kcal).toBe(2500 + dayShift(false, 2));
    expect(Math.abs(days.reduce((a, b) => a + b, 0) - 2500 * 7)).toBeLessThanOrEqual(5);
    expect(dayTargetFor(s, MON)!.protein).toBe(160);
  });

  it('rest days never drop below the calorie floor', () => {
    const low = state({ targets: [{ id: 't', validFrom: '2026-09-01', method: 'manual', kcal: 1960, protein: 150, carbs: 180, fat: 60 }], training: { programId: 'full-body', weekdays: [0, 1, 2, 3, 4, 5] } });
    // Floor for this profile ≈ 1958 kcal (BMR × 1.1).
    expect(dayTargetFor(low, '2026-09-27')!.kcal).toBeGreaterThanOrEqual(1958);
  });

  it('the planner uses day targets', () => {
    const s = state();
    const plan = suggestWeek({
      dates: [MON, '2026-09-22'],
      slots: ['lunch', 'dinner'],
      target: s.targets[0]!,
      targetFor: (d) => dayTargetFor(s, d),
      profile: s.nutritionProfile,
      existing: [],
      random: () => 0.3,
    });
    const kcal = (d: string) => plan.filter((m) => m.date === d).reduce((sum, m) => sum + plannedMealMacros(m).kcal, 0);
    expect(kcal(MON)).toBeGreaterThan(kcal('2026-09-22'));
  });
});

// ---------- Pantry ----------

describe('pantry', () => {
  const lunch = meal(MON, 'lunch', 'chicken-rice-bowl');

  it('buying credits whole packages', () => {
    const s = ok(applyWeekChange(state({ plannedMeals: [lunch] }), { type: 'purchase', week: MON, foodId: 'chicken' }, NOW)).state;
    // The bowl needs 180 g chicken, sold in 400 g packs.
    expect(pantryEstimate(s).chicken).toBe(400);
    expect(s.shopping[MON]!.purchased.chicken).toBe(400);
    expect(purchaseAmount(getFood('egg')!, 180)).toBe(600); // a pack of eggs, not 3 single eggs
  });

  it('ticking off piece goods marks them as bought even if the need is slightly above whole pieces', () => {
    // 370 g banana = "3 Stück" on the list; buying 3 pieces (360 g) must close the item.
    const bananaGrams = getRecipe('pb-porridge')!.ingredients.find((i) => i.foodId === 'banana')!.grams;
    const s0 = state({ plannedMeals: [meal(FRI, 'lunch', 'pb-porridge', { servings: 370 / bananaGrams })] });
    const s = ok(applyWeekChange(s0, { type: 'purchase', week: MON, foodId: 'banana' }, NOW)).state;
    expect(pantryEstimate(s).banana).toBe(360);
    expect(weekShopping(s, MON, MON).find((i) => i.foodId === 'banana')!.state).toBe('checked');
  });

  it('eating reduces the pantry, undoing it restores it', () => {
    const bought = ok(applyWeekChange(state({ plannedMeals: [lunch] }), { type: 'purchase', week: MON, foodId: 'chicken' }, NOW)).state;
    const eaten = { ...bought, logEntries: [logAt(lunch, '2026-09-21T12:00:00Z')] };
    expect(pantryEstimate(eaten).chicken).toBe(400 - 180);
    expect(pantryEstimate({ ...eaten, logEntries: [] }).chicken).toBe(400);
  });

  it('a correction sets a new amount; "leer" removes it', () => {
    let s = ok(applyWeekChange(state(), { type: 'setPantry', foodId: 'quark', quantityG: 250 }, NOW)).state;
    expect(pantryEstimate(s).quark).toBe(250);
    s = ok(applyWeekChange(s, { type: 'setPantry', foodId: 'quark', quantityG: null }, NOW)).state;
    expect(pantryEstimate(s).quark).toBeUndefined();
  });

  it('enough pantry → nothing to buy; the rest stays for next week', () => {
    // 500 g quark bought last week, 300 g eaten → 200 g left.
    const last = meal('2026-09-15', 'lunch', 'quark-berries');
    const quarkPerServing = getRecipe('quark-berries')!.ingredients.find((i) => i.foodId === 'quark')!.grams;
    const s = state({
      pantry: { quark: { foodId: 'quark', quantityG: 500, updatedAt: '2026-09-14T10:00:00Z' } },
      logEntries: [logAt({ ...last, servings: 300 / quarkPerServing }, '2026-09-15T12:00:00Z')],
      plannedMeals: [meal(MON, 'lunch', 'quark-berries', { servings: 200 / quarkPerServing })],
      // Pure pantry behaviour – the F8 minimum stock of quark is covered in restock.test.ts.
      shopping: { [MON]: { purchased: {}, manual: [], restockSkipped: ['quark'] } },
    });
    expect(pantryEstimate(s).quark).toBe(200);
    const item = weekShopping(s, MON, MON).find((i) => i.foodId === 'quark')!;
    expect(item.state).toBe('have');
    expect(item.remainingG).toBe(0);
  });
});

// ---------- Cascade ----------

describe('cascade', () => {
  const week = () => [
    meal(THU, 'lunch'),
    meal(THU, 'dinner', 'bolognese'),
    meal(FRI, 'lunch'),
    meal(FRI, 'dinner', 'bolognese'),
  ];

  it('moving a workout updates day targets and servings of both days', () => {
    const before = state({ plannedMeals: week() });
    const r = ok(applyWeekChange(before, { type: 'moveWorkout', slotId: THU_SLOT, toDate: FRI }, NOW));
    const thu = r.summary.targetChanges.find((t) => t.date === THU)!;
    const fri = r.summary.targetChanges.find((t) => t.date === FRI)!;
    expect(thu.toKcal).toBeLessThan(thu.fromKcal);
    expect(fri.toKcal).toBeGreaterThan(fri.fromKcal);

    const kcal = (s: AppState, d: string) => s.plannedMeals.filter((m) => m.date === d).reduce((sum, m) => sum + plannedMealMacros(m).kcal, 0);
    expect(kcal(r.state, THU)).toBeLessThan(kcal(before, THU));
    expect(kcal(r.state, FRI)).toBeGreaterThan(kcal(before, FRI));
    expect(r.summary.title).toBe('Ganzkörper – Kreuzheben & Latzug auf Freitag verschoben');
    expect(r.summary.details.join(' ')).toMatch(/Portionen angepasst/);
  });

  it('never touches locked, eaten or past meals', () => {
    const locked = meal(THU, 'lunch', 'chicken-rice-bowl', { servingsLocked: true });
    const eaten = meal(THU, 'dinner', 'bolognese', { status: 'eaten' });
    const r = ok(applyWeekChange(state({ plannedMeals: [locked, eaten] }), { type: 'moveWorkout', slotId: THU_SLOT, toDate: FRI }, NOW));
    expect(r.state.plannedMeals.map((m) => m.servings)).toEqual([1, 1]);
    expect(r.summary.rebalanced).toHaveLength(0);
  });

  it('skipping a workout keeps the weekly sum of day targets', () => {
    const r = ok(applyWeekChange(state(), { type: 'skipWorkout', slotId: THU_SLOT }, NOW));
    const sum = weekDays(MON).reduce((s, d) => s + dayTargetFor(r.state, d)!.kcal, 0);
    expect(Math.abs(sum - 2500 * 7)).toBeLessThanOrEqual(5);
  });

  it('changing a meal updates the shopping list', () => {
    const lunch = meal(FRI, 'lunch', 'chicken-rice-bowl');
    const r = ok(applyWeekChange(state({ plannedMeals: [lunch] }), { type: 'replaceMeal', mealId: lunch.id, recipeId: 'lentil-dal' }, NOW));
    expect(r.summary.shopping.removed).toContain('Hähnchenbrust');
    expect(r.summary.shopping.added).toContain('Rote Linsen');
    expect(weekShopping(r.state, MON, MON).some((i) => i.foodId === 'chicken')).toBe(false);
  });

  it('changing the pantry updates the shopping list', () => {
    const r = ok(applyWeekChange(state({ plannedMeals: [meal(FRI, 'lunch')] }), { type: 'setPantry', foodId: 'rice', quantityG: 1000 }, NOW));
    expect(r.summary.shopping.removed).toContain('Basmatireis');
    expect(weekShopping(r.state, MON, MON).find((i) => i.foodId === 'rice')!.state).toBe('have');
  });

  it('buying and then planning more reopens the item with the extra amount only', () => {
    let s = state({ plannedMeals: [meal(THU, 'lunch'), meal(FRI, 'lunch')] });
    s = ok(applyWeekChange(s, { type: 'purchase', week: MON, foodId: 'chicken', grams: 360 }, NOW)).state;
    expect(weekShopping(s, MON, MON).find((i) => i.foodId === 'chicken')!.state).toBe('checked');

    s = ok(applyWeekChange(s, { type: 'addMeal', date: FRI, slot: 'dinner', recipeId: 'chicken-rice-bowl', servings: 1 }, NOW)).state;
    const item = weekShopping(s, MON, MON).find((i) => i.foodId === 'chicken')!;
    expect(item.state).toBe('open');
    expect(item.remainingG).toBe(180);
  });

  it('undoing a purchase takes it out of the pantry again', () => {
    let s = state({ plannedMeals: [meal(FRI, 'lunch')] });
    s = ok(applyWeekChange(s, { type: 'purchase', week: MON, foodId: 'chicken' }, NOW)).state;
    s = ok(applyWeekChange(s, { type: 'undoPurchase', week: MON, foodId: 'chicken' }, NOW)).state;
    expect(pantryEstimate(s).chicken).toBeUndefined();
    expect(weekShopping(s, MON, MON).find((i) => i.foodId === 'chicken')!.state).toBe('open');
  });

  it('is pure: the previous state stays untouched, so undo = restoring it', () => {
    const before = state({ plannedMeals: week() });
    const copy = structuredClone(before);
    ok(applyWeekChange(before, { type: 'moveWorkout', slotId: THU_SLOT, toDate: FRI }, NOW));
    expect(before).toEqual(copy);
  });

  it('stores only non-default day contexts', () => {
    let s = ok(applyWeekChange(state(), { type: 'setDayContext', date: THU, context: { timeBudget: 'low' } }, NOW)).state;
    expect(s.dayContexts[THU]).toEqual({ timeBudget: 'low', mode: 'normal' });
    s = ok(applyWeekChange(s, { type: 'setDayContext', date: THU, context: { timeBudget: 'normal' } }, NOW)).state;
    expect(s.dayContexts).toEqual({});
  });
});

// ---------- Migration ----------

describe('migration v1 → v2', () => {
  it('turns "gekauft" / "hab ich schon" into pantry amounts and keeps everything else', () => {
    const lunch = meal(FRI, 'lunch');
    const v1 = {
      ...state({ plannedMeals: [lunch] }),
      schemaVersion: 1,
      shopping: {
        [MON]: { status: { chicken: 'checked', rice: 'have' }, manual: [{ id: 'x', name: 'Kaffee', checked: false }] },
        '2026-09-14': { status: { oats: 'checked' }, manual: [] },
      },
    } as unknown as Record<string, unknown>;
    delete v1.pantry;
    delete v1.dayContexts;
    delete v1.workoutOverrides;

    const s = migrateV1(v1, NOW);
    // v1 is migrated straight to the current schema (v3 only adds the onboarding record).
    expect(s.schemaVersion).toBe(3);
    expect(s.plannedMeals).toEqual([lunch]);
    expect(s.shopping[MON]!.manual).toHaveLength(1);
    expect(s.shopping[MON]!.purchased).toEqual({ chicken: 180 });
    expect(s.shopping['2026-09-14']!.purchased).toEqual({}); // past week: no pantry invented
    const list = weekShopping(s, MON, MON);
    expect(list.find((i) => i.foodId === 'chicken')!.state).toBe('checked');
    // "Hab ich schon" became pantry covering the plan's need; rice is also a basic,
    // so only the F8 minimum stock is still open – nothing for the plan itself.
    const rice = list.find((i) => i.foodId === 'rice')!;
    expect(s.pantry.rice!.quantityG).toBe(80);
    expect(rice.remainingG).toBe(rice.restockG);
    expect(list.find((i) => i.foodId === 'broccoli')?.state).toBe('open');
  });
});

// ---------- Training-day bonus: 3–6 training days ----------

describe('day targets for 3–6 training days', () => {
  const DAYS: Record<number, number[]> = { 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5] };
  const week = weekDays(MON);
  const targetsFor = (n: number) => {
    const s = state({ training: { programId: 'push-pull-legs', weekdays: DAYS[n]! } });
    return { s, targets: week.map((d) => dayTargetFor(s, d)!) };
  };

  it.each([3, 4, 5])('%i training days: each training day gets its load-based bonus, the rest days carry exactly their sum', (n) => {
    const { s, targets } = targetsFor(n);
    const bonus = bonusKcalByDate(s, MON);
    const training = DAYS[n]!.map((i) => targets[i]!.kcal);
    const rest = week.map((_, i) => i).filter((i) => !DAYS[n]!.includes(i)).map((i) => targets[i]!.kcal);
    expect(training).toEqual(DAYS[n]!.map((i) => 2500 + bonus.get(week[i]!)!));
    for (const b of bonus.values()) expect(b).toBeGreaterThanOrEqual(TRAINING_DAY_KCAL * 0.7);
    for (const b of bonus.values()) expect(b).toBeLessThanOrEqual(TRAINING_DAY_KCAL * 1.3);
    const sum = [...bonus.values()].reduce((a, b) => a + b, 0);
    expect(rest.every((k) => k === 2500 - Math.round(sum / (7 - n)))).toBe(true);
  });

  it('leg day gets more than the push day; similar sessions (full body A / B) keep exactly +150', () => {
    const { s } = targetsFor(3);
    const byTemplate = new Map(activeWorkouts(s.training, {}, [], MON).map((w) => [w.template.id, bonusKcalByDate(s, MON).get(w.date)!]));
    expect(byTemplate.get('ppl-legs')!).toBeGreaterThan(byTemplate.get('ppl-push')!);
    expect(byTemplate.get('ppl-push')!).toBeLessThan(TRAINING_DAY_KCAL);
    const fb = state({ training: { programId: 'full-body', weekdays: [0, 2, 4] } });
    expect([...bonusKcalByDate(fb, MON).values()]).toEqual([TRAINING_DAY_KCAL, TRAINING_DAY_KCAL, TRAINING_DAY_KCAL]);
    expect(dayTargetFor(fb, '2026-09-22')!.kcal).toBe(2500 + dayShift(false, 3)); // unchanged rule for similar sessions
  });

  it('6 training days: only 5 days get the bonus, no extreme rest day', () => {
    const { s, targets } = targetsFor(6);
    const kcal = targets.map((t) => t.kcal);
    expect(kcal.filter((k) => k > 2500)).toHaveLength(MAX_BONUS_DAYS);
    // Same order of magnitude as a 5-day week (≈ −375), not −900 on the single rest day.
    expect(Math.min(...kcal)).toBeGreaterThan(2500 - 400);
    // The sessions themselves are untouched: still 6 per week, same rotation.
    expect(activeWorkouts(s.training, {}, [], MON).map((w) => w.template.id)).toEqual(scheduleForWeek(s.training, MON).map((w) => w.template.id));
    expect(activeWorkouts(s.training, {}, [], MON)).toHaveLength(6);
  });

  it.each([3, 4, 5, 6])('%i training days: weekly sum stays, protein constant, no day beyond ±375 kcal', (n) => {
    const { targets } = targetsFor(n);
    expect(Math.abs(targets.reduce((sum, t) => sum + t.kcal, 0) - 2500 * 7)).toBeLessThanOrEqual(5);
    expect(targets.every((t) => t.protein === 160)).toBe(true);
    expect(targets.every((t) => Math.abs(t.kcal - 2500) <= 375)).toBe(true);
  });

  it('moving a session in a 6-day week does not create extreme swings', () => {
    const s = state({ training: { programId: 'push-pull-legs', weekdays: DAYS[6]! } });
    const sat = planSlotId(MON, 5);
    const r = ok(applyWeekChange(s, { type: 'moveWorkout', slotId: sat, toDate: '2026-09-27' }, NOW));
    for (const t of r.summary.targetChanges) expect(Math.abs(t.toKcal - t.fromKcal)).toBeLessThanOrEqual(525);
    for (const d of week) expect(Math.abs(dayTargetFor(r.state, d)!.kcal - 2500)).toBeLessThanOrEqual(375);
  });
});

// ---------- F5 · time budget: training and cascade ----------

describe('F5 · time budget – training', () => {
  const s = state();
  const thuSession = (ctx: AppState['dayContexts']) => resolveWorkouts(s.training, {}, [], MON, ctx).find((w) => w.date === THU)!;

  it('a low day shortens the session with fitTemplateToTime; normal/high keep it', () => {
    const full = thuSession({});
    const low = thuSession({ [THU]: { timeBudget: 'low', mode: 'normal' } });
    expect(estimateMinutes(low.template)).toBeLessThanOrEqual(30);
    expect(estimateMinutes(full.template)).toBeGreaterThan(30);
    expect(low.template.exercises.slice(0, 2)).toEqual(full.template.exercises.slice(0, 2).map((e) => expect.objectContaining({ exerciseId: e.exerciseId })));
    expect(low.template.name).toMatch(/\(kurz\)$/);
    expect(thuSession({ [THU]: { timeBudget: 'high', mode: 'normal' } }).template).toBe(full.template);
    expect(templateForDay(full.template, { timeBudget: 'normal', mode: 'normal' })).toBe(full.template);
  });

  it('dates and rotation stay the same – only the length changes', () => {
    const plain = resolveWorkouts(s.training, {}, [], MON);
    const low = resolveWorkouts(s.training, {}, [], MON, { [THU]: { timeBudget: 'low', mode: 'normal' } });
    expect(low.map((w) => [w.id, w.date, w.template.id])).toEqual(plain.map((w) => [w.id, w.date, w.template.id]));
    expect(low.find((w) => w.date === MON)!.template).toBe(plain.find((w) => w.date === MON)!.template);
  });
});

describe('F5 · time budget – cascade', () => {
  const thuMeals = () => [
    meal(THU, 'lunch', 'chili', { source: 'suggest' }), // 35 min
    meal(THU, 'dinner', 'oven-salmon', { source: 'suggest' }), // 35 min
  ];
  const kcal = (st: AppState, d: string) => st.plannedMeals.filter((m) => m.date === d).reduce((sum, m) => sum + plannedMealMacros(m).kcal, 0);
  const prepOn = (st: AppState, d: string) => st.plannedMeals.filter((m) => m.date === d).map((m) => getRecipe(m.recipeId)!.prepMin);

  it('"Wenig Zeit" exchanges slow meals, shortens training and updates shopping', () => {
    const before = state({ plannedMeals: [...thuMeals(), meal(FRI, 'lunch')] });
    const copy = structuredClone(before);
    const r = ok(applyWeekChange(before, { type: 'setDayContext', date: THU, context: { timeBudget: 'low' } }, NOW));

    expect(r.state.dayContexts[THU]).toEqual({ timeBudget: 'low', mode: 'normal' });
    expect(prepOn(r.state, THU).every((p) => p <= 20)).toBe(true);
    expect(r.summary.title).toBe('Donnerstag: Wenig Zeit');
    expect(r.summary.replaced.map((x) => x.from).sort()).toEqual(['Chili con Carne mit Reis', 'Ofenlachs mit Kartoffeln & Brokkoli'].sort());
    // Calories of the day are kept (servings scaled to the same space).
    expect(Math.abs(kcal(r.state, THU) - kcal(before, THU)) / kcal(before, THU)).toBeLessThan(0.1);
    // Training on Thursday is the short version now.
    expect(r.summary.details.some((d) => /^Training: .*\(kurz\) ~\d+ min$/.test(d))).toBe(true);
    // Shopping follows the new meals.
    expect(r.summary.shopping.added.length + r.summary.shopping.removed.length).toBeGreaterThan(0);
    expect(weekShopping(r.state, MON, MON).some((i) => i.foodId === 'salmon')).toBe(false);
    // Undo = the untouched previous state.
    expect(before).toEqual(copy);
  });

  it('keeps meals the user picked or sized', () => {
    const own = meal(THU, 'lunch', 'bolognese', { source: 'user' });
    const sized = meal(THU, 'dinner', 'oven-salmon', { source: 'suggest', servingsLocked: true });
    const r = ok(applyWeekChange(state({ plannedMeals: [own, sized] }), { type: 'setDayContext', date: THU, context: { timeBudget: 'low' } }, NOW));
    expect(r.state.plannedMeals.map((m) => m.recipeId)).toEqual(['bolognese', 'oven-salmon']);
    expect(r.summary.replaced).toHaveLength(0);
  });

  it('back to "Normal": the quick meals are re-evaluated (exchanged only if clearly better), training full again', () => {
    const low = ok(applyWeekChange(state({ plannedMeals: thuMeals() }), { type: 'setDayContext', date: THU, context: { timeBudget: 'low' } }, NOW)).state;
    const r = ok(applyWeekChange(low, { type: 'setDayContext', date: THU, context: { timeBudget: 'normal' } }, NOW));
    // Same ids, same calories – only what is cooked may change, and only for a clear gain.
    expect(r.state.plannedMeals.map((m) => m.id)).toEqual(low.plannedMeals.map((m) => m.id));
    expect(Math.abs(kcal(r.state, THU) - kcal(low, THU)) / kcal(low, THU)).toBeLessThan(0.1);
    expect(r.summary.details.some((d) => /Gerichte? angepasst|passen bereits|(bleibt|bleiben) geplant/.test(d))).toBe(true);
    expect(r.state.dayContexts).toEqual({});
    expect(r.summary.details.some((d) => d.startsWith('Training: ') && !d.includes('(kurz)'))).toBe(true);
  });

  it('uses meal-prep leftovers on a low day', () => {
    // Chili cooked on Wednesday → Thursday lunch can be the leftover (5 min).
    const wed = meal('2026-09-23', 'dinner', 'chili', { source: 'user' });
    // Only for users who like to cook ahead (E18).
    const cooksAhead = { version: 1 as const, progress: { completed: {}, skipped: [] }, body: {}, health: {}, goal: {}, food: { mealPrep: { value: true, source: 'user' as const, updatedAt: NOW.toISOString() } }, training: {} };
    const r = ok(applyWeekChange(state({ plannedMeals: [wed, ...thuMeals().slice(1)], onboarding: cooksAhead }), { type: 'setDayContext', date: THU, context: { timeBudget: 'low' } }, NOW));
    const cooked = new Map<string, string[]>();
    r.state.plannedMeals.forEach((m) => cooked.set(m.recipeId, [...(cooked.get(m.recipeId) ?? []), m.date]));
    for (const m of r.state.plannedMeals.filter((x) => x.date === THU)) expect(effectivePrepMin(getRecipe(m.recipeId)!, THU, cooked, true)).toBeLessThanOrEqual(15);
  });

  it('past days are closed: the context of a lived day cannot be changed', () => {
    const past = meal('2026-09-20', 'lunch', 'chili', { source: 'suggest' });
    const r = applyWeekChange(state({ plannedMeals: [past] }), { type: 'setDayContext', date: '2026-09-20', context: { timeBudget: 'low' } }, new Date(2026, 8, 22));
    expect(r.ok).toBe(false);
  });
});

describe('F5 · replacing a single meal', () => {
  it('keeps the day total when only breakfast is too slow', () => {
    const day = [
      meal(THU, 'breakfast', 'protein-pancakes', { source: 'suggest' }), // 20 min
      meal(THU, 'lunch', 'couscous-salad', { source: 'suggest' }),
      meal(THU, 'dinner', 'veggie-omelette', { source: 'suggest' }),
    ];
    const before = state({ plannedMeals: day });
    const r = ok(applyWeekChange(before, { type: 'setDayContext', date: THU, context: { timeBudget: 'low' } }, NOW));
    expect(r.summary.replaced.map((x) => x.from)).toEqual([getRecipe('protein-pancakes')!.title]);
    const kcal = (s: AppState) => s.plannedMeals.reduce((sum, m) => sum + plannedMealMacros(m).kcal, 0);
    expect(Math.abs(kcal(r.state) - kcal(before)) / kcal(before)).toBeLessThan(0.1);
  });
});
