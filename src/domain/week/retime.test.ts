import { describe, expect, it } from 'vitest';
import { getRecipe } from '../../data/recipes';
import { emptyState } from '../../store/persistence';
import { weekDays } from '../dates';
import { plannedMealMacros } from '../nutrition';
import { ELABORATE_PREP_MIN, PLANNER_WEIGHTS, seededRandom, suggestWeek } from '../planner';
import type { AppState, PlannedMeal, TimeBudget } from '../types';
import { applyWeekChange, mealAlternatives, type CascadeResult } from './index';
import { RETIME_MIN_GAIN, RETIME_TEXT } from './cascade';

/**
 * Time budget, both directions: after every change the planner meals of the
 * day are re-evaluated with the planner's own score – exchanged only if the
 * best alternative is clearly better (or the meal no longer fits the time).
 * User decisions, eaten/skipped meals and passed meal times are never touched.
 */

const MON = '2026-09-21';
const WED = '2026-09-23';
const NOW = new Date(2026, 8, 21, 8, 0); // Monday 08:00

function state(patch: Partial<AppState> = {}): AppState {
  return {
    ...emptyState(),
    profile: { name: 'T', sex: 'male', age: 30, heightCm: 180, activity: 'moderate', experience: 'beginner', createdAt: '2026-09-01T08:00:00Z' },
    goal: { type: 'maintain', startWeightKg: 80, startedAt: '2026-09-01' },
    nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['breakfast', 'lunch', 'dinner'] },
    targets: [{ id: 't', validFrom: '2026-09-01', method: 'formula', kcal: 2400, protein: 150, carbs: 280, fat: 75 }],
    // No training on Wednesday: keeps the post-workout rule out of these tests.
    training: { programId: 'full-body', weekdays: [0, 4] },
    ...patch,
  };
}

const meal = (id: string, slot: PlannedMeal['slot'], recipeId: string, patch: Partial<PlannedMeal> = {}): PlannedMeal => ({
  id, date: WED, slot, recipeId, servings: 1, status: 'planned', source: 'suggest', ...patch,
});

function ok(r: CascadeResult) {
  if (!r.ok) throw new Error(r.reason);
  return r;
}
const setBudget = (s: AppState, timeBudget: TimeBudget, date = WED, now = NOW) => ok(applyWeekChange(s, { type: 'setDayContext', date, context: { timeBudget } }, now));
const recipesOn = (s: AppState, date = WED) => Object.fromEntries(s.plannedMeals.filter((m) => m.date === date).map((m) => [m.id, m.recipeId]));
const prep = (id: string) => getRecipe(id)!.prepMin;

/**
 * Oracle: what the re-evaluation must decide for one meal, computed with the
 * planner's own ranking on the state with the new budget.
 */
function expectedAfter(s: AppState, budget: TimeBudget, maxPrep: number): Record<string, string> {
  // Slot by slot, each decision sees the ones before (exactly like the cascade).
  const dayContexts: AppState['dayContexts'] = budget === 'normal' ? {} : { [WED]: { timeBudget: budget, mode: 'normal' } };
  const probe: AppState = structuredClone({ ...s, dayContexts });
  const order = ['breakfast', 'snack', 'lunch', 'dinner'];
  for (const m of probe.plannedMeals.filter((x) => x.date === WED).sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot))) {
    if (m.status !== 'planned' || m.source !== 'suggest' || m.servingsLocked) continue;
    const options = mealAlternatives(probe, m, MON, { includeCurrent: true, limit: Infinity });
    const fitting = options.filter((o) => o.recipe.prepMin <= maxPrep);
    const best = (fitting.length ? fitting : options)[0]!;
    const current = options.find((o) => o.recipe.id === m.recipeId)!;
    const fits = current.recipe.prepMin <= maxPrep;
    if (best.recipe.id !== m.recipeId && ((!fits && fitting.length) || current.score - best.score >= RETIME_MIN_GAIN)) {
      m.recipeId = best.recipe.id;
      m.servings = best.servings;
    }
  }
  return recipesOn(probe);
}

