import { describe, expect, it } from 'vitest';
import { FOOD_DB } from '../data/foodDb';
import { FOODS, getFood } from '../data/foods';
import { NUTRIENTS } from '../data/nutrients';
import { RECIPES } from '../data/recipes';
import { emptyState } from '../store/persistence';
import { normalizeOffProduct } from '../services/productLookup';
import { dbFoodMicros } from './dishes';
import { EMPTY_MANUAL, manualEntry, productEntry } from './foodEntry';
import { calculateTargets, logFromMeal, summarizeEntries } from './nutrition';
import { nutrientReport, rate, references, REPORT_RULES, type Reference } from './nutrientReport';
import type { AppState, LogEntry, NutritionTarget } from './types';

const TUE = '2026-09-22';
const target = (kcal: number, protein = 150): NutritionTarget => ({ id: 't', validFrom: '2026-01-01', method: 'formula', kcal, protein, carbs: 250, fat: 70 });
const min = (amount: number): Reference => ({ kind: 'min', amount, unit: 'g', personalized: true, basis: '' });
const max = (amount: number): Reference => ({ kind: 'max', amount, unit: 'g', personalized: false, basis: '' });

describe('personal references – from the person, not one value for all', () => {
  it('kcal, protein, carbs, fat are the day target; fiber and sugar scale with it; salt is the same for adults', () => {
    const small = references(target(1800, 110), undefined);
    const big = references(target(3000, 180), undefined);
    expect(small.protein).toMatchObject({ kind: 'min', amount: 110, personalized: true });
    expect(big.protein!.amount).toBe(180);
    expect(small.fiber!.amount).toBe(25); // 14 g / 1000 kcal
    expect(big.fiber!.amount).toBe(42);
    expect(small.sugar).toMatchObject({ kind: 'max', amount: 81 }); // 90 g × 1800/2000
    expect(big.sugar!.amount).toBe(135);
    expect(small.salt).toEqual(big.salt);
    expect(small.salt).toMatchObject({ kind: 'max', amount: 5, personalized: false });
    expect(small.kcal).toMatchObject({ kind: 'range', amount: 1800, tolerance: 180 });
  });

  it('body weight changes the protein target (via the existing target calculation)', () => {
    const profile = { sex: 'male' as const, age: 30, heightCm: 180, activity: 'moderate' as const };
    const light = calculateTargets(profile, 'muscle_gain', 65, 3);
    const heavy = calculateTargets(profile, 'muscle_gain', 95, 3);
    expect(references({ ...target(light.kcal), ...light }, undefined).protein!.amount).toBe(130);
    expect(references({ ...target(heavy.kcal), ...heavy }, undefined).protein!.amount).toBe(190);
  });

  it('vitamins and minerals use the general labelling reference (NRV) and say so; sodium has the WHO upper value; water only with a goal', () => {
    const r = references(target(2000), undefined);
    expect(r.vitaminC).toMatchObject({ kind: 'min', amount: NUTRIENTS.vitaminC.nrv, personalized: false });
    expect(r.vitaminC!.basis).toMatch(/nicht individuell/);
    expect(r.sodium).toMatchObject({ kind: 'max', amount: 2000 });
    expect(r.water).toBeUndefined();
    expect(references(target(2000), 2500).water).toMatchObject({ kind: 'min', amount: 2500 });
    // Without a target there is no personal reference for energy and macros – not a made-up one.
    expect(references(undefined, undefined).protein).toBeUndefined();
  });
});

