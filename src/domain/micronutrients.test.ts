import { describe, expect, it } from 'vitest';
import { FOOD_MICROS } from '../data/foodMicros';
import { getFood } from '../data/foods';
import { NUTRIENTS } from '../data/nutrients';
import { EMPTY_MANUAL, manualEntry, productEntry } from './foodEntry';
import { daySummary, logFromMeal, summarizeEntries, VITAL_NUTRIENTS } from './nutrition';
import type { LogEntry, PlannedMeal, Product } from './types';

/**
 * Micronutrients of a day come from what was EATEN (log entries) – the same
 * summary as the macros. Unknown stays unknown: never 0, never estimated.
 */

const MON = '2026-09-21';
const product = (patch: Partial<Product> = {}): Product => ({
  barcode: '1',
  name: 'Skyr',
  per100: { kcal: 60, protein: 11, carbs: 4, fat: 0.2 },
  micros100: { calcium: 110, sodium: 36, vitaminB12: 0.4 },
  unit: 'g',
  source: 'openfoodfacts',
  fetchedAt: `${MON}T08:00:00Z`,
  ...patch,
});
const asEntry = (content: ReturnType<typeof productEntry>, patch: Partial<LogEntry> = {}): LogEntry => ({
  id: Math.random().toString(36),
  date: MON,
  slot: 'breakfast',
  loggedAt: `${MON}T08:00:00Z`,
  ...content!,
  ...patch,
});
const plan = (recipeId: string, servings = 1): PlannedMeal => ({ id: 'p', date: MON, slot: 'lunch', recipeId, servings, status: 'eaten', source: 'suggest' });

