import { describe, expect, it } from 'vitest';
import { getFood } from '../data/foods';
import { RECIPES, getRecipe } from '../data/recipes';
import { addDays, weekDays, weekStart, weekdayIndex } from './dates';
import { calculateTargets, plannedMealMacros, recipeAllowed, sumMacros, targetForDate } from './nutrition';
import { suggestWeek, swapOptions } from './planner';
import { goalProgress, withTrend } from './progress';
import { buildShoppingList, describeQuantity } from './shopping';
import { createWorkout, detectRecords, progressionSuggestion, scheduleForWeek } from './training';
import type { NutritionProfile, NutritionTarget, PlannedMeal, Workout } from './types';

/** Deterministic PRNG so planner tests are stable. */
function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const meal = (p: Partial<PlannedMeal>): PlannedMeal => ({
  id: Math.random().toString(36),
  date: '2026-09-21',
  slot: 'lunch',
  recipeId: 'chicken-rice-bowl',
  servings: 1,
  status: 'planned',
  source: 'user',
  ...p,
});

describe('dates', () => {
  it('uses Monday as first day of the week', () => {
    expect(weekStart('2026-09-27')).toBe('2026-09-21'); // Sunday → Monday
    expect(weekdayIndex('2026-09-21')).toBe(0);
    expect(weekDays('2026-09-21')).toHaveLength(7);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('calculateTargets', () => {
  const profile = { sex: 'male' as const, age: 27, heightCm: 180, activity: 'sedentary' as const };

  it('uses Mifflin-St Jeor and a surplus for muscle gain', () => {
    const t = calculateTargets(profile, 'muscle_gain', 78, 4);
    expect(t.bmr).toBe(1775);
    expect(t.kcal).toBeGreaterThan(t.tdee);
    expect(t.protein).toBe(156);
    // Macros add up to the calorie target (±rounding).
    expect(Math.abs(t.protein * 4 + t.carbs * 4 + t.fat * 9 - t.kcal)).toBeLessThan(10);
  });

  it('never goes below a safe floor when losing fat', () => {
    const t = calculateTargets({ ...profile, sex: 'female', age: 60, heightCm: 150 }, 'fat_loss', 45, 0);
    expect(t.kcal).toBeGreaterThanOrEqual(1200);
    expect(t.kcal).toBeGreaterThanOrEqual(t.bmr);
  });
});

describe('targetForDate', () => {
  const targets: NutritionTarget[] = [
    { id: 'a', validFrom: '2026-09-01', kcal: 2500, protein: 150, carbs: 300, fat: 70, method: 'formula' },
    { id: 'b', validFrom: '2026-09-15', kcal: 2700, protein: 160, carbs: 330, fat: 75, method: 'manual' },
  ];
  it('returns the version valid on that day', () => {
    expect(targetForDate(targets, '2026-09-10')?.id).toBe('a');
    expect(targetForDate(targets, '2026-09-15')?.id).toBe('b');
    expect(targetForDate(targets, '2026-08-01')?.id).toBe('a');
  });
});

describe('shopping list', () => {
  it('aggregates ingredients across planned meals and scales servings', () => {
    const items = buildShoppingList(
      [meal({ servings: 1 }), meal({ date: '2026-09-22', servings: 1.5 }), meal({ date: '2026-09-23', status: 'eaten' })],
      '2026-09-21',
      '2026-09-27',
    );
    const chicken = items.find((i) => i.foodId === 'chicken')!;
    expect(chicken.grams).toBeCloseTo(180 * 2.5);
    expect(chicken.sources).toHaveLength(2); // eaten meal is not on the list
  });

  it('ignores meals outside the range', () => {
    expect(buildShoppingList([meal({ date: '2026-10-05' })], '2026-09-21', '2026-09-27')).toHaveLength(0);
  });

  it('shows pieces and package hints', () => {
    expect(describeQuantity(getFood('egg')!, 300).quantity).toBe('5 Eier');
    expect(describeQuantity(getFood('skyr')!, 900).hint).toBe('2 × 450 g');
  });
});

describe('planner', () => {
  const target = { kcal: 2800, protein: 160, carbs: 330, fat: 80 };
  const profile: NutritionProfile = { diet: 'omnivore', excluded: [], slots: ['breakfast', 'snack', 'lunch', 'dinner'] };
  const dates = weekDays('2026-09-21');

  it('fills every empty slot and lands close to the calorie target', () => {
    const plan = suggestWeek({ dates, slots: profile.slots, target, profile, existing: [], random: seeded(1) });
    expect(plan).toHaveLength(28);
    for (const d of dates) {
      const kcal = sumMacros(plan.filter((m) => m.date === d).map(plannedMealMacros)).kcal;
      expect(Math.abs(kcal - target.kcal) / target.kcal).toBeLessThan(0.1);
    }
  });

  it('keeps existing meals and only fills gaps', () => {
    const existing = [meal({ date: dates[0]!, slot: 'lunch' })];
    const plan = suggestWeek({ dates: [dates[0]!], slots: profile.slots, target, profile, existing, random: seeded(2) });
    expect(plan.map((m) => m.slot).sort()).toEqual(['breakfast', 'dinner', 'snack']);
  });

  it('respects vegan diet and exclusions', () => {
    const vegan: NutritionProfile = { ...profile, diet: 'vegan', excluded: ['gluten'] };
    const plan = suggestWeek({ dates, slots: vegan.slots, target, profile: vegan, existing: [], random: seeded(3) });
    expect(plan.length).toBeGreaterThan(0);
    for (const m of plan) expect(recipeAllowed(getRecipe(m.recipeId)!, vegan)).toBe(true);
  });

  it('offers swaps with similar calories', () => {
    const options = swapOptions(meal({ servings: 1 }), profile);
    const original = plannedMealMacros(meal({ servings: 1 })).kcal;
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) expect(Math.abs(o.macros.kcal - original) / original).toBeLessThan(0.1);
  });

  it('every recipe references existing foods', () => {
    for (const r of RECIPES) for (const i of r.ingredients) expect(getFood(i.foodId), `${r.id} → ${i.foodId}`).toBeDefined();
  });
});

describe('training', () => {
  it('rotates templates across the week', () => {
    const s = scheduleForWeek({ programId: 'upper-lower', weekdays: [0, 1, 3, 4] }, '2026-09-21');
    expect(s.map((x) => x.template.name)).toEqual(['Oberkörper A', 'Unterkörper A', 'Oberkörper B', 'Unterkörper B']);
  });

  const done = (id: string, startedAt: string, weight: number, reps: number[]): Workout => ({
    id,
    date: startedAt.slice(0, 10),
    templateId: 'ppl-push',
    name: 'Push',
    startedAt,
    status: 'completed',
    exercises: [
      {
        id: `${id}-ex`,
        exerciseId: 'bench-press',
        repMin: 6,
        repMax: 10,
        restSec: 150,
        sets: reps.map((r, i) => ({ id: `${id}-${i}`, weightKg: weight, reps: r, done: true, type: 'working' as const })),
      },
    ],
  });

  it('suggests more weight once all sets hit the top of the range', () => {
    expect(progressionSuggestion(done('a', '2026-09-01T10:00', 80, [10, 10, 10]).exercises[0]!.sets, 10, 'bench-press')).toBe(82.5);
    expect(progressionSuggestion(done('a', '2026-09-01T10:00', 80, [10, 9, 8]).exercises[0]!.sets, 10, 'bench-press')).toBeUndefined();
  });

  it('prefills a new session with the last performance', () => {
    const history = [done('a', '2026-09-01T10:00', 80, [8, 8, 7])];
    const template = { id: 'ppl-push', name: 'Push', focus: '', exercises: [{ exerciseId: 'bench-press', sets: 3, repMin: 6, repMax: 10, restSec: 150 }] };
    const w = createWorkout(template, history, '2026-09-08');
    expect(w.exercises[0]!.sets.map((s) => [s.weightKg, s.reps])).toEqual([
      [80, 8],
      [80, 8],
      [80, 7],
    ]);
  });

  it('detects personal records only against earlier sessions', () => {
    const first = done('a', '2026-09-01T10:00', 80, [8]);
    const better = done('b', '2026-09-08T10:00', 82.5, [8]);
    expect(detectRecords(first, [first])).toHaveLength(0);
    expect(detectRecords(better, [first, better])).toHaveLength(1);
  });
});

describe('progress', () => {
  it('smooths weight with a 7-day trend and computes goal progress', () => {
    const weights = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22'].map((date, i) => ({ id: date, date, kg: 78 + i * 0.5 }));
    const trend = withTrend(weights);
    expect(trend[trend.length - 1]!.trend).toBe(79.5);
    const g = goalProgress({ type: 'muscle_gain', startWeightKg: 78, targetWeightKg: 82, startedAt: '2026-09-01' }, weights);
    expect(g.percent).toBe(38);
    expect(g.etaWeeks).toBeGreaterThan(0);
  });
});
