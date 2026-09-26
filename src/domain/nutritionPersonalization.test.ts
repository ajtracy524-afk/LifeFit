import { afterEach, describe, expect, it, vi } from 'vitest';
import { TASTE_RECIPES } from '../data/tastes';
import { emptyState } from '../store/persistence';
import { weekDays } from './dates';
import { explainMeal, learnedInsights } from './explain';
import { learnFromEvent, preferenceOf, prefKey, type Preferences } from './learning';
import { EXPLICIT, foodSignal, plannerAffinity, recipeStyle } from './preferences';
import { plannedMealMacros, sumMacros } from './nutrition';
import { rankMealOptions, scoreWeek, seededRandom, suggestWeek, weightsFor } from './planner';
import { getRecipe } from '../data/recipes';
import type { AppState, NutritionProfile, PlannedMeal } from './types';
import { planMeals, slotSuggestions } from './week';

/**
 * New nutrition signals feed the SAME planner: explicit tastes from the
 * onboarding, foods eaten outside the plan, meal style. Slowly learned,
 * explicit rejections always stronger, no network anywhere near the planner.
 */

const MON = '2026-09-21';
const dates = weekDays(MON);
const target = { kcal: 2800, protein: 160, carbs: 330, fat: 80 };
const omni: NutritionProfile = { diet: 'omnivore', excluded: [], slots: ['breakfast', 'snack', 'lunch', 'dinner'] };
const SEEDS = ['1', '2', '3', '4', '5', '6'];
const plan = (seed: string, affinity?: (id: string, b: 'low' | 'normal' | 'high') => number) =>
  suggestWeek({ dates, slots: omni.slots, target, profile: omni, existing: [], random: seededRandom(seed), affinity });
const count = (plans: PlannedMeal[][], ids: ReadonlySet<string> | string[]) => plans.flat().filter((m) => (Array.isArray(ids) ? ids.includes(m.recipeId) : ids.has(m.recipeId))).length;
const foodEvents = (n: number, foodId: string, prefs: Preferences = {}) => {
  let p = prefs;
  for (let i = 0; i < n; i++) p = learnFromEvent(p, { type: 'food_logged', foodId }, 'x');
  return p;
};

