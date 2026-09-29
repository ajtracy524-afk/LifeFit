import { describe, expect, it } from 'vitest';
import { getRecipe } from '../data/recipes';
import { dropLegacyEurBudget, emptyState } from '../store/persistence';
import { catalogPrice, formatChf, formatCostRange, ingredientCostRange, MIN_PRICED_SHARE, priceLookup, recipeCostRange } from './costs';
import { formatChfEstimate, budgetNote } from './explain';
import { EMPTY_MANUAL, manualEntry, productEntry } from './foodEntry';
import type { AppState, LogEntry, PlannedMeal, Product } from './types';
import { weekFoodCost } from './week';

/**
 * Switzerland only: every price and budget is CHF. Real prices the user
 * entered win over catalog estimates; nothing is invented or converted.
 */

const MON = '2026-09-21';
const product = (patch: Partial<Product> = {}): Product => ({
  barcode: '7610000000001',
  name: 'Poulet-Brust',
  per100: { kcal: 110, protein: 23, carbs: 0, fat: 1.5 },
  micros100: {},
  unit: 'g',
  packageSize: 400,
  source: 'openfoodfacts',
  fetchedAt: `${MON}T08:00:00Z`,
  ...patch,
});
const meal = (id: string, recipeId: string, patch: Partial<PlannedMeal> = {}): PlannedMeal => ({ id, date: MON, slot: 'lunch', recipeId, servings: 1, status: 'planned', source: 'suggest', ...patch });
const entry = (patch: Partial<LogEntry>): LogEntry => ({ id: Math.random().toString(36), date: MON, slot: 'snack', loggedAt: `${MON}T15:00:00Z`, name: 'x', method: 'barcode', macros: { kcal: 100, protein: 5, carbs: 10, fat: 3 }, ...patch });
const state = (patch: Partial<AppState> = {}): AppState => ({ ...emptyState(), ...patch });

describe('CHF format', () => {
  it('exact prices: "CHF 4.49", whole francs "CHF 80.–" (Swiss format, currency first)', () => {
    expect(formatChf(4.49)).toBe('CHF 4.49');
    expect(formatChf(4.95)).toBe('CHF 4.95');
    expect(formatChf(80)).toBe('CHF 80.–');
    expect(formatChf(74)).toBe('CHF 74.–');
    expect(formatChf(2.03)).toBe('CHF 2.03');
    expect(formatChf(1.1)).toBe('CHF 1.10');
    expect(formatChf(79.999)).toBe('CHF 80.–'); // rounded to the Rappen first
    expect(formatChf(1250)).toMatch(/^CHF 1.250\.–$/); // Swiss grouping sign
    expect(formatChfEstimate(12.4)).toBe('ca. CHF 12.40');
    for (const v of [0.05, 1, 4.49, 80, 1250]) expect(formatChf(v)).not.toMatch(/€|EUR|USD|GBP/);
  });

  it('ranges: "ca. CHF 2–3", decimals with a point, small amounts honest', () => {
    expect(formatCostRange({ lowChf: 2, highChf: 3 })).toBe('ca. CHF 2–3');
    expect(formatCostRange({ lowChf: 1.5, highChf: 2 })).toBe('ca. CHF 1.5–2');
    expect(formatCostRange({ lowChf: 0.5, highChf: 1 })).toBe('unter CHF 1.–');
  });

  it('budget note speaks CHF', () => {
    expect(budgetNote({ lowChf: 45, highChf: 50 }, 55, 'balanced')).toBe('Passt in dein Budget von CHF 55.–.');
    expect(budgetNote({ lowChf: 65, highChf: 70 }, 55, 'balanced')).toMatch(/CHF 55\.–/);
  });
});

describe('product prices', () => {
  it('without price: no cost on the entry – nothing invented', () => {
    expect(productEntry(product(), 200)).not.toHaveProperty('costChf');
  });

  it('with price: value of the eaten amount to the Rappen (CHF 4.95 for 400 g, 200 g eaten → CHF 2.48)', () => {
    const e = productEntry(product({ price: { chf: 4.95, amount: 400, at: `${MON}T09:00:00Z` } }), 200)!;
    expect(e.costChf).toBe(2.48);
    expect(formatChf(e.costChf!)).toBe('CHF 2.48');
    // A tiny real amount is never shown as 0.00 CHF.
    const tiny = productEntry(product({ price: { chf: 4.95, amount: 400, at: `${MON}T09:00:00Z` } }), 1)!;
    expect(tiny.costChf).toBe(0.01);
    expect(formatChf(0.01)).toBe('unter CHF 0.05');
  });

  it('the latest real price of a linked product replaces the catalog estimate for that food', () => {
    const lookup = priceLookup({
      a: product({ barcode: 'a', foodId: 'chicken', price: { chf: 8, amount: 400, at: `${MON}T08:00:00Z` } }),
      b: product({ barcode: 'b', foodId: 'chicken', price: { chf: 12, amount: 400, at: `${MON}T10:00:00Z` } }),
      c: product({ barcode: 'c', price: { chf: 1, amount: 100, at: `${MON}T10:00:00Z` } }), // not linked → no effect
    });
    expect(lookup('chicken')).toEqual({ perKgChf: 30, exact: true });
    expect(lookup('rice')).toEqual(catalogPrice('rice'));
    expect(catalogPrice('whey')).toBeUndefined();
  });
});

