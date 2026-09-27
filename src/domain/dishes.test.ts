import { afterEach, describe, expect, it } from 'vitest';
import { FOOD_DB } from '../data/foodDb';
import { getFood } from '../data/foods';
import { emptyState } from '../store/persistence';
import { loadFoodDb, matchesQuery, normalizeSearch, searchFoodDb, searchProducts, setSearchFetcher } from '../services/foodDatabase';
import { catalogPrice } from './costs';
import { dbFoodEntry, dishCostRange, dishEntry, dishNutrition, dishPortionNutrition, ingredientFromDb, ingredientFromFood, ingredientFromProduct, validateDish } from './dishes';
import { summarizeEntries } from './nutrition';
import type { AppState, CustomDish, LogEntry, Product } from './types';
import { weekFoodCost } from './week';

/**
 * Own dishes: every value comes from the ingredients (one calculation),
 * portions scale it, unknown stays unknown, a logged entry is a snapshot.
 */

const MON = '2026-09-21';
const db = (id: string) => FOOD_DB.find((f) => f.id === `fdc:${id}`)!;
const feta = getFood('feta')!;
const bread = getFood('bread')!;
const melon = db('watermelon');

const sandwich = (patch: Partial<CustomDish> = {}): CustomDish => ({
  id: 'd1',
  name: 'Melonen-Sandwich',
  portions: 1,
  ingredients: [ingredientFromDb(melon, 100, 'i1'), ingredientFromFood(feta, 80, 'i2'), ingredientFromFood(bread, 100, 'i3')],
  createdAt: `${MON}T08:00:00Z`,
  updatedAt: `${MON}T08:00:00Z`,
  ...patch,
});

