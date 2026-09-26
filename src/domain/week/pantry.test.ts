import { describe, expect, it } from 'vitest';
import { getFood } from '../../data/foods';
import { getRecipe } from '../../data/recipes';
import { emptyState } from '../../store/persistence';
import { addDays, weekDays } from '../dates';
import { logFromMeal, plannedMealMacros, sumMacros } from '../nutrition';
import { effectivePrepMin, scoreWeek, seededRandom, suggestWeek } from '../planner';
import type { AppState, PlannedMeal } from '../types';
import { applyWeekChange, type CascadeResult } from './cascade';
import { pantryEstimate, purchaseAmount } from './pantry';
import { planMeals } from './planning';
import { availablePantry, weekShopping } from './weekPlan';

/**
 * F2 – quantity-aware pantry. The loop:
 * plan → shopping → purchase → pantry → eating → consumption → next week.
 */

const MON = '2026-09-21';
const NEXT = '2026-09-28';
const NOW = new Date(2026, 8, 21, 8, 0);

let seq = 0;
const meal = (date: string, slot: PlannedMeal['slot'], recipeId: string, servings = 1, patch: Partial<PlannedMeal> = {}): PlannedMeal => ({
  id: `p${++seq}`,
  date,
  slot,
  recipeId,
  servings,
  status: 'planned',
  source: 'suggest',
  ...patch,
});

function state(patch: Partial<AppState> = {}): AppState {
  return {
    ...emptyState(),
    profile: { name: 'T', sex: 'male', age: 30, heightCm: 180, activity: 'moderate', experience: 'beginner', createdAt: '2026-09-01T08:00:00Z' },
    goal: { type: 'muscle_gain', startWeightKg: 80, startedAt: '2026-09-01' },
    nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['breakfast', 'snack', 'lunch', 'dinner'] },
    targets: [{ id: 't', validFrom: '2026-09-01', method: 'formula', kcal: 2800, protein: 160, carbs: 330, fat: 80 }],
    training: null,
    weights: [{ id: 'w', date: '2026-09-01', kg: 80 }],
    ...patch,
  };
}

const ok = (r: CascadeResult) => {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};
/** "Gegessen": the planned meal becomes a log entry – exactly what markEaten does. */
const eat = (s: AppState, id: string, at: string): AppState => {
  const m = s.plannedMeals.find((x) => x.id === id)!;
  return {
    ...s,
    plannedMeals: s.plannedMeals.map((x) => (x.id === id ? { ...x, status: 'eaten' } : x)),
    logEntries: [...s.logEntries, logFromMeal({ ...m, status: 'eaten' }, at)],
  };
};
const item = (s: AppState, week: string, foodId: string, today = MON) => weekShopping(s, week, today).find((i) => i.foodId === foodId);
const chickenPerBowl = getRecipe('chicken-rice-bowl')!.ingredients.find((i) => i.foodId === 'chicken')!.grams; // 180 g