describe('cost ranges and the 80 % rule', () => {
  it('a recipe with full estimates gets a CHF range', () => {
    const r = recipeCostRange(getRecipe('chili')!, 1)!;
    expect(formatCostRange(r)).toMatch(/^ca\. CHF [\d.]+–[\d.]+$/);
  });

  it('missing prices: below 80 % priced weight → no number; at 80 % → a number', () => {
    // Whey has no price estimate: 79 % priced hides, 80 % shows.
    expect(ingredientCostRange([{ foodId: 'whey', grams: 21 }, { foodId: 'rice', grams: 79 }])).toBeUndefined();
    expect(ingredientCostRange([{ foodId: 'whey', grams: 20 }, { foodId: 'rice', grams: 80 }])).toBeDefined();
    expect(MIN_PRICED_SHARE).toBe(0.8);
  });

  it('real prices count exactly, estimates with a margin', () => {
    const real = ingredientCostRange([{ grams: 400, exactChf: 10 }])!;
    expect(real).toEqual({ lowChf: 10, highChf: 11 });
    const est = ingredientCostRange([{ foodId: 'chicken', grams: 400 }])!; // 11.20 CHF estimate
    expect(est.lowChf).toBeLessThan(11.2);
    expect(est.highChf).toBeGreaterThan(11.2);
  });

  it('suggestion costs use the same price source', () => {
    const lookup = priceLookup({ a: product({ foodId: 'chicken', price: { chf: 4, amount: 400, at: `${MON}T08:00:00Z` } }) });
    const withReal = recipeCostRange(getRecipe('chicken-rice-bowl')!, 1, lookup)!;
    const estimated = recipeCostRange(getRecipe('chicken-rice-bowl')!, 1)!;
    expect(withReal.highChf).toBeLessThan(estimated.highChf);
  });
});

describe('weekly budget (one calculation for Heute and Ernährung)', () => {
  it('estimates only', () => {
    expect(weekFoodCost(state({ plannedMeals: [meal('a', 'chili')] }), MON)).toBeDefined();
  });

  it('real prices lower the range for the linked food', () => {
    const base = state({ plannedMeals: [meal('a', 'chicken-rice-bowl')] });
    const cheap = { ...base, products: { a: product({ foodId: 'chicken', price: { chf: 4, amount: 400, at: `${MON}T08:00:00Z` } }) } };
    expect(weekFoodCost(cheap, MON)!.highChf).toBeLessThan(weekFoodCost(base, MON)!.highChf);
  });

  it('mixed: plan estimates + a replacement product with a real price – the skipped meal no longer counts', () => {
    const planned = state({ plannedMeals: [meal('a', 'chili')] });
    const replaced = state({
      plannedMeals: [meal('a', 'chili', { status: 'skipped' })],
      logEntries: [entry({ replacedMealId: 'a', grams: 300, costChf: 3.5, barcode: '1' })],
    });
    expect(weekFoodCost(replaced, MON)).toEqual({ lowChf: 3.5, highChf: 4 });
    expect(weekFoodCost(planned, MON)!.lowChf).toBeGreaterThan(3.5);
  });

  it('unpriced products count as unpriced weight – with too much of it the budget hides', () => {
    const s = state({ plannedMeals: [meal('a', 'protein-shake')], logEntries: [entry({ grams: 2000 })] });
    expect(weekFoodCost(s, MON)).toBeUndefined();
  });

  it('other weeks and planned meals of the plan-log pair are not counted twice', () => {
    const eaten = meal('a', 'chili', { status: 'eaten' });
    const s = state({ plannedMeals: [eaten], logEntries: [entry({ plannedMealId: 'a', grams: 500, costChf: 99 }), entry({ date: '2026-09-29', grams: 500, costChf: 99 })] });
    expect(weekFoodCost(s, MON)!.highChf).toBeLessThan(20);
  });
});

