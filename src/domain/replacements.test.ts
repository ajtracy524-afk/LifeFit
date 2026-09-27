import { describe, expect, it } from 'vitest';
import { getRecipe } from '../data/recipes';
import { emptyState } from '../store/persistence';
import { formatCostRange, ingredientCostRange, MIN_PRICED_SHARE, recipeCostRange } from './costs';
import { replacementHistory } from './replacements';
import type { AppState, LogEntry, PlannedMeal } from './types';
import { applyWeekChange, weekFoodCost } from './week';

const MON = '2026-09-21';
const meal = (id: string, recipeId: string, patch: Partial<PlannedMeal> = {}): PlannedMeal => ({ id, date: MON, slot: 'lunch', recipeId, servings: 1, status: 'planned', source: 'suggest', ...patch });
const entry = (patch: Partial<LogEntry>): LogEntry => ({ id: Math.random().toString(36), date: MON, slot: 'lunch', loggedAt: `${MON}T12:30:00Z`, name: 'x', method: 'manual', macros: { kcal: 500, protein: 20, carbs: 50, fat: 15 }, ...patch });

describe('replacement history ("Zuletzt als Ersatz")', () => {
  const current = meal('now', 'bolognese');

  it('a swap is remembered by the cascade and offered again for the same dish', () => {
    const s: AppState = { ...emptyState(), nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['lunch'] }, plannedMeals: [meal('a', 'bolognese')] };
    const r = applyWeekChange(s, { type: 'replaceMeal', mealId: 'a', recipeId: 'chicken-rice-bowl', servings: 1 }, new Date(2026, 8, 21, 9));
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.plannedMeals[0]!.replacedRecipeId).toBe('bolognese');
    expect(replacementHistory(r.state, current)).toEqual([{ kind: 'recipe', recipeId: 'chicken-rice-bowl', count: 1 }]);
  });

  it('accepted planner suggestions (learn: false) are not remembered as the user’s replacement', () => {
    const s: AppState = { ...emptyState(), plannedMeals: [meal('a', 'bolognese')] };
    const r = applyWeekChange(s, { type: 'replaceMeal', mealId: 'a', recipeId: 'chili', servings: 1, learn: false }, new Date(2026, 8, 21, 9));
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.plannedMeals[0]!.replacedRecipeId).toBeUndefined();
  });

  it('frequent "Pasta → Chicken Bowl" ranks first; same dish beats same slot; counts add up', () => {
    const s = {
      plannedMeals: [
        meal('p1', 'chicken-rice-bowl', { date: '2026-09-10', replacedRecipeId: 'bolognese' }),
        meal('p2', 'chicken-rice-bowl', { date: '2026-09-14', replacedRecipeId: 'bolognese' }),
        meal('p3', 'lentil-dal', { date: '2026-09-15', replacedRecipeId: 'chili' }),
        meal('p4', 'tofu-stir-fry', { date: '2026-09-16', slot: 'dinner', replacedRecipeId: 'oven-salmon' }),
      ],
      logEntries: [],
    };
    const h = replacementHistory(s, current);
    expect(h[0]).toEqual({ kind: 'recipe', recipeId: 'chicken-rice-bowl', count: 2 });
    expect(h[1]).toEqual({ kind: 'recipe', recipeId: 'lentil-dal', count: 1 }); // same slot
    expect(h.some((x) => x.kind === 'recipe' && x.recipeId === 'tofu-stir-fry')).toBe(false); // other slot, other dish
  });

  it('foods eaten instead (barcode / manual) are remembered – the latest entry is reused', () => {
    const skipped = meal('s1', 'bolognese', { date: '2026-09-14', status: 'skipped' });
    const s = {
      plannedMeals: [skipped, meal('s2', 'bolognese', { date: '2026-09-15', status: 'skipped' })],
      logEntries: [
        entry({ replacedMealId: 's1', method: 'barcode', barcode: '4000000000009', name: 'Skyr', amount: 150, loggedAt: '2026-09-14T12:00:00Z' }),
        entry({ replacedMealId: 's2', method: 'barcode', barcode: '4000000000009', name: 'Skyr', amount: 250, loggedAt: '2026-09-15T12:00:00Z' }),
        entry({ name: 'Ohne Bezug' }),
      ],
    };
    const h = replacementHistory(s, current);
    expect(h).toHaveLength(1);
    expect(h[0]!.kind).toBe('entry');
    expect(h[0]!.count).toBe(2);
    expect(h[0]!.kind === 'entry' && h[0]!.entry.amount).toBe(250);
  });
});

describe('cost ranges – rough, never invented', () => {
  it('a recipe with priced ingredients gets a rounded range', () => {
    const r = recipeCostRange(getRecipe('chili')!, 1)!;
    expect(r.lowChf).toBeLessThan(r.highChf);
    expect(formatCostRange(r)).toMatch(/^ca\. CHF [\d.]+–[\d.]+$/);
  });

  it(`below ${MIN_PRICED_SHARE * 100} % priced weight no number is shown`, () => {
    // Whey and protein bars have no price estimate.
    expect(ingredientCostRange([{ foodId: 'whey', grams: 100 }, { foodId: 'rice', grams: 10 }])).toBeUndefined();
    expect(ingredientCostRange([])).toBeUndefined();
    expect(ingredientCostRange([{ foodId: 'rice', grams: 90 }, { foodId: 'whey', grams: 10 }])).toBeDefined();
  });

  it('the week cost covers planned and eaten meals, not skipped ones', () => {
    const base = { ...emptyState(), plannedMeals: [meal('a', 'chili'), meal('b', 'chili', { date: '2026-09-22', status: 'eaten' })] };
    const both = weekFoodCost(base, MON)!;
    const one = weekFoodCost({ ...base, plannedMeals: [base.plannedMeals[0]!, { ...base.plannedMeals[1]!, status: 'skipped' }] }, MON)!;
    expect(both.highChf).toBeGreaterThan(one.highChf);
    expect(weekFoodCost({ ...emptyState() }, MON)).toBeUndefined();
  });

  it('small amounts read honestly', () => {
    expect(formatCostRange({ lowChf: 0.5, highChf: 1 })).toBe('unter CHF 1.–');
    expect(formatCostRange({ lowChf: 2, highChf: 3 })).toBe('ca. CHF 2–3');
  });
});