describe('F2 · purchase → pantry → shopping', () => {
  it('buying credits the package amount to the pantry', () => {
    // 420 g needed → chicken comes in 400 g packs → 2 packs = 800 g.
    const s0 = state({ plannedMeals: [meal('2026-09-23', 'dinner', 'chicken-rice-bowl', 420 / chickenPerBowl)] });
    const s1 = ok(applyWeekChange(s0, { type: 'purchase', week: MON, foodId: 'chicken' }, NOW));
    expect(pantryEstimate(s1).chicken).toBe(800);
    expect(item(s1, MON, 'chicken')!.state).toBe('checked');
  });

  it('pantry is subtracted from the need – not only visually', () => {
    // 500 g rice needed (6.25 bowls à 80 g), 200 g at home → 300 g open.
    const s = state({
      plannedMeals: [meal('2026-09-23', 'dinner', 'chicken-rice-bowl', 500 / 80)],
      pantry: { rice: { foodId: 'rice', quantityG: 200, updatedAt: '2026-09-20T10:00:00Z' } },
      // Pure pantry subtraction – the F8 minimum stock is tested in restock.test.ts.
      shopping: { [MON]: { purchased: {}, manual: [], restockSkipped: ['rice'] } },
    });
    const rice = item(s, MON, 'rice')!;
    expect(rice.neededG).toBeCloseTo(500);
    expect(rice.remainingG).toBeCloseTo(300);
    expect(rice.state).toBe('open');
    // Buying completes it with whole packages (1 kg) – 700 g remain afterwards.
    const bought = ok(applyWeekChange(s, { type: 'purchase', week: MON, foodId: 'rice' }, NOW));
    expect(pantryEstimate(bought).rice).toBe(1200);
  });

  it('500 g bought, 300 g eaten → 200 g left and counted next week', () => {
    const quarkPer = getRecipe('quark-berries')!.ingredients.find((i) => i.foodId === 'quark')!.grams; // 250 g
    const thisWeek = meal('2026-09-22', 'snack', 'quark-berries', 300 / quarkPer);
    const nextWeek = meal('2026-09-29', 'snack', 'quark-berries', 300 / quarkPer);
    let s = state({ plannedMeals: [thisWeek, nextWeek] });
    s = ok(applyWeekChange(s, { type: 'purchase', week: MON, foodId: 'quark', grams: 500 }, NOW));
    s = eat(s, thisWeek.id, '2026-09-22T12:00:00Z');
    expect(pantryEstimate(s).quark).toBe(200);
    // Next week: 300 g needed, 200 g at home → 100 g to buy.
    expect(item(s, NEXT, 'quark', '2026-09-23')!.remainingG).toBeCloseTo(100);
  });

  it('pantry survives week boundaries – only consumption or corrections change it', () => {
    const s = state({ pantry: { rice: { foodId: 'rice', quantityG: 350, updatedAt: '2026-09-01T10:00:00Z' } } });
    for (const later of ['2026-09-21', '2026-10-05', '2026-11-02']) {
      expect(pantryEstimate(s).rice).toBe(350);
      expect(availablePantry(s, later, later).rice).toBe(350);
    }
  });

  it('package leftovers stay and reduce the next purchase', () => {
    // Week 1: 320 g chicken needed → 400 g bought → 80 g rest after eating.
    const w1 = meal('2026-09-22', 'dinner', 'chicken-rice-bowl', 320 / chickenPerBowl);
    const w2 = meal('2026-09-29', 'dinner', 'chicken-rice-bowl', 300 / chickenPerBowl);
    let s = state({ plannedMeals: [w1, w2] });
    s = ok(applyWeekChange(s, { type: 'purchase', week: MON, foodId: 'chicken' }, NOW));
    s = eat(s, w1.id, '2026-09-22T19:00:00Z');
    expect(pantryEstimate(s).chicken).toBe(80);
    // Week 2: 300 g needed, 80 g there → 220 g open → one 400 g pack.
    const open = item(s, NEXT, 'chicken', '2026-09-23')!;
    expect(open.remainingG).toBeCloseTo(220);
    expect(purchaseAmount(getFood('chicken')!, open.remainingG)).toBe(400);
  });

  it('next week never counts stock this week still needs', () => {
    const thisWeek = meal('2026-09-25', 'dinner', 'chicken-rice-bowl'); // 180 g
    const s = state({ plannedMeals: [thisWeek], pantry: { chicken: { foodId: 'chicken', quantityG: 400, updatedAt: '2026-09-20T10:00:00Z' } } });
    expect(availablePantry(s, NEXT, MON).chicken).toBe(220);
  });
});

