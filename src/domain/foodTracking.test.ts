import { describe, expect, it } from 'vitest';
import { emptyState } from '../store/persistence';
import { EMPTY_MANUAL, manualEntry, manualFromProduct, productAmountOptions, productEntry, productNutrients, suggestCatalogFoods } from './foodEntry';
import { daySummary, logFromMeal, summarizeEntries } from './nutrition';
import { weekStats } from './progress';
import type { AppState, LogEntry, PlannedMeal, Product } from './types';
import { addWater, formatLitres, waterHistory, waterOn, waterStartValue, WATER_MAX_ML } from './water';
import { applyWeekChange, buildWeekPlan, pantryEstimate, shoppingCost, weekShopping } from './week';

/**
 * Food tracking: scanned and manual entries become ordinary log entries.
 * Nothing invented, nothing counted twice, the week plan stays the source.
 */

const MON = '2026-09-21';
const NOW = new Date(`${MON}T12:00:00`);

const product = (patch: Partial<Product> = {}): Product => ({
  barcode: '4000000000009',
  name: 'Testmüsli',
  brand: 'Marke',
  per100: { kcal: 220, protein: 8, carbs: 20, fat: 10 },
  micros100: { fiber: 6 },
  unit: 'g',
  servingSize: 40,
  packageSize: 500,
  source: 'openfoodfacts',
  fetchedAt: `${MON}T08:00:00Z`,
  ...patch,
});

const entry = (patch: Partial<LogEntry>): LogEntry => ({
  id: Math.random().toString(36),
  date: MON,
  slot: 'breakfast',
  loggedAt: `${MON}T09:00:00Z`,
  name: 'x',
  method: 'manual',
  macros: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  ...patch,
});

function state(patch: Partial<AppState> = {}): AppState {
  return {
    ...emptyState(),
    profile: { name: 'T', sex: 'male', age: 30, heightCm: 180, activity: 'moderate', experience: 'beginner', createdAt: `${MON}T07:00:00Z` },
    goal: { type: 'maintain', startWeightKg: 80, startedAt: MON },
    nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['breakfast', 'snack', 'lunch', 'dinner'] },
    targets: [{ id: 't', validFrom: MON, method: 'formula', kcal: 2680, protein: 180, carbs: 300, fat: 80 }],
    training: { programId: 'full-body', weekdays: [0, 2, 4] },
    ...patch,
  };
}

describe('barcode product → amount', () => {
  it('converts per-100 values to the eaten amount (250 g → 550 kcal, 20 P, 50 KH, 25 F)', () => {
    expect(productNutrients(product(), 250)).toEqual({ macros: { kcal: 550, protein: 20, carbs: 50, fat: 25 }, micros: { fiber: 15 }, unknown: [] });
  });

  it('offers 100 g, one serving and the package – only if the product states them', () => {
    expect(productAmountOptions(product()).map((o) => o.amount)).toEqual([100, 40, 500]);
    expect(productAmountOptions(product({ servingSize: undefined, packageSize: undefined })).map((o) => o.amount)).toEqual([100]);
  });

  it('missing macros are flagged as unknown (0 in the sum, "–" in the UI) – never guessed', () => {
    const n = productNutrients(product({ per100: { kcal: 300, carbs: 40 } }), 100)!;
    expect(n.macros).toEqual({ kcal: 300, protein: 0, carbs: 40, fat: 0 });
    expect(n.unknown).toEqual(['protein', 'fat']);
  });

  it('without calories the product cannot be logged automatically', () => {
    expect(productNutrients(product({ per100: { protein: 10 } }), 100)).toBeUndefined();
    expect(productEntry(product({ per100: { protein: 10 } }), 100)).toBeUndefined();
    // …and the manual form is pre-filled only with what is known.
    const form = manualFromProduct(product({ per100: { protein: 10 }, micros100: {} }));
    expect(form).toMatchObject({ name: 'Testmüsli', barcode: '4000000000009', kcal: '', protein: '10', fat: '', fiber: '', per: '100' });
  });

  it('a product entry is a normal log entry with barcode, amount and (optional) catalog food', () => {
    expect(productEntry(product(), 40, 'oats')).toMatchObject({ method: 'barcode', barcode: '4000000000009', amount: 40, unit: 'g', grams: 40, foodId: 'oats', macros: { kcal: 88 } });
    expect(productEntry(product(), 40)).not.toHaveProperty('foodId');
  });
});