describe('own dishes – nutrients from the ingredients', () => {
  it('sums kcal and macros exactly from the per-100 g values', () => {
    const n = dishNutrition(sandwich().ingredients);
    const expected = (k: 'kcal' | 'protein' | 'carbs' | 'fat') => melon.per100[k] + feta.per100[k] * 0.8 + bread.per100[k];
    expect(n.macros.kcal).toBe(Math.round(expected('kcal')));
    // Rounded to 0.1 g once, at the end.
    for (const k of ['protein', 'carbs', 'fat'] as const) expect(Math.abs(n.macros[k] - expected(k))).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(n.unknown).toEqual([]);
  });

  it('portions: half a portion is half of everything; a dish of 2 portions gives half per portion', () => {
    const whole = dishPortionNutrition(sandwich(), 1).macros;
    const half = dishPortionNutrition(sandwich(), 0.5).macros;
    expect(Math.abs(half.kcal - whole.kcal / 2)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(half.protein - whole.protein / 2)).toBeLessThanOrEqual(0.1);
    expect(dishPortionNutrition(sandwich({ portions: 2 }), 1).macros).toEqual(half);
  });

  it('fiber, sugar, salt and vitamins only when EVERY ingredient has them – never a partial sum, never 0', () => {
    const n = dishNutrition(sandwich().ingredients);
    // All three sources have vitamin C and sodium/salt …
    expect(n.micros.vitaminC).toBeDefined();
    expect(n.micros.salt).toBeDefined();
    // … the catalog has no vitamin E for "Vollkornbrot"? then it is unknown for the dish – not the sum of the others.
    for (const key of ['vitaminE', 'sugar'] as const) {
      const allHave = sandwich().ingredients.every((i) => i.micros100?.[key] !== undefined);
      expect(n.micros[key] !== undefined).toBe(allHave);
    }
    const noData: Product = { barcode: '1', name: 'Sauce', per100: { kcal: 100, protein: 1, carbs: 10, fat: 5 }, micros100: {}, unit: 'g', source: 'openfoodfacts', fetchedAt: MON };
    const withSauce = dishNutrition([...sandwich().ingredients, ingredientFromProduct(noData, 20, 'i4')!]);
    expect(withSauce.micros).toEqual({});
  });

  it('a product without protein makes protein "unknown" (like a product entry), kcal still counts', () => {
    const p: Product = { barcode: '2', name: 'Sirup', per100: { kcal: 250, carbs: 60 }, micros100: {}, unit: 'ml', source: 'openfoodfacts', fetchedAt: MON };
    const n = dishNutrition([ingredientFromProduct(p, 40, 'x')!]);
    expect(n.macros.kcal).toBe(100);
    expect(n.unknown).toEqual(['protein', 'fat']);
    // A product without kcal cannot be an ingredient of a computed dish.
    expect(ingredientFromProduct({ ...p, per100: { protein: 3 } }, 40, 'y')).toBeUndefined();
  });

  it('validation: name, at least one ingredient with an amount, portions', () => {
    expect(validateDish({ name: ' ', portions: 1, ingredients: [] })).toEqual({ name: expect.any(String), ingredients: expect.any(String) });
    expect(validateDish({ name: 'X', portions: 0, ingredients: [ingredientFromFood(feta, 0, 'a')] })).toEqual({ ingredients: expect.any(String), portions: expect.any(String) });
    expect(validateDish({ name: 'X', portions: 1, ingredients: [ingredientFromFood(feta, 50, 'a')] })).toEqual({});
  });

  it('the log entry is a snapshot: editing the dish later does not change it', () => {
    const dish = sandwich();
    const entry = dishEntry(dish, 1);
    const snapshot = structuredClone(entry);
    dish.ingredients[1]!.grams = 200; // edited later
    dish.name = 'Anders';
    expect(entry).toEqual(snapshot);
    expect(entry).toMatchObject({ method: 'dish', dishId: 'd1', servings: 1, unit: 'portion', name: 'Melonen-Sandwich' });
    expect(dishEntry(dish, 1).macros.kcal).toBeGreaterThan(entry.macros.kcal);
  });

  it('prices: the central cost logic – catalog-linked ingredients priced, the rest counts as unpriced weight', () => {
    // 180 of 280 g are catalog foods with a price (64 %) – below the 80 % rule: no price is invented.
    expect(dishCostRange(sandwich(), 1, catalogPrice)).toBeUndefined();
    const catalogOnly = sandwich({ ingredients: [ingredientFromFood(feta, 80, 'a'), ingredientFromFood(bread, 100, 'b')] });
    const cost = dishCostRange(catalogOnly, 1, catalogPrice)!;
    expect(cost.lowChf).toBeGreaterThan(0);
    expect(cost.lowChf).toBeLessThanOrEqual(cost.highChf);
  });

  it('a logged dish counts in the week budget once – through its ingredients', () => {
    const catalogOnly = sandwich({ ingredients: [ingredientFromFood(feta, 80, 'a'), ingredientFromFood(bread, 100, 'b')] });
    const e: LogEntry = { id: 'e', date: MON, slot: 'lunch', loggedAt: `${MON}T12:00:00Z`, ...dishEntry(catalogOnly, 1) };
    const s: AppState = { ...emptyState(), logEntries: [e] };
    const cost = weekFoodCost(s, MON)!;
    expect(cost).toEqual(dishCostRange(catalogOnly, 1, catalogPrice));
  });

  it('logged dishes count in the day summary with their known micronutrients', () => {
    const e: LogEntry = { id: 'e', date: MON, slot: 'lunch', loggedAt: `${MON}T12:00:00Z`, ...dishEntry(sandwich(), 1) };
    const s = summarizeEntries([e]);
    expect(s.macros.kcal).toBe(e.macros.kcal);
    expect(s.micros.vitaminC.known).toBe(1);
  });
});