describe('F2 · pieces and grams', () => {
  it('the banana case: 370 g = "3 Stück", buying 3 × 120 g closes the item', () => {
    const per = getRecipe('pb-porridge')!.ingredients.find((i) => i.foodId === 'banana')!.grams;
    const s0 = state({ plannedMeals: [meal('2026-09-24', 'breakfast', 'pb-porridge', 370 / per)] });
    const s1 = ok(applyWeekChange(s0, { type: 'purchase', week: MON, foodId: 'banana' }, NOW));
    expect(pantryEstimate(s1).banana).toBe(360);
    expect(item(s1, MON, 'banana')!.state).toBe('checked');
  });

  it('the same tolerance applies to every piece food (tomatoes, 80 g each)', () => {
    const tomato = getFood('tomato')!;
    const per = getRecipe('tuna-pasta-salad')!.ingredients.find((i) => i.foodId === 'tomato')!.grams;
    const s0 = state({ plannedMeals: [meal('2026-09-24', 'lunch', 'tuna-pasta-salad', 250 / per)] });
    expect(purchaseAmount(tomato, 250)).toBe(240); // "3 Stück"
    const s1 = ok(applyWeekChange(s0, { type: 'purchase', week: MON, foodId: 'tomato' }, NOW));
    expect(item(s1, MON, 'tomato')!.state).toBe('checked');
    // A clearly larger need (300 g) still opens a 4th piece.
    expect(purchaseAmount(tomato, 300)).toBe(320);
  });
});

describe('F2 · consumption and undo (store)', () => {
  it('eating reduces the pantry once – a second tap does not subtract again; undo restores', async () => {
    const store = await import('../../store/store');
    const actions = await import('../../store/actions');
    const bowl = meal('2026-09-21', 'lunch', 'chicken-rice-bowl');
    store.commit(state({ plannedMeals: [bowl], pantry: { chicken: { foodId: 'chicken', quantityG: 700, updatedAt: '2026-01-01T00:00:00Z' } } }));

    const before = store.snapshot();
    actions.markEaten(bowl.id);
    expect(pantryEstimate(store.getState()).chicken).toBe(700 - chickenPerBowl);
    actions.markEaten(bowl.id);
    expect(pantryEstimate(store.getState()).chicken).toBe(700 - chickenPerBowl);

    store.restore(before);
    expect(pantryEstimate(store.getState()).chicken).toBe(700);
  });

  it('purchase and correction are undone by the snapshot', async () => {
    const store = await import('../../store/store');
    const actions = await import('../../store/actions');
    store.commit(state({ plannedMeals: [meal(addDays(MON, 3), 'lunch', 'chicken-rice-bowl')], pantry: { chicken: { foodId: 'chicken', quantityG: 200, updatedAt: '2026-01-01T00:00:00Z' } } }));
    const week = MON;

    const s0 = store.snapshot();
    actions.applyChange({ type: 'setPantry', foodId: 'chicken', quantityG: 50 });
    expect(pantryEstimate(store.getState()).chicken).toBe(50);
    store.restore(s0);
    expect(pantryEstimate(store.getState()).chicken).toBe(200);

    const s1 = store.snapshot();
    actions.applyChange({ type: 'purchase', week, foodId: 'chicken', grams: 500 });
    expect(pantryEstimate(store.getState()).chicken).toBe(700);
    store.restore(s1);
    expect(pantryEstimate(store.getState()).chicken).toBe(200);
  });

  it('a correction updates shopping and keeps the plan', () => {
    const plan = [meal('2026-09-24', 'lunch', 'chicken-rice-bowl', 1, { source: 'user' })];
    const s0 = state({ plannedMeals: plan });
    const s1 = ok(applyWeekChange(s0, { type: 'setPantry', foodId: 'chicken', quantityG: 500 }, NOW));
    expect(item(s1, MON, 'chicken')!.state).toBe('have');
    expect(s1.plannedMeals).toEqual(plan);
    const s2 = ok(applyWeekChange(s1, { type: 'setPantry', foodId: 'chicken', quantityG: 100 }, NOW));
    expect(item(s2, MON, 'chicken')!.remainingG).toBeCloseTo(80);
  });
});