const slowDay = () => [meal('b', 'breakfast', 'protein-pancakes'), meal('l', 'lunch', 'chili'), meal('d', 'dinner', 'oven-salmon')];

describe('time budget – re-evaluation in both directions', () => {
  it('Normal → Wenig: slow planner meals become quick ones, calories kept', () => {
    const before = state({ plannedMeals: slowDay() });
    const r = setBudget(before, 'low');
    const after = r.state.plannedMeals;
    for (const m of after) expect(prep(m.recipeId)).toBeLessThanOrEqual(15);
    expect(after.map((m) => m.id)).toEqual(['b', 'l', 'd']);
    const kcal = (list: PlannedMeal[]) => list.reduce((s, m) => s + plannedMealMacros(m).kcal, 0);
    expect(Math.abs(kcal(after) - kcal(before.plannedMeals)) / kcal(before.plannedMeals)).toBeLessThan(0.1);
    expect(r.summary.details[0]).toMatch(/^3 Gerichte angepasst: /);
  });

  it('Wenig → Normal: quick meals are re-evaluated – exactly the planner’s clear improvements come back', () => {
    const low = setBudget(state({ plannedMeals: slowDay() }), 'low').state;
    const expected = expectedAfter(low, 'normal', 35);
    const r = setBudget(low, 'normal');
    expect(recipesOn(r.state)).toEqual(expected);
    expect(Object.entries(expected).some(([id, recipe]) => recipesOn(low)[id] !== recipe)).toBe(true);
  });

  it('Normal → Viel: re-evaluated with the small bonus for elaborate dishes', () => {
    const s = state({ plannedMeals: [meal('b', 'breakfast', 'overnight-oats'), meal('l', 'lunch', 'couscous-salad'), meal('d', 'dinner', 'veggie-omelette')] });
    const expected = expectedAfter(s, 'high', Infinity);
    const r = setBudget(s, 'high');
    expect(recipesOn(r.state)).toEqual(expected);
  });

  it('Viel → Normal: meals that still fit stay unless clearly better', () => {
    const high = setBudget(state({ plannedMeals: [meal('b', 'breakfast', 'overnight-oats'), meal('l', 'lunch', 'couscous-salad'), meal('d', 'dinner', 'veggie-omelette')] }), 'high').state;
    const expected = expectedAfter(high, 'normal', 35);
    expect(recipesOn(setBudget(high, 'normal').state)).toEqual(expected);
  });

  it('Viel → Wenig: elaborate dishes chosen for a long day give way to quick ones', () => {
    const high = setBudget(state({ plannedMeals: slowDay() }), 'high').state;
    const r = setBudget(high, 'low');
    for (const m of r.state.plannedMeals) expect(prep(m.recipeId)).toBeLessThanOrEqual(15);
    expect(recipesOn(r.state)).toEqual(expectedAfter(high, 'low', 15));
  });

  it('no exchange without a clear gain – and the user is told so', () => {
    // A breakfast the planner itself ranks first under "Wenig Zeit" stays.
    const probe = state({ plannedMeals: [meal('b', 'breakfast', 'overnight-oats')], dayContexts: { [WED]: { timeBudget: 'low', mode: 'normal' } } });
    const top = mealAlternatives(probe, probe.plannedMeals[0]!, MON, { includeCurrent: true, limit: 1 })[0]!;
    const s = state({ plannedMeals: [meal('b', 'breakfast', top.recipe.id, { servings: top.servings })] });
    const r = setBudget(s, 'low');
    expect(recipesOn(r.state)).toEqual({ b: top.recipe.id });
    expect(r.summary.details).toContain('Alle geplanten Gerichte passen bereits zu deiner verfügbaren Zeit.');
    expect(r.summary.replaced).toEqual([]);
  });

  it('toggling back and forth does not make the plan jump around', () => {
    const s = state({ plannedMeals: slowDay() });
    const once = setBudget(setBudget(s, 'low').state, 'normal').state;
    const twice = setBudget(setBudget(once, 'low').state, 'normal').state;
    expect(recipesOn(twice)).toEqual(recipesOn(once));
    // Never the same dish twice on one day.
    for (const st of [once, twice, setBudget(once, 'high').state]) {
      const ids = Object.values(recipesOn(st));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('feedback after a time-budget change (central RETIME_TEXT)', () => {
  it('more time, quick meal kept → says it stays on purpose, not that something was missed', () => {
    // A quick breakfast the planner still ranks first under "Normal".
    const probe = state({ plannedMeals: [meal('b', 'breakfast', 'overnight-oats')] });
    const top = mealAlternatives(probe, probe.plannedMeals[0]!, MON, { includeCurrent: true, limit: 1 })[0]!;
    expect(top.recipe.prepMin).toBeLessThanOrEqual(15);
    const low = state({ plannedMeals: [meal('b', 'breakfast', top.recipe.id, { servings: top.servings })], dayContexts: { [WED]: { timeBudget: 'low', mode: 'normal' } } });
    const r = setBudget(low, 'normal');
    expect(recipesOn(r.state)).toEqual({ b: top.recipe.id });
    expect(r.summary.details).toContain('Dein schnelles Gericht bleibt geplant – aktuell gibt es keine deutlich passendere Alternative.');
    expect(r.summary.details.join(' ')).not.toMatch(/vergessen|Fehler|nicht möglich/);
  });

  it('texts: singular/plural, quick or not, less time', () => {
    expect(RETIME_TEXT.kept(2, true)).toBe('Deine schnellen Gerichte bleiben geplant – aktuell gibt es keine deutlich passendere Alternative.');
    expect(RETIME_TEXT.kept(1, false)).toBe('Dein Gericht bleibt geplant – aktuell gibt es keine deutlich passendere Alternative.');
    expect(RETIME_TEXT.fits).toBe('Alle geplanten Gerichte passen bereits zu deiner verfügbaren Zeit.');
    expect(RETIME_TEXT.adapted([{ from: 'A', to: 'B' }])).toBe('1 Gericht angepasst: A → B');
    expect(RETIME_TEXT.own(1)).toBe('1 selbst gewähltes Gericht blieb unverändert');
  });

  it('a real exchange still names the concrete change', () => {
    const r = setBudget(state({ plannedMeals: [meal('d', 'dinner', 'oven-salmon')] }), 'low');
    expect(r.summary.details[0]).toMatch(/^1 Gericht angepasst: Ofenlachs mit Kartoffeln & Brokkoli → .+$/);
  });
});

describe('user decisions are respected', () => {
  it('own and sized meals stay; the summary says so', () => {
    const s = state({ plannedMeals: [meal('l', 'lunch', 'chili', { source: 'user' }), meal('d', 'dinner', 'oven-salmon', { servingsLocked: true }), meal('b', 'breakfast', 'protein-pancakes')] });
    const r = setBudget(s, 'low');
    expect(recipesOn(r.state)).toMatchObject({ l: 'chili', d: 'oven-salmon' });
    expect(prep(recipesOn(r.state).b!)).toBeLessThanOrEqual(15);
    expect(r.summary.details).toEqual(expect.arrayContaining([expect.stringMatching(/^1 Gericht angepasst: /), '2 selbst gewählte Gerichte blieben unverändert']));
    expect(r.summary.details.join(' · ')).toMatch(/1 Gericht angepasst: .* · 2 selbst gewählte Gerichte blieben unverändert/);
  });

  it('swapped meals count as the user’s choice', () => {
    const r = setBudget(state({ plannedMeals: [meal('d', 'dinner', 'oven-salmon', { source: 'swap' })] }), 'low');
    expect(recipesOn(r.state)).toEqual({ d: 'oven-salmon' });
    expect(r.summary.details).toContain('1 selbst gewähltes Gericht blieb unverändert');
  });

  it('eaten and skipped meals are never changed', () => {
    const s = state({ plannedMeals: [meal('l', 'lunch', 'chili', { status: 'eaten' }), meal('d', 'dinner', 'oven-salmon', { status: 'skipped' })] });
    const r = setBudget(s, 'low');
    expect(r.state.plannedMeals).toEqual(s.plannedMeals);
  });

  it('today: meals whose time has passed stay, later ones are adapted', () => {
    const today = [meal('b', 'breakfast', 'protein-pancakes', { date: MON }), meal('l', 'lunch', 'chili', { date: MON }), meal('d', 'dinner', 'oven-salmon', { date: MON })];
    const r = setBudget(state({ plannedMeals: today }), 'low', MON, new Date(2026, 8, 21, 13, 0)); // 13:00: breakfast and lunch are over
    const after = recipesOn(r.state, MON);
    expect(after.b).toBe('protein-pancakes');
    expect(after.l).toBe('chili');
    expect(prep(after.d!)).toBeLessThanOrEqual(15);
  });

  it('undo: the previous state is untouched (restore snapshot)', () => {
    const s = state({ plannedMeals: slowDay() });
    const copy = structuredClone(s);
    setBudget(s, 'low');
    setBudget(s, 'high');
    expect(s).toEqual(copy);
  });

  it('busy/travel mean little time – same re-evaluation', () => {
    const r = ok(applyWeekChange(state({ plannedMeals: slowDay() }), { type: 'setDayContext', date: WED, context: { mode: 'busy' } }, NOW));
    for (const m of r.state.plannedMeals) expect(prep(m.recipeId)).toBeLessThanOrEqual(15);
  });
});

describe('"Viel Zeit" bonus stays small', () => {
  it('is below a full preference, pantry, budget or protein hit', () => {
    expect(PLANNER_WEIGHTS.elaborate).toBeLessThan(PLANNER_WEIGHTS.preference);
    expect(PLANNER_WEIGHTS.elaborate).toBeLessThan(PLANNER_WEIGHTS.pantryUnused);
    expect(PLANNER_WEIGHTS.elaborate).toBeLessThan(PLANNER_WEIGHTS.budgetOver);
    expect(PLANNER_WEIGHTS.elaborate).toBeLessThan(PLANNER_WEIGHTS.proteinGap * 0.1);
  });

  it('favours elaborate dishes on high days without breaking calories', () => {
    const dates = weekDays(MON);
    const target = { kcal: 2400, protein: 150, carbs: 280, fat: 75 };
    const profile = { diet: 'omnivore' as const, excluded: [], slots: ['breakfast', 'lunch', 'dinner'] as PlannedMeal['slot'][] };
    const plan = (budget: TimeBudget, seed: string) => suggestWeek({ dates, slots: profile.slots, target, profile, existing: [], random: seededRandom(seed), timeBudgetFor: () => budget });
    const elaborate = (budget: TimeBudget) => ['1', '2', '3', '4'].flatMap((s) => plan(budget, s)).filter((m) => prep(m.recipeId) >= ELABORATE_PREP_MIN).length;
    expect(elaborate('high')).toBeGreaterThan(elaborate('normal'));
    for (const d of dates) {
      const kcal = plan('high', '1').filter((m) => m.date === d).reduce((s, m) => s + plannedMealMacros(m).kcal, 0);
      expect(Math.abs(kcal - target.kcal) / target.kcal).toBeLessThan(0.1);
    }
  });

  it('never brings back an avoided dish', () => {
    const s = state({ nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['breakfast', 'lunch', 'dinner'], avoided: ['fish'] }, plannedMeals: [meal('d', 'dinner', 'veggie-omelette')] });
    expect(recipesOn(setBudget(s, 'high').state).d).not.toBe('oven-salmon');
  });
});