function state(patch: Partial<AppState> = {}): AppState {
  return {
    ...emptyState(),
    profile: { name: 'T', sex: 'male', age: 30, heightCm: 180, activity: 'moderate', experience: 'beginner', createdAt: `${MON}T07:00:00Z` },
    goal: { type: 'muscle_gain', startWeightKg: 80, startedAt: MON },
    nutritionProfile: { ...omni },
    targets: [{ id: 't', validFrom: MON, method: 'formula', ...target }],
    training: { programId: 'full-body', weekdays: [0, 2, 4] },
    ...patch,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('food signals (scanned / searched / manual with a known food)', () => {
  it('one logged food is a weak signal; repetition raises the confidence', () => {
    const once = preferenceOf(foodEvents(1, 'skyr')[prefKey.food('skyr')]);
    const often = preferenceOf(foodEvents(6, 'skyr')[prefKey.food('skyr')]);
    expect(once.confidence).toBeCloseTo(0.2);
    expect(often.confidence).toBeGreaterThan(0.55);
    expect(often.score).toBeGreaterThan(once.score);
  });

  it('a single event barely changes the plan', () => {
    const skyr = [...TASTE_RECIPES.get('yogurt')!];
    const base = count(SEEDS.map((s) => plan(s)), skyr);
    const one = count(SEEDS.map((s) => plan(s, plannerAffinity(foodEvents(1, 'skyr'), omni))), skyr);
    expect(Math.abs(one - base)).toBeLessThanOrEqual(2);
  });

  it('repeatedly eaten foods make recipes with them come more often', () => {
    // skyr-bowl is the only recipe with skyr – a nudge, never stronger than variety or nutrition.
    const withSkyr = new Set(['skyr-bowl']);
    const base = count(SEEDS.map((s) => plan(s)), withSkyr);
    const learned = count(SEEDS.map((s) => plan(s, plannerAffinity(foodEvents(15, 'skyr'), omni))), withSkyr);
    expect(learned).toBeGreaterThan(base);
    expect(foodSignal(foodEvents(15, 'skyr'), getRecipe('skyr-bowl')!)).toBeGreaterThan(0.3);
  });

  it('deleting the entry takes the evidence back', () => {
    const p = learnFromEvent(foodEvents(1, 'skyr'), { type: 'food_unlogged', foodId: 'skyr' }, 'x');
    expect(preferenceOf(p[prefKey.food('skyr')]).score).toBe(0);
  });

  it('shows up in "Was LifeFit gelernt hat" only with enough evidence', () => {
    expect(learnedInsights(state({ learning: { preferences: foodEvents(2, 'skyr') } })).join()).not.toContain('Skyr');
    expect(learnedInsights(state({ learning: { preferences: foodEvents(6, 'skyr') } })).join()).toContain('Isst du oft zusätzlich: Skyr natur');
  });
});

describe('explicit tastes (onboarding / profile)', () => {
  it('favourites are planned more often', () => {
    const bowls = TASTE_RECIPES.get('bowls')!;
    const base = count(SEEDS.map((s) => plan(s)), bowls);
    const fav = count(SEEDS.map((s) => plan(s, plannerAffinity({}, { ...omni, favorites: ['bowls'] }))), bowls);
    expect(fav).toBeGreaterThan(base);
  });

  it('a favourite is a starting point: real skips outweigh it over time', () => {
    const fav = plannerAffinity({}, { ...omni, favorites: ['bowls'] });
    let prefs: Preferences = {};
    for (let i = 0; i < 12; i++) prefs = learnFromEvent(prefs, { type: 'meal_skipped', recipeId: 'chicken-rice-bowl', slot: 'lunch', timeBudget: 'normal' }, 'x');
    const skipped = plannerAffinity(prefs, { ...omni, favorites: ['bowls'] });
    expect(fav('chicken-rice-bowl', 'normal')).toBeCloseTo(EXPLICIT.favorite);
    expect(skipped('chicken-rice-bowl', 'normal')).toBeLessThan(0);
  });

  it('an explicit rejection stays stronger than any learned behaviour', () => {
    let prefs: Preferences = {};
    for (let i = 0; i < 40; i++) prefs = learnFromEvent(prefs, { type: 'meal_eaten', recipeId: 'oven-salmon', slot: 'dinner', timeBudget: 'normal' }, 'x');
    const a = plannerAffinity(prefs, { ...omni, avoided: ['fish'] });
    expect(a('oven-salmon', 'normal')).toBeLessThan(-2.9);
    const fish = TASTE_RECIPES.get('fish')!;
    expect(count(SEEDS.map((s) => plan(s, a)), fish)).toBeLessThan(count(SEEDS.map((s) => plan(s)), fish));
  });

  it('meal style favours light or energy-dense recipes – calories are still met by the portions', () => {
    const light = plannerAffinity({}, { ...omni, mealStyle: 'light' });
    const plans = SEEDS.map((s) => plan(s, light));
    const lightShare = plans.flat().filter((m) => recipeStyle(getRecipe(m.recipeId)!) === 'light').length;
    const baseShare = SEEDS.map((s) => plan(s)).flat().filter((m) => recipeStyle(getRecipe(m.recipeId)!) === 'light').length;
    expect(lightShare).toBeGreaterThan(baseShare);
    for (const p of plans) for (const d of dates) expect(Math.abs(sumMacros(p.filter((m) => m.date === d).map(plannedMealMacros)).kcal - target.kcal) / target.kcal).toBeLessThan(0.1);
  });

  it('diet and allergens stay hard filters – a favourite cannot bring meat into a vegetarian plan', () => {
    const veg: NutritionProfile = { ...omni, diet: 'vegetarian', favorites: ['chicken', 'beef'] };
    const p = suggestWeek({ dates, slots: veg.slots, target, profile: veg, existing: [], random: seededRandom('v'), affinity: plannerAffinity({}, veg) });
    expect(p.some((m) => TASTE_RECIPES.get('chicken')!.has(m.recipeId) || TASTE_RECIPES.get('beef')!.has(m.recipeId))).toBe(false);
  });

  it('without explicit input or food signals the affinity is exactly the learned one', () => {
    let prefs: Preferences = {};
    prefs = learnFromEvent(prefs, { type: 'meal_eaten', recipeId: 'chili', slot: 'dinner', timeBudget: 'normal' }, 'x');
    const a = plannerAffinity(prefs, omni);
    expect(a('chili', 'normal')).toBeGreaterThan(0);
    expect(a('bolognese', 'normal')).toBe(0);
  });
});

describe('"Warum dieses Gericht?" names the new factors only when they apply', () => {
  const meal: PlannedMeal = { id: 'm', date: MON, slot: 'breakfast', recipeId: 'skyr-bowl', servings: 1, status: 'planned', source: 'suggest' };
  it('favourite, style and often eaten foods', () => {
    const s = state({ plannedMeals: [meal], nutritionProfile: { ...omni, favorites: ['yogurt'], mealStyle: 'light' }, learning: { preferences: foodEvents(6, 'skyr') } });
    const reasons = explainMeal(s, meal, MON);
    expect(reasons).toContain('Passt zu deiner Vorliebe: Joghurt / Skyr');
    expect(reasons).toContain('Passt zu deinem Mahlzeiten-Stil „Leicht & voluminös“');
    expect(reasons.some((r) => r.startsWith('Enthält, was du oft isst: Skyr natur'))).toBe(true);
  });

  it('says nothing about tastes without data', () => {
    const reasons = explainMeal(state({ plannedMeals: [meal] }), meal, MON);
    expect(reasons.some((r) => /Vorliebe|Stil|oft isst/.test(r))).toBe(false);
  });
});

describe('suggestions for one meal ("Passend zu deinem Plan")', () => {
  it('are ranked by the planner’s own week score, deterministic, and exclude the planned recipe', () => {
    const s = state({ plannedMeals: [{ id: 'p', date: MON, slot: 'lunch', recipeId: 'chili', servings: 1, status: 'planned', source: 'suggest' }] });
    const a = slotSuggestions(s, MON, 'lunch', MON, 3, ['chili']);
    const b = slotSuggestions(s, MON, 'lunch', MON, 3, ['chili']);
    expect(a.options.map((o) => o.recipe.id)).toEqual(b.options.map((o) => o.recipe.id));
    expect(a.options).toHaveLength(3);
    expect(a.options.some((o) => o.recipe.id === 'chili')).toBe(false);
    expect([...a.options].sort((x, y) => x.score - y.score)).toEqual(a.options);
  });

  it('rankMealOptions uses scoreWeek – the same score the week planner optimizes', () => {
    const input = { date: MON, slot: 'dinner' as const, target, fixed: [], kcal: 800, timeBudget: 'normal' as const, profile: omni, context: [] };
    const [best] = rankMealOptions(input, 1);
    const day = { date: MON, target, fixed: [], remainingKcal: 800, slots: ['dinner' as const], picks: [best!.recipe], timeBudget: 'normal' as const };
    expect(best!.score).toBeCloseTo(scoreWeek([day], {}, weightsFor('balanced')).total);
  });

  it('know what was already eaten today: less left → smaller portions', () => {
    const fresh = slotSuggestions(state(), MON, 'dinner', MON);
    const full = slotSuggestions(
      state({ logEntries: [{ id: 'e', date: MON, slot: 'lunch', loggedAt: `${MON}T12:00:00Z`, name: 'Pizza', method: 'manual', macros: { kcal: 2000, protein: 60, carbs: 200, fat: 90 } }] }),
      MON,
      'dinner',
      MON,
    );
    expect(full.open.kcal).toBeLessThan(fresh.open.kcal);
    expect(full.options[0]!.macros.kcal).toBeLessThan(fresh.options[0]!.macros.kcal);
  });

  it('respect avoided tastes and the diet', () => {
    const s = state({ nutritionProfile: { ...omni, avoided: ['chicken', 'beef', 'fish'] } });
    const ids = slotSuggestions(s, MON, 'dinner', MON, 3).options.map((o) => o.recipe.id);
    expect(ids.some((id) => ['chicken', 'beef', 'fish'].some((t) => TASTE_RECIPES.get(t)!.has(id)))).toBe(false);
  });
});

describe('the planner never depends on the network', () => {
  it('planning a week and ranking suggestions make no request', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const s = state({ nutritionProfile: { ...omni, favorites: ['oats'], avoided: ['fish'], mealStyle: 'hearty' }, learning: { preferences: foodEvents(5, 'oats') } });
    expect(planMeals(s, { dates, today: MON, seed: MON }).length).toBeGreaterThan(20);
    slotSuggestions(s, MON, 'breakfast', MON);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