describe('manual entry', () => {
  it('only calories are required', () => {
    const r = manualEntry({ ...EMPTY_MANUAL, name: 'Brötchen', kcal: '280' });
    expect(r.ok && r.entry).toMatchObject({ name: 'Brötchen', method: 'manual', macros: { kcal: 280 }, unknown: ['protein', 'carbs', 'fat'] });
    expect(r.ok && r.entry.micros).toBeUndefined();
    expect(manualEntry({ ...EMPTY_MANUAL, name: 'x' })).toEqual({ ok: false, errors: { kcal: 'Bitte gib die Kalorien an (0–5000).' } });
  });

  it('values per 100 g are scaled to the amount; empty optional fields stay unknown', () => {
    const r = manualEntry({ ...EMPTY_MANUAL, name: 'Käse', amount: '30', unit: 'g', per: '100', kcal: '350', protein: '25', fat: '28', salt: '1,8' });
    expect(r.ok && r.entry).toMatchObject({ macros: { kcal: 105, protein: 7.5, carbs: 0, fat: 8.4 }, micros: { salt: 0.54 }, unknown: ['carbs'], grams: 30 });
  });

  it('a portion has no weight – nothing can be taken from the pantry', () => {
    const r = manualEntry({ ...EMPTY_MANUAL, name: 'Pizza', amount: '1', unit: 'portion', kcal: '800' });
    expect(r.ok && r.entry.grams).toBeUndefined();
  });

  it('rejects impossible values', () => {
    const r = manualEntry({ ...EMPTY_MANUAL, kcal: '-5', protein: 'viel' });
    expect(r.ok).toBe(false);
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(['kcal', 'protein']);
  });

  it('suggests catalog foods for a name – as a choice, never linked automatically', () => {
    expect(suggestCatalogFoods('Skyr Vanille').map((f) => f.id)).toContain('skyr');
    expect(suggestCatalogFoods('Döner')).toEqual([]);
  });
});

describe('day and meal totals', () => {
  const entries = [
    entry({ slot: 'breakfast', macros: { kcal: 520, protein: 32, carbs: 55, fat: 16 }, micros: { fiber: 8 } }),
    entry({ slot: 'breakfast', macros: { kcal: 100, protein: 0, carbs: 20, fat: 1 }, unknown: ['protein'], micros: { sugar: 12 } }),
    entry({ slot: 'lunch', macros: { kcal: 700, protein: 45, carbs: 80, fat: 20 }, micros: { fiber: 10 } }),
    entry({ slot: 'dinner', date: '2026-09-22', macros: { kcal: 900, protein: 50, carbs: 90, fat: 30 } }),
  ];

  it('sums kcal, protein, carbs and fat per day and per meal slot', () => {
    const { day, slots } = daySummary(entries, MON);
    expect(day.macros).toEqual({ kcal: 1320, protein: 77, carbs: 155, fat: 37 });
    expect(slots.breakfast.macros).toEqual({ kcal: 620, protein: 32, carbs: 75, fat: 17 });
    expect(slots.lunch.macros.kcal).toBe(700);
    expect(slots.dinner.entries).toBe(0);
    expect(slots.snack.macros.kcal).toBe(0);
  });

  it('optional nutrients report how many entries knew them', () => {
    const { day } = daySummary(entries, MON);
    expect(day.micros.fiber).toEqual({ value: 18, known: 2, of: 3 });
    expect(day.micros.sugar).toEqual({ value: 12, known: 1, of: 3 });
    expect(day.micros.salt.known).toBe(0);
    expect(day.incomplete).toBe(1);
  });

  it('a planned meal carries its fiber from the catalog, never sugar or salt', () => {
    const e = logFromMeal({ id: 'm', date: MON, slot: 'breakfast', recipeId: 'overnight-oats', servings: 1, status: 'eaten', source: 'suggest' });
    expect(e.micros?.fiber).toBeGreaterThan(0);
    expect(e.micros).not.toHaveProperty('sugar');
    expect(summarizeEntries([e]).micros.fiber.known).toBe(1);
  });
});