describe('extended food database (FoodData Central, CC0)', () => {
  it('every entry has kcal, protein, carbs and fat; ids and names are unique; no negative values', () => {
    expect(FOOD_DB.length).toBeGreaterThanOrEqual(150);
    expect(new Set(FOOD_DB.map((f) => f.id)).size).toBe(FOOD_DB.length);
    expect(new Set(FOOD_DB.map((f) => f.name)).size).toBe(FOOD_DB.length);
    for (const f of FOOD_DB) {
      for (const k of ['kcal', 'protein', 'carbs', 'fat'] as const) expect(f.per100[k]).toBeGreaterThanOrEqual(0);
      for (const v of Object.values(f.micros)) expect(v).toBeGreaterThanOrEqual(0);
      expect(f.fdc).toBeGreaterThan(100000);
    }
  });

  it('enriched (US-fortified) products carry no iron / B vitamins / calcium – unknown instead of wrong', () => {
    const enriched = FOOD_DB.filter((f) => f.enriched);
    expect(enriched.length).toBeGreaterThan(0);
    for (const f of enriched) for (const k of ['iron', 'vitaminB1', 'vitaminB9', 'calcium'] as const) expect(f.micros).not.toHaveProperty(k);
  });

  it('values are the source values (spot check: raw pear, FDC 169118)', () => {
    expect(db('pear')).toMatchObject({ fdc: 169118, per100: { kcal: 57, protein: 0.36, carbs: 15.2, fat: 0.14 }, micros: { fiber: 3.1 } });
  });

  it('a database food logged: scaled macros, salt from sodium, the FDC id kept – no catalog link, no price', () => {
    const e = dbFoodEntry(db('pear'), 200);
    expect(e).toMatchObject({ name: 'Birne', method: 'food', grams: 200, fdc: 169118, macros: { kcal: 114, protein: 0.7, carbs: 30.4, fat: 0.3 } });
    expect(e.micros).toMatchObject({ fiber: 6.2, sodium: 2, salt: 0.01 }); // 2 mg sodium × 2.5 = 0.005 g → 0.01 g (never rounded down to 0)
    expect(e.foodId).toBeUndefined();
  });

  it('is loaded on demand (its own module) and found with German words, umlauts and several words', async () => {
    const foods = await loadFoodDb();
    expect(foods).toBe(FOOD_DB);
    expect(searchFoodDb(foods, 'rüebli').map((f) => f.name)).toContain('Karotten / Rüebli');
    expect(searchFoodDb(foods, 'ruebli').map((f) => f.name)).toContain('Karotten / Rüebli');
    expect(searchFoodDb(foods, 'kase gruy').map((f) => f.name)).toEqual([]);
    expect(searchFoodDb(foods, 'gruyere').map((f) => f.name)).toEqual(['Gruyère']);
    expect(searchFoodDb(foods, 'b')).toEqual([]); // at least 2 letters
    expect(normalizeSearch('Süßkartoffel')).toBe('susskartoffel');
    expect(matchesQuery('Joghurt nature, fettarm', 'joghurt fett')).toBe(true);
  });
});

describe('Open Food Facts text search (explicit, online)', () => {
  afterEach(() => setSearchFetcher(undefined));
  const json = (body: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);

  it('Swiss products first, only products with calories, values normalized like a barcode lookup – no prices', async () => {
    setSearchFetcher(() =>
      json({
        products: [
          { code: '1', product_name: 'Skyr DE', nutriments: { 'energy-kcal_100g': 63, proteins_100g: 11 }, countries_tags: ['en:germany'] },
          { code: '2', product_name: 'Skyr CH', brands: 'Emmi', nutriments: { 'energy-kcal_100g': 65, proteins_100g: 10 }, countries_tags: ['en:switzerland'] },
          { code: '3', product_name: 'Ohne Werte', nutriments: {} },
        ],
      }),
    );
    const r = await searchProducts('skyr');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.products.map((p) => p.name)).toEqual(['Skyr CH', 'Skyr DE']);
    expect(r.products[0]).toMatchObject({ barcode: '2', brand: 'Emmi', per100: { kcal: 65, protein: 10 } });
    expect(r.products[0]).not.toHaveProperty('price');
  });

  it('offline or a server error → a clear message, never an exception', async () => {
    setSearchFetcher(() => Promise.reject(new Error('offline')));
    expect(await searchProducts('skyr')).toEqual({ status: 'error', message: expect.stringMatching(/Keine Verbindung/) });
    setSearchFetcher(() => json({}, false));
    expect((await searchProducts('skyr')).status).toBe('error');
    // Garbage answer: no products, no crash.
    setSearchFetcher(() => json({ products: [{ nutriments: { 'energy-kcal_100g': 'x' } }] }));
    expect(await searchProducts('skyr')).toEqual({ status: 'ok', products: [] });
  });

  it('too short queries do not go online', async () => {
    let called = false;
    setSearchFetcher(() => ((called = true), json({ products: [] })));
    expect(await searchProducts('a')).toEqual({ status: 'ok', products: [] });
    expect(called).toBe(false);
  });
});