describe('micronutrients from eaten entries', () => {
  it('an empty day knows nothing – every nutrient is "no data", not 0', () => {
    const s = summarizeEntries([]);
    for (const k of VITAL_NUTRIENTS) expect(s.micros[k]).toEqual({ value: 0, known: 0, of: 0 });
  });

  it('one product: values scale with the eaten amount (250 g of 110 mg/100 g calcium → 275 mg)', () => {
    const s = summarizeEntries([asEntry(productEntry(product(), 250))]);
    expect(s.micros.calcium).toEqual({ value: 275, known: 1, of: 1 });
    expect(s.micros.vitaminB12).toEqual({ value: 1, known: 1, of: 1 });
    expect(s.micros.sodium.value).toBe(90);
  });

  it('several products add up', () => {
    const a = asEntry(productEntry(product(), 100));
    const b = asEntry(productEntry(product({ barcode: '2', micros100: { calcium: 120, iron: 2 } }), 200));
    const s = summarizeEntries([a, b]);
    expect(s.micros.calcium).toEqual({ value: 350, known: 2, of: 2 });
    expect(s.micros.iron).toEqual({ value: 4, known: 1, of: 2 });
  });

  it('a recipe brings vitamins and minerals from the catalog (FoodData Central), scaled by servings – salt/sodium never summed', () => {
    const one = logFromMeal(plan('chili', 1)).micros!;
    const s = summarizeEntries([logFromMeal(plan('chili', 1.5))]);
    expect(s.micros.fiber.known).toBe(1);
    expect(s.micros.fiber.value).toBeCloseTo(one.fiber! * 1.5, 0);
    // Every chili ingredient has iron, potassium and vitamin C in the source.
    for (const k of ['iron', 'potassium', 'vitaminC'] as const) {
      expect(s.micros[k].known).toBe(1);
      expect(s.micros[k].value).toBeCloseTo(one[k]! * 1.5, 0);
    }
    // Cooking salt is not in the recipe data – so salt and sodium stay unknown, not a too-low sum.
    expect(s.micros.salt.known).toBe(0);
    expect(s.micros.sodium.known).toBe(0);
  });

  it('one ingredient without data (whey, berry mix) makes the recipe value unknown – never 0, never guessed', () => {
    const oats = logFromMeal(plan('overnight-oats'));
    expect(oats.micros ?? {}).toEqual({});
    const s = summarizeEntries([oats]);
    for (const k of VITAL_NUTRIENTS) expect(s.micros[k]).toEqual({ value: 0, known: 0, of: 1 });
  });

  it('catalog values are copied from the source with their FoodData Central id; salt follows sodium × 2.5', () => {
    expect(FOOD_MICROS.broccoli).toMatchObject({ fdc: 170379, vitaminC: 89.2, calcium: 47 });
    expect(getFood('broccoli')!.micros).toMatchObject({ vitaminC: 89.2, sodium: 33, salt: 0.08 });
    // Unknown in the source → left out, not 0 (oats list no vitamin E in SR Legacy).
    expect(getFood('oats')!.micros).not.toHaveProperty('vitaminE');
    expect(getFood('whey')!.micros).toBeUndefined();
    expect(getFood('wrap')!.micros).toEqual({ fiber: 3 });
  });

  it('manual entry: salt given → sodium follows exactly (salt = sodium × 2.5), nothing else invented', () => {
    const r = manualEntry({ ...EMPTY_MANUAL, name: 'Suppe', kcal: '200', salt: '2,5' });
    if (!r.ok) throw new Error('invalid');
    expect(r.entry.micros).toEqual({ salt: 2.5, sodium: 1000 });
    const s = summarizeEntries([asEntry(r.entry)]);
    expect(s.micros.calcium.known).toBe(0);
    expect(s.micros.sodium).toEqual({ value: 1000, known: 1, of: 1 });
  });

  it('partial data is reported as partial – a sum over 1 of 3 entries is not presented as complete', () => {
    // Both recipes contain an ingredient without data (whey / berry mix) → no calcium from them.
    const s = summarizeEntries([asEntry(productEntry(product(), 100)), logFromMeal(plan('overnight-oats')), logFromMeal(plan('skyr-bowl'))]);
    expect(s.micros.calcium).toEqual({ value: 110, known: 1, of: 3 });
  });

  it('skipped meals have no entry, a replacement is one entry – counted exactly once', () => {
    // What the store writes on "Ersetzen": the old meal skipped (no entry), one replacement entry.
    const replacement = asEntry(productEntry(product(), 200), { replacedMealId: 'p', slot: 'lunch' });
    const { day, slots } = daySummary([replacement], MON);
    expect(day.micros.calcium).toEqual({ value: 220, known: 1, of: 1 });
    expect(slots.lunch.micros.calcium.value).toBe(220);
  });

  it('sodium: products only from the source data – a product with salt but without sodium has NO sodium', () => {
    const saltOnly = productEntry(product({ micros100: { salt: 1.2 } }), 100)!;
    expect(saltOnly.micros).toEqual({ salt: 1.2 });
    expect(summarizeEntries([asEntry(saltOnly)]).micros.sodium.known).toBe(0);
  });

  it('sodium: manual entries only with a typed salt value; no salt → sodium unknown (not 0), salt 0 → sodium 0', () => {
    const none = manualEntry({ ...EMPTY_MANUAL, name: 'Brot', kcal: '250' });
    const zero = manualEntry({ ...EMPTY_MANUAL, name: 'Wasser-Eis', kcal: '20', salt: '0' });
    if (!none.ok || !zero.ok) throw new Error('invalid');
    expect(none.entry.micros).toBeUndefined();
    expect(zero.entry.micros).toEqual({ salt: 0, sodium: 0 });
  });

  it('planned (not yet eaten) meals never count – only log entries do', () => {
    // A planned meal has no log entry until it is eaten; the summary only reads entries.
    const s = daySummary([], MON);
    expect(s.day.entries).toBe(0);
    for (const k of VITAL_NUTRIENTS) expect(s.day.micros[k].known).toBe(0);
  });

  it('portions: a product amount scales every declared value linearly', () => {
    const p = product({ micros100: { calcium: 120, vitaminC: 30, iron: 1.5 } });
    const half = summarizeEntries([asEntry(productEntry(p, 50))]).micros;
    const double = summarizeEntries([asEntry(productEntry(p, 200))]).micros;
    expect([half.calcium.value, half.vitaminC.value, half.iron.value]).toEqual([60, 15, 0.75]);
    expect([double.calcium.value, double.vitaminC.value, double.iron.value]).toEqual([240, 60, 3]);
  });

  it('other days never leak into the day', () => {
    const other = asEntry(productEntry(product(), 100), { date: '2026-09-22' });
    expect(daySummary([other], MON).day.micros.calcium.known).toBe(0);
  });

  it('every vitamin/mineral has a unit; NRVs are the labelling values (e.g. vitamin C 80 mg, iron 14 mg)', () => {
    for (const k of VITAL_NUTRIENTS) expect(['mg', 'µg']).toContain(NUTRIENTS[k].unit);
    expect(NUTRIENTS.vitaminC.nrv).toBe(80);
    expect(NUTRIENTS.iron.nrv).toBe(14);
    expect(NUTRIENTS.calcium.nrv).toBe(800);
    expect(NUTRIENTS.sodium.nrv).toBeUndefined();
  });
});