describe('integration with the week plan', () => {
  const planned = (id: string, slot: PlannedMeal['slot'], recipeId: string): PlannedMeal => ({ id, date: MON, slot, recipeId, servings: 1, status: 'planned', source: 'suggest' });

  it('eating outside the plan changes the day balance and the week overview – not the plan', () => {
    const s = state({ plannedMeals: [planned('b', 'breakfast', 'skyr-bowl')], logEntries: [entry({ method: 'barcode', barcode: '1', macros: { kcal: 550, protein: 20, carbs: 50, fat: 25 } })] });
    const week = buildWeekPlan(s, MON, MON);
    expect(week.days[0]!.eaten.kcal).toBe(550);
    expect(week.days[0]!.meals).toEqual(s.plannedMeals);
    expect(weekStats(s, MON).loggedDays).toBe(1);
  });

  it('a linked product eaten from the pantry is subtracted exactly once; "not from the pantry" leaves it', () => {
    const base = state({ pantry: { skyr: { foodId: 'skyr', quantityG: 450, updatedAt: `${MON}T08:00:00Z` } } });
    const eaten = { ...base, logEntries: [entry({ method: 'barcode', foodId: 'skyr', grams: 150 })] };
    expect(pantryEstimate(eaten).skyr).toBe(300);
    const elsewhere = { ...base, logEntries: [entry({ method: 'barcode', foodId: 'skyr', grams: 150, fromPantry: false })] };
    expect(pantryEstimate(elsewhere).skyr).toBe(450);
    // Unlinked products and portions never touch the pantry.
    expect(pantryEstimate({ ...base, logEntries: [entry({ method: 'barcode', grams: 150 })] }).skyr).toBe(450);
  });

  it('eating something never books anything INTO the pantry', () => {
    const s = state({ logEntries: [entry({ method: 'barcode', foodId: 'skyr', grams: 150 })] });
    expect(pantryEstimate(s)).toEqual({});
  });

  it('log entries do not change the budget or the shopping list', () => {
    const s = state({ plannedMeals: [planned('d', 'dinner', 'chicken-rice-bowl')] });
    const before = weekShopping(s, MON, MON);
    const after = weekShopping({ ...s, logEntries: [entry({ method: 'manual', macros: { kcal: 900, protein: 0, carbs: 0, fat: 0 } }), entry({ method: 'barcode', barcode: '1', macros: { kcal: 300, protein: 0, carbs: 0, fat: 0 } })] }, MON, MON);
    expect(after).toEqual(before);
    expect(shoppingCost(after)).toEqual(shoppingCost(before));
  });

  it('"Anders gegessen → Gericht" logs the recipe as eaten and learns it, through the cascade', () => {
    const s = state({ plannedMeals: [{ ...planned('b', 'breakfast', 'skyr-bowl'), status: 'skipped' }] });
    const r = applyWeekChange(s, { type: 'addMeal', date: MON, slot: 'breakfast', recipeId: 'pb-porridge', servings: 1, eaten: true, id: 'x' }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.plannedMeals.find((m) => m.id === 'x')?.status).toBe('eaten');
    expect(r.state.logEntries.filter((e) => e.plannedMealId === 'x')).toHaveLength(1);
    expect(r.state.learning.preferences['recipe:pb-porridge']?.pos).toBe(1);
    // The same id twice is refused – no duplicate entries.
    const again = applyWeekChange(r.state, { type: 'addMeal', date: MON, slot: 'breakfast', recipeId: 'pb-porridge', servings: 1, eaten: true, id: 'x' }, NOW);
    expect(again.ok).toBe(false);
  });

  it('re-planning the week does not refill a slot handled by "Anders gegessen" today', () => {
    const s = state({
      plannedMeals: [{ ...planned('s', 'snack', 'protein-shake'), status: 'skipped' }],
      logEntries: [entry({ slot: 'snack', method: 'food', foodId: 'skyr', grams: 100, name: 'Skyr natur', macros: { kcal: 63, protein: 11, carbs: 4, fat: 0.2 } })],
    });
    const r = applyWeekChange(s, { type: 'planWeek', week: MON, trainingDays: [0, 2, 4], days: {} }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const today = r.state.plannedMeals.filter((m) => m.date === MON);
    expect(today.filter((m) => m.slot === 'snack')).toHaveLength(1); // only the skipped one
    expect(today.filter((m) => m.slot !== 'snack' && m.status === 'planned')).toHaveLength(3);
    // Tomorrow is planned normally, snack included.
    expect(r.state.plannedMeals.some((m) => m.date === '2026-09-22' && m.slot === 'snack')).toBe(true);
  });

  it('eaten meals of the future are refused', () => {
    expect(applyWeekChange(state(), { type: 'addMeal', date: '2026-09-23', slot: 'lunch', recipeId: 'chili', servings: 1, eaten: true }, NOW).ok).toBe(false);
  });
});

describe('water', () => {
  it('+250 / +500 add up, −250 never goes below 0', () => {
    const s = state();
    addWater(s, MON, 250);
    addWater(s, MON, 500);
    expect(waterOn(s, MON)).toBe(750);
    addWater(s, MON, -1000);
    expect(waterOn(s, MON)).toBe(0);
    expect(s.water).toEqual({});
  });

  it('a new day starts at 0 – yesterday stays in the history', () => {
    const s = state();
    addWater(s, MON, 2100);
    addWater(s, '2026-09-22', 500);
    expect(waterHistory(s, [MON, '2026-09-22', '2026-09-23'])).toEqual([
      { date: MON, ml: 2100 },
      { date: '2026-09-22', ml: 500 },
      { date: '2026-09-23', ml: 0 },
    ]);
  });

  it('has a sanity cap against accidental taps', () => {
    const s = state();
    addWater(s, MON, 50_000);
    expect(waterOn(s, MON)).toBe(WATER_MAX_ML);
  });

  it('the starting value is a rounded rule of thumb, only with a body weight', () => {
    expect(waterStartValue(80)).toBe(2750);
    expect(waterStartValue(undefined)).toBeUndefined();
    expect(formatLitres(2500)).toBe('2,5 L');
    expect(formatLitres(2000)).toBe('2 L');
  });
});