describe('eaten so far ("bisher gegessen")', () => {
  it('counts only eaten meals and entries up to the given day – planned and later ones not', () => {
    const s = state({
      plannedMeals: [
        meal('a', 'chili', { status: 'eaten' }),
        meal('b', 'bolognese'), // planned, not eaten
        meal('c', 'chili', { date: '2026-09-23', status: 'eaten' }), // after the day
      ],
      logEntries: [entry({ costChf: 2.5, grams: 100 }), entry({ date: '2026-09-23', costChf: 9, grams: 100 })],
    });
    const eaten = weekFoodCost(s, MON, { eatenUntil: MON })!;
    const onlyChili = weekFoodCost(state({ plannedMeals: [meal('a', 'chili', { status: 'eaten' })] }), MON)!;
    expect(eaten.lowChf).toBeGreaterThanOrEqual(onlyChili.lowChf + 2);
    expect(eaten.highChf).toBeLessThanOrEqual(onlyChili.highChf + 3);
    // The full week is more than what was eaten so far.
    expect(weekFoodCost(s, MON)!.highChf).toBeGreaterThan(eaten.highChf);
  });

  it('nothing eaten yet → no "bisher" number', () => {
    expect(weekFoodCost(state({ plannedMeals: [meal('a', 'chili')] }), MON, { eatenUntil: MON })).toBeUndefined();
  });
});

describe('manual prices', () => {
  it('an optional price becomes the real cost of exactly this entry; empty stays "no price"', () => {
    const withPrice = manualEntry({ ...EMPTY_MANUAL, name: 'Pizza', amount: '1', unit: 'portion', kcal: '900', price: '18.50' });
    const without = manualEntry({ ...EMPTY_MANUAL, name: 'Pizza', kcal: '900' });
    expect(withPrice.ok && withPrice.entry.costChf).toBe(18.5);
    expect(without.ok && without.entry).not.toHaveProperty('costChf');
  });

  it('rejects negative, zero-like or non-numeric prices and invalid amounts', () => {
    for (const price of ['-2', '0', 'gratis', '0.01', '5000']) {
      const r = manualEntry({ ...EMPTY_MANUAL, name: 'x', kcal: '100', price });
      expect(r.ok ? 'ok' : r.errors.price).toMatch(/^Bitte einen Preis zwischen CHF 0.05 und CHF 1.000.– angeben.$/);
    }
    for (const amount of ['0', '-100', 'viel']) {
      const r = manualEntry({ ...EMPTY_MANUAL, name: 'x', kcal: '100', amount });
      expect(r.ok ? 'ok' : r.errors.amount).toBe('Bitte prüfe die Menge.');
    }
    expect(manualEntry({ ...EMPTY_MANUAL, name: 'x', kcal: '100', price: '4,95' }).ok).toBe(true); // comma or point
  });

  it('a real price without a weight ("1 Portion") still counts in the week – exactly, without changing the 80 % rule', () => {
    const s = state({ logEntries: [entry({ method: 'manual', grams: undefined, costChf: 18.5 })] });
    expect(weekFoodCost(s, MON)).toEqual({ lowChf: 18, highChf: 19 });
    // Next to a planned week the real amount is added to the estimate range.
    const planned = state({ plannedMeals: [meal('a', 'chili')] });
    const both = { ...planned, logEntries: s.logEntries };
    expect(weekFoodCost(both, MON)!.lowChf).toBeGreaterThanOrEqual(weekFoodCost(planned, MON)!.lowChf + 18);
  });
});

describe('Swiss-only data', () => {
  it('an old EUR budget is neither converted nor reused as CHF – it is dropped, the budget is back at its CHF default', () => {
    const old = { ...emptyState(), plannerSettings: { ...emptyState().plannerSettings, weeklyBudgetEur: 55 } } as unknown as AppState;
    const s = dropLegacyEurBudget(old);
    expect(s.plannerSettings.weeklyBudgetChf).toBeUndefined();
    expect(s.plannerSettings).not.toHaveProperty('weeklyBudgetEur');
    // Everything else of the settings stays.
    expect(s.plannerSettings.mealTimes).toEqual(old.plannerSettings.mealTimes);
  });

  it('a CHF budget next to a leftover EUR field keeps the CHF value – the EUR field never wins', () => {
    const mixed = { ...emptyState(), plannerSettings: { ...emptyState().plannerSettings, weeklyBudgetChf: 70, weeklyBudgetEur: 55 } } as unknown as AppState;
    expect(dropLegacyEurBudget(mixed).plannerSettings.weeklyBudgetChf).toBe(70);
  });

  it('data without legacy fields is returned unchanged (same object)', () => {
    const s = emptyState();
    expect(dropLegacyEurBudget(s)).toBe(s);
  });
});