describe('rating – three kinds, not one percentage', () => {
  it('minimum (protein): below = still open (orange), reached = green; red only far below on a finished day', () => {
    expect(rate(92, min(120))).toMatchObject({ tone: 'orange', message: 'Noch 28 g' });
    expect(rate(120, min(120))).toMatchObject({ tone: 'green', message: 'Im Zielbereich' });
    expect(rate(40, min(120))).toMatchObject({ tone: 'orange' });
    expect(rate(40, min(120), { finished: true })).toMatchObject({ tone: 'red' });
  });

  it('more is not better: far above a vitamin reference stays green, the bar is capped', () => {
    expect(rate(400, min(80))).toMatchObject({ tone: 'green', message: 'Im Zielbereich', ratio: 1.3 });
  });

  it('upper limit (salt): green well below, orange near the limit, red above – with the words', () => {
    expect(rate(3, max(5)).tone).toBe('green');
    expect(rate(4.2, max(5))).toMatchObject({ tone: 'orange', message: 'nahe an der Obergrenze · noch 0,8 g' });
    expect(rate(5.8, max(5))).toMatchObject({ tone: 'red', message: 'über dem empfohlenen Bereich' });
  });

  it('range (kcal): the calorie zone is green; above twice the tolerance red; below only "open" during the day', () => {
    const kcal = references(target(2000), undefined).kcal!;
    expect(rate(2150, kcal).tone).toBe('green');
    expect(rate(2300, kcal)).toMatchObject({ tone: 'orange', message: '300 kcal über dem Ziel' });
    expect(rate(2500, kcal).tone).toBe('red');
    expect(rate(900, kcal)).toMatchObject({ tone: 'orange', message: 'Noch 1.100 kcal' });
    expect(rate(900, kcal, { finished: true }).tone).toBe('red');
  });

  it('missing and partial data are honest: no data → "keine Daten"; a partial sum below a minimum is not rated', () => {
    expect(rate(undefined, min(30))).toEqual({ tone: 'none', message: 'keine Daten', ratio: 0 });
    expect(rate(12, min(30), { partial: true })).toMatchObject({ tone: 'none', message: 'mind. 12 g – Daten unvollständig' });
    // A partial sum ABOVE a limit is a real fact (the full total can only be higher).
    expect(rate(6, max(5), { partial: true }).tone).toBe('red');
    expect(rate(35, min(30), { partial: true }).tone).toBe('green');
  });
});

describe('report of a day', () => {
  const state = (entries: Partial<LogEntry>[], patch: Partial<AppState> = {}): AppState => ({
    ...emptyState(),
    targets: [target(2000, 120)],
    closedDayTargets: { [TUE]: 2000 },
    logEntries: entries.map((e, i) => ({ id: `e${i}`, date: TUE, slot: 'lunch', loggedAt: `${TUE}T12:00:00Z`, name: 'x', method: 'manual', macros: { kcal: 0, protein: 0, carbs: 0, fat: 0 }, ...e }) as LogEntry),
    ...patch,
  });
  const find = (r: ReturnType<typeof nutrientReport>, key: string) => r.groups.flatMap((g) => g.rows).find((x) => x.key === key)!;

  it('the summary comes from the real values, most relevant first', () => {
    const r = nutrientReport(
      state([{ macros: { kcal: 2050, protein: 125, carbs: 240, fat: 70 }, micros: { salt: 5.8, fiber: 12 } }], { nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['lunch'], waterGoalMl: 2000 }, water: { [TUE]: 1600 } }),
      TUE,
      false,
    );
    expect(r.summary).toEqual(['Salz bereits über dem empfohlenen Bereich.', 'Kalorien im Zielbereich.', 'Protein im Zielbereich.', 'Ballaststoffe noch etwas niedrig (noch 16 g).', 'Wasserziel fast erreicht.']);
    expect(find(r, 'salt')).toMatchObject({ tone: 'red', amount: 5.8 });
    expect(find(r, 'fiber')).toMatchObject({ tone: 'orange', amount: 12, message: 'Noch 16 g' });
  });

  it('nothing logged: no values, no ratings, one honest sentence', () => {
    const r = nutrientReport(state([]), TUE, false);
    expect(r.summary).toEqual(['Noch nichts erfasst – die Auswertung füllt sich mit jeder Mahlzeit.']);
    expect(find(r, 'protein')).toMatchObject({ amount: undefined, tone: 'none', message: 'noch nichts erfasst' });
    expect(find(r, 'vitaminC')).toMatchObject({ amount: undefined, message: 'noch nichts erfasst' });
  });

  it('a vitamin known from only some entries is marked partial – never presented as a complete (or zero) value', () => {
    const r = nutrientReport(state([{ micros: { vitaminC: 30 } }, { micros: {} }]), TUE, false);
    expect(find(r, 'vitaminC')).toMatchObject({ amount: 30, partial: true, tone: 'none' });
    expect(find(r, 'iron')).toMatchObject({ amount: undefined, message: 'keine Daten' });
  });

  it('training day vs rest day: the protein/kcal references follow the day target of that day', () => {
    const base = state([{ macros: { kcal: 1000, protein: 60, carbs: 100, fat: 30 } }]);
    const withTraining = nutrientReport({ ...base, closedDayTargets: { [TUE]: 2150 } }, TUE, false);
    expect(find(withTraining, 'kcal').reference!.amount).toBe(2150);
    expect(find(nutrientReport(base, TUE, false), 'kcal').reference!.amount).toBe(2000);
  });
});

