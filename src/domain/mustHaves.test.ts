import { describe, expect, it } from 'vitest';
import { getRecipe, RECIPES } from '../data/recipes';
import { getFood } from '../data/foods';
import { emptyState } from '../store/persistence';
import { atHome, cookableRecipes, cookIngredients } from './cookable';
import { dishEntry, ingredientFromFood } from './dishes';
import { recipeAllowed } from './nutrition';
import { slotRepeat } from './repeatMeal';
import type { AppState, CustomDish, LogEntry, PlannedMeal } from './types';
import { pantryEstimate } from './week';

const MON = '2026-09-21';
const TUE = '2026-09-22';
const base = (patch: Partial<AppState> = {}): AppState => ({
  ...emptyState(),
  nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['breakfast', 'lunch', 'dinner'] },
  targets: [{ id: 't', validFrom: '2026-01-01', method: 'formula', kcal: 2400, protein: 150, carbs: 280, fat: 75 }],
  ...patch,
});

describe('"Wie gestern" – what was really eaten in a slot, ready to repeat', () => {
  const eatenMeal: PlannedMeal = { id: 'b', date: MON, slot: 'breakfast', recipeId: 'skyr-bowl', servings: 1.5, status: 'eaten', source: 'suggest' };
  const planEntry: LogEntry = { id: 'pe', date: MON, slot: 'breakfast', loggedAt: `${MON}T08:00:00Z`, name: 'Skyr-Bowl', plannedMealId: 'b', recipeId: 'skyr-bowl', servings: 1.5, method: 'plan', macros: { kcal: 600, protein: 50, carbs: 50, fat: 15 } };
  const banana: LogEntry = { id: 'x', date: MON, slot: 'breakfast', loggedAt: `${MON}T08:05:00Z`, name: 'Bananen', foodId: 'banana', grams: 120, method: 'food', macros: { kcal: 112, protein: 1.4, carbs: 24, fat: 0.2 } };

  it('eaten planned meals come back as their recipe (same servings), free entries as their snapshot – the plan entry is not doubled', () => {
    const r = slotRepeat({ plannedMeals: [eatenMeal], logEntries: [planEntry, banana] }, MON, 'breakfast');
    expect(r.items.map((i) => i.kind)).toEqual(['recipe', 'entry']);
    expect(r.items[0]).toMatchObject({ kind: 'recipe', recipeId: 'skyr-bowl', servings: 1.5, name: getRecipe('skyr-bowl')!.title });
    const copy = r.items[1]!;
    expect(copy.kind === 'entry' && copy.content).toEqual({ name: 'Bananen', foodId: 'banana', grams: 120, method: 'food', macros: banana.macros });
    expect(r.macros.kcal).toBe(r.items[0]!.macros.kcal + 112);
  });

  it('planned-but-not-eaten or skipped meals are not repeated; an empty slot gives nothing', () => {
    const planned = { ...eatenMeal, status: 'planned' as const };
    expect(slotRepeat({ plannedMeals: [planned, { ...eatenMeal, id: 's', status: 'skipped' }], logEntries: [] }, MON, 'breakfast').items).toEqual([]);
    expect(slotRepeat({ plannedMeals: [], logEntries: [banana] }, MON, 'lunch').items).toEqual([]);
  });
});

describe('"Was kann ich kochen?" – ranked by what is at home', () => {
  it('fewest missing ingredients first; only recipes using something at home; diet filters stay hard', () => {
    const s = base();
    const have = new Set(['egg', 'spinach', 'feta', 'tomato', 'onion', 'bell-pepper']);
    const options = cookableRecipes(s, TUE, have);
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) expect(o.have.length).toBeGreaterThan(0);
    for (let i = 1; i < options.length; i++) expect(options[i - 1]!.score).toBeLessThanOrEqual(options[i]!.score);
    // The best one uses the most of what is at home relative to what it needs.
    expect(options[0]!.missing.length).toBeLessThanOrEqual(Math.min(...options.map((o) => o.missing.length)) + 1);
    const vegan = base({ nutritionProfile: { diet: 'vegan', excluded: [], slots: ['breakfast', 'lunch', 'dinner'] } });
    for (const o of cookableRecipes(vegan, TUE, have)) expect(recipeAllowed(o.recipe, vegan.nutritionProfile)).toBe(true);
  });

  it('a recipe with everything at home says so (no missing), and recipes over today\'s time budget are ranked lower', () => {
    const recipe = RECIPES.find((r) => r.prepMin > 15 && recipeAllowed(r, base().nutritionProfile))!;
    const have = new Set(recipe.ingredients.map((i) => i.foodId));
    const normal = cookableRecipes(base(), TUE, have).find((o) => o.recipe.id === recipe.id)!;
    expect(normal.missing).toEqual([]);
    expect(normal.coverage).toBe(1);
    const busy = cookableRecipes(base({ dayContexts: { [TUE]: { timeBudget: 'low', mode: 'normal' } } }), TUE, have).find((o) => o.recipe.id === recipe.id)!;
    expect(busy.fitsTime).toBe(false);
    expect(busy.score).toBeGreaterThan(normal.score);
  });

  it('nothing chosen → nothing suggested; the pantry preselects what is really there; choices are recipe ingredients', () => {
    expect(cookableRecipes(base(), TUE, new Set())).toEqual([]);
    const s = base({ pantry: { egg: { foodId: 'egg', quantityG: 300, updatedAt: `${MON}T08:00:00Z` }, rice: { foodId: 'rice', quantityG: 0, updatedAt: `${MON}T08:00:00Z` } } });
    expect(atHome(s)).toEqual(['egg']); // 0 g = used up, not "at home"
    expect(cookIngredients(s)).toContain('egg');
    expect(cookIngredients(s).every((id) => getFood(id))).toBe(true);
  });
});

describe('own dishes and the pantry', () => {
  it('logging an own dish takes its catalog ingredients from the pantry (like a recipe)', () => {
    const dish: CustomDish = { id: 'd', name: 'Omelette', portions: 1, ingredients: [ingredientFromFood(getFood('egg')!, 120, 'a')], createdAt: MON, updatedAt: MON };
    const e: LogEntry = { id: 'e', date: TUE, slot: 'breakfast', loggedAt: `${TUE}T08:00:00Z`, ...dishEntry(dish, 1) };
    const s = base({ pantry: { egg: { foodId: 'egg', quantityG: 360, updatedAt: `${MON}T08:00:00Z` } }, logEntries: [e] });
    expect(pantryEstimate(s).egg).toBe(240);
    // "Nicht aus dem Vorrat" stays respected.
    expect(pantryEstimate({ ...s, logEntries: [{ ...e, fromPantry: false }] }).egg).toBe(360);
  });
});