describe('F2 · planner uses the pantry – together with F3 and F5', () => {
  const dates = weekDays(MON);
  const target = { kcal: 2800, protein: 160, carbs: 330, fat: 80 };
  const profile = state().nutritionProfile!;
  const SEEDS = ['1', '2', '3', '4', '5'];
  const pantry = { salmon: 500, potato: 1500, broccoli: 500 };
  const run = (seed: string, opts: { pantry?: Record<string, number>; low?: boolean; existing?: PlannedMeal[] } = {}) =>
    suggestWeek({
      dates,
      slots: profile.slots,
      target,
      profile,
      existing: opts.existing ?? [],
      pantry: opts.pantry,
      timeBudgetFor: (d) => (opts.low && d === dates[3] ? 'low' : 'normal'),
      random: seededRandom(seed),
    });
  const uses = (meals: PlannedMeal[], foodId: string) => meals.filter((m) => getRecipe(m.recipeId)!.ingredients.some((i) => i.foodId === foodId)).length;
  const foods = (meals: PlannedMeal[]) => new Set(meals.flatMap((m) => getRecipe(m.recipeId)!.ingredients.map((i) => i.foodId)));

  it('prefers plans that use perishable stock – never less than without pantry', () => {
    for (const seed of SEEDS) expect(uses(run(seed, { pantry }), 'salmon')).toBeGreaterThanOrEqual(uses(run(seed), 'salmon'));
    const sum = (p?: Record<string, number>) => SEEDS.reduce((s, seed) => s + uses(run(seed, { pantry: p }), 'salmon'), 0);
    expect(sum(pantry)).toBeGreaterThan(sum());
  });

  it('scores unused perishable stock', () => {
    const day = { date: MON, target, fixed: [], remainingKcal: 700, slots: ['lunch' as const], timeBudget: 'normal' as const };
    const withSalmon = scoreWeek([{ ...day, picks: [getRecipe('oven-salmon')!] }], { salmon: 250 });
    const without = scoreWeek([{ ...day, picks: [getRecipe('chicken-rice-bowl')!] }], { salmon: 250 });
    expect(withSalmon.pantryUnused).toBeLessThan(without.pantryUnused);
  });

  it('pantry + F3: fewer foods to buy', () => {
    const toBuy = (p?: Record<string, number>) =>
      SEEDS.reduce((s, seed) => s + [...foods(run(seed, { pantry: p }))].filter((f) => !(p && p[f])).length, 0);
    expect(toBuy(pantry)).toBeLessThan(toBuy());
  });

  it('pantry + F5: the low day stays quick although stock pulls towards the 35-min salmon', () => {
    for (const seed of SEEDS) {
      const meals = run(seed, { pantry, low: true });
      const cooked = new Map<string, string[]>();
      meals.forEach((m) => cooked.set(m.recipeId, [...(cooked.get(m.recipeId) ?? []), m.date]));
      for (const m of meals.filter((x) => x.date === dates[3])) expect(effectivePrepMin(getRecipe(m.recipeId)!, m.date, cooked)).toBeLessThanOrEqual(20);
    }
  });

  it('pantry + F3 + F5 together keep nutrition', () => {
    for (const seed of SEEDS) {
      const meals = run(seed, { pantry, low: true });
      for (const d of dates) {
        const day = sumMacros(meals.filter((m) => m.date === d).map(plannedMealMacros));
        expect(Math.abs(day.kcal - target.kcal) / target.kcal).toBeLessThan(0.1);
        expect(day.protein / target.protein).toBeGreaterThan(0.9);
      }
    }
  });

  it('a meal the user chose stays fixed, its ingredients still count', () => {
    const own = meal(dates[0]!, 'dinner', 'oven-salmon', 1, { source: 'user' });
    const meals = run('3', { pantry, existing: [own] });
    expect(meals.some((m) => m.date === dates[0] && m.slot === 'dinner')).toBe(false);
    expect(meals.some((m) => m.id === own.id)).toBe(false);
  });

  it('central planMeals reserves stock for the current week when planning the next', () => {
    const s = state({
      plannedMeals: [meal('2026-09-25', 'dinner', 'oven-salmon', 2)], // 250 g salmon this week
      pantry: { salmon: { foodId: 'salmon', quantityG: 250, updatedAt: '2026-09-20T10:00:00Z' } },
    });
    const next = planMeals(s, { dates: weekDays(NEXT), today: MON, seed: NEXT });
    expect(next.length).toBeGreaterThan(0);
    expect(availablePantry(s, NEXT, MON).salmon).toBe(0);
  });
});