describe('data audit: food → portion → meal → day → reference', () => {
  it('sugar is never above the carbohydrates of the same food (conflicts become "unknown", not a number)', () => {
    for (const f of FOODS) if (f.micros?.sugar !== undefined) expect(f.micros.sugar).toBeLessThanOrEqual(f.per100.carbs + 0.05);
    for (const f of FOOD_DB) {
      const m = dbFoodMicros(f);
      if (m.sugar !== undefined) expect(m.sugar).toBeLessThanOrEqual(f.per100.carbs + 0.05);
    }
    // The conflicts found in the audit: cottage cheese (catalog carbs 1,5 g vs 4 g sugar), gouda (0 g carbs), honey.
    for (const id of ['cottage', 'gouda', 'honey']) expect(getFood(id)!.micros).not.toHaveProperty('sugar');
    expect(dbFoodMicros(FOOD_DB.find((f) => f.id === 'fdc:buttermilk')!)).not.toHaveProperty('sugar');
  });

  it('salt and sodium: salt = sodium × 2.5 everywhere it is derived; a typed salt gives the exact sodium', () => {
    for (const f of FOODS) {
      const m = f.micros;
      if (m?.salt !== undefined && m.sodium !== undefined) expect(m.salt).toBeCloseTo((m.sodium * 2.5) / 1000, 9);
    }
    const r = manualEntry({ ...EMPTY_MANUAL, name: 'Suppe', kcal: '200', salt: '1,5' });
    expect(r.ok && r.entry.micros).toEqual({ salt: 1.5, sodium: 600 });
  });

  it('portion scaling is linear (up to the rounding of the display) for every recipe and every known micronutrient', () => {
    for (const recipe of RECIPES) {
      const one = logFromMeal({ id: 'x', date: TUE, slot: 'lunch', recipeId: recipe.id, servings: 1, status: 'eaten', source: 'suggest' });
      const two = logFromMeal({ id: 'x', date: TUE, slot: 'lunch', recipeId: recipe.id, servings: 2, status: 'eaten', source: 'suggest' });
      expect(Math.abs(two.macros.kcal - 2 * one.macros.kcal)).toBeLessThanOrEqual(1);
      for (const [k, v] of Object.entries(one.micros ?? {})) expect(Math.abs((two.micros as Record<string, number>)[k]! - 2 * v)).toBeLessThanOrEqual(Math.max(0.11, v * 0.04));
      expect(one.micros).not.toHaveProperty('salt'); // cooking salt unknown → not summed
    }
  });

  it('units from Open Food Facts (always grams per 100 g) are converted to mg / µg correctly', () => {
    const p = normalizeOffProduct('1', {
      product_name: 'Test',
      nutriments: { 'energy-kcal_100g': 100, carbohydrates_100g: 10, sugars_100g: 12, salt_100g: 1, sodium_100g: 0.4, 'vitamin-c_100g': 0.012, 'vitamin-a_100g': 0.0001, 'vitamin-d_100g': 0.0000025, calcium_100g: 0.12 },
    })!;
    expect(p.micros100).toMatchObject({ salt: 1, sodium: 400, vitaminC: 12, vitaminA: 100, vitaminD: 2.5, calcium: 120 });
    expect(p.micros100).not.toHaveProperty('sugar'); // 12 g sugar > 10 g carbs → a data error, unknown
    const e = productEntry(p, 250)!;
    expect(e.micros).toMatchObject({ salt: 2.5, sodium: 1000, vitaminC: 30, vitaminD: 6.3 }); // 6,25 → one decimal from 1 on
  });

  it('day sums: known values add up, unknown ones stay unknown (never 0), coverage is counted', () => {
    const entries = [
      { id: 'a', micros: { salt: 1.2, vitaminC: 20 } },
      { id: 'b', micros: { salt: 0.8 } },
      { id: 'c' },
    ].map((e) => ({ date: TUE, slot: 'lunch', loggedAt: TUE, name: 'x', method: 'manual', macros: { kcal: 100, protein: 1, carbs: 1, fat: 1 }, ...e }) as LogEntry);
    const s = summarizeEntries(entries);
    expect(s.micros.salt).toEqual({ value: 2, known: 2, of: 3 });
    expect(s.micros.vitaminC).toEqual({ value: 20, known: 1, of: 3 });
    expect(s.micros.iron).toEqual({ value: 0, known: 0, of: 3 });
  });

  it('the rules are one central table', () => {
    expect(REPORT_RULES).toMatchObject({ fiberPer1000Kcal: 14, sugarReferenceG: 90, saltLimitG: 5, sodiumLimitMg: 2000 });
  });
});
