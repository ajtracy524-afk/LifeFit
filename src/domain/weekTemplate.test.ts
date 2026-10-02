import { describe, expect, it } from 'vitest';
import { getRecipe } from '../data/recipes';
import { emptyState } from '../store/persistence';
import { DAY_TOLERANCE } from './constants';
import { weekDays } from './dates';
import { plannedMealMacros, sumMacros } from './nutrition';
import { isPortable, slotShare } from './planner';
import type { AppState, MealSlot, NutritionProfile, PlannedMeal, WeekTemplate } from './types';
import { applyTemplateChange, applyWeekChange, closedMeals, dayTargetFor, planMeals, weekShopping } from './week';
import {
  copyDay,
  copySlot,
  excludedSlotsOn,
  nextPlan,
  outMealEntry,
  planTargetOf,
  planTargetOn,
  setSlot,
  setSlotOn,
  slotPlanOn,
  weekSlotOverride,
  WORKDAYS,
} from './week/slotPlans';

/** Prompt 5 – "Deine typische Woche": template, budgets, to go, week deviations. */

const WEEK = '2026-10-05'; // Monday
const dates = weekDays(WEEK);
const target = { kcal: 2600, protein: 150, carbs: 300, fat: 80 };
const SLOTS: MealSlot[] = ['breakfast', 'snack', 'lunch', 'dinner'];

function state(template?: WeekTemplate, patch: Partial<AppState> = {}): AppState {
  const nutritionProfile: NutritionProfile = { diet: 'omnivore', excluded: [], slots: SLOTS, ...(template ? { weekTemplate: template } : {}) };
  return { ...emptyState(), nutritionProfile, targets: [{ id: 't', validFrom: '2026-01-01', method: 'formula', ...target }], ...patch };
}
const planned = (s: AppState, seed = 'w') => ({ ...s, plannedMeals: planMeals(s, { dates, today: WEEK, seed }) });
const dayMeals = (s: AppState, d: string) => s.plannedMeals.filter((m) => m.date === d && m.status !== 'skipped');

// Mo–Fr lunch out at the canteen, Friday dinner at a restaurant (large), Saturday breakfast skipped, Mo–Fr snack to go.
const TEMPLATE: WeekTemplate = setSlot(
  setSlot(setSlotOn(setSlotOn({}, WORKDAYS, 'lunch', { kind: 'out', place: 'canteen' }), WORKDAYS, 'snack', { kind: 'togo' }), 4, 'dinner', { kind: 'out', place: 'restaurant', size: 'large' }),
  5,
  'breakfast',
  { kind: 'skip' },
);

describe('out and skip never create shopping items, to go does', () => {
  it('for out and skipped slots there is no meal and no shopping source', () => {
    for (const seed of ['1', '2', '3']) {
      const s = planned(state(TEMPLATE), seed);
      for (const d of dates) {
        const closed = excludedSlotsOn(s, d);
        expect(dayMeals(s, d).some((m) => closed.includes(m.slot)), `${d}`).toBe(false);
      }
      const sources = weekShopping(s, WEEK, WEEK).flatMap((i) => i.sources);
      for (const src of sources) expect(['out', 'skip']).not.toContain(slotPlanOn(s, src.date, src.slot).kind);
      // To go is planned and bought.
      expect(sources.some((src) => src.slot === 'snack' && WORKDAYS.includes((dates.indexOf(src.date) as 0 | 1 | 2 | 3 | 4)))).toBe(true);
    }
  });

  it('the closed meals say why and keep their budget', () => {
    const s = state(TEMPLATE);
    const fri = closedMeals(s, dates[4]!);
    expect(fri.map((c) => [c.slot, c.reason])).toEqual([
      ['lunch', 'eating_out'],
      ['dinner', 'eating_out'],
    ]);
    expect(fri[1]!.plan).toEqual({ kind: 'out', place: 'restaurant', size: 'large' });
    expect(fri[1]!.reserved!.kcal).toBeGreaterThan(fri[0]!.reserved!.kcal);
    expect(closedMeals(s, dates[5]!)).toEqual([{ date: dates[5], slot: 'breakfast', reason: 'skip' }]);
  });
});

describe('day target and protein are reached despite out meals', () => {
  // A typical week: Mo–Fr lunch at the canteen, snacks to go, Saturday breakfast skipped, Sunday dinner out.
  const COMMON = setSlot(setSlot(setSlotOn(setSlotOn({}, WORKDAYS, 'lunch', { kind: 'out', place: 'canteen' }), WORKDAYS, 'snack', { kind: 'togo' }), 5, 'breakfast', { kind: 'skip' }), 6, 'dinner', { kind: 'out' });

  it(`planned + reserved within ±${DAY_TOLERANCE.kcal * 100} % kcal, protein at least ${(1 - DAY_TOLERANCE.protein) * 100} %`, () => {
    for (const seed of ['1', '2', '3', '4']) {
      const s = planned(state(COMMON), seed);
      for (const d of dates) {
        const t = dayTargetFor(s, d)!;
        const { reserved } = planTargetOn(s, d, t);
        const plan = sumMacros(dayMeals(s, d).map(plannedMealMacros));
        const kcal = plan.kcal + reserved.reduce((x, r) => x + r.kcal, 0);
        const protein = plan.protein + reserved.reduce((x, r) => x + r.protein, 0);
        expect(Math.abs(kcal - t.kcal) / t.kcal, `${seed} ${d} kcal`).toBeLessThan(DAY_TOLERANCE.kcal);
        expect(protein / t.protein, `${seed} ${d} protein`).toBeGreaterThan(1 - DAY_TOLERANCE.protein);
      }
    }
  });

  it('an extreme day (canteen lunch + large restaurant dinner): kcal still within tolerance, the meals at home carry clearly more protein', () => {
    // ~80 % of the energy is out at 15 % protein – the rest would need > 50 % protein, which no food plan reaches.
    // What the planner must do: hit the calories and shift protein home as far as it goes.
    for (const seed of ['1', '2', '3', '4']) {
      const s = planned(state(TEMPLATE), seed);
      const fri = dates[4]!;
      const t = dayTargetFor(s, fri)!;
      const { reserved } = planTargetOn(s, fri, t);
      const plan = sumMacros(dayMeals(s, fri).map(plannedMealMacros));
      expect(Math.abs(plan.kcal + reserved.reduce((x, r) => x + r.kcal, 0) - t.kcal) / t.kcal).toBeLessThan(DAY_TOLERANCE.kcal);
      const mon = sumMacros(dayMeals(s, dates[0]!).map(plannedMealMacros));
      expect((plan.protein * 4) / plan.kcal, `${seed}: protein density at home`).toBeGreaterThan((mon.protein * 4) / mon.kcal);
    }
  });

  it('protein compensation: an out meal counts as low in protein, so the meals at home get more', () => {
    const plain = planTargetOf(target, SLOTS, undefined, undefined);
    const out = planTargetOf(target, SLOTS, undefined, { lunch: { kind: 'out' } });
    const share = slotShare(['lunch'], SLOTS);
    expect(out.target.kcal).toBeCloseTo(target.kcal * (1 - share), 6);
    expect(out.target.protein).toBeGreaterThan(target.protein * (1 - share)); // more than proportional
    expect(plain.target).toEqual(target);
    // Size and place change the reservation.
    const large = planTargetOf(target, SLOTS, undefined, { lunch: { kind: 'out', place: 'restaurant', size: 'large' } });
    expect(large.reserved[0]!.kcal).toBeCloseTo(target.kcal * share * 1.4 * 1.2, 6);
  });

  it('E12: a skipped meal hands its share on, a removed one keeps it reserved', () => {
    const skip = planTargetOf(target, SLOTS, undefined, { snack: { kind: 'skip' } });
    expect(skip.target).toEqual(target);
    expect(skip.active).toEqual(['breakfast', 'lunch', 'dinner']);
    const removed = planTargetOf(target, SLOTS, { timeBudget: 'normal', mode: 'normal', removedSlots: ['snack'] }, undefined);
    expect(removed.target.kcal).toBeCloseTo(target.kcal * (1 - slotShare(['snack'], SLOTS)), 6);
    // In the plan: the three remaining meals of a skip day are bigger than on a normal day.
    const s = planned(state(TEMPLATE), '1');
    const sat = sumMacros(dayMeals(s, dates[5]!).map(plannedMealMacros)).kcal;
    expect(Math.abs(sat - target.kcal) / target.kcal).toBeLessThan(DAY_TOLERANCE.kcal);
  });
});

describe('to go', () => {
  it('chooses portable recipes only', () => {
    for (const seed of ['1', '2', '3', '4', '5']) {
      const s = planned(state(setSlotOn({}, WORKDAYS, 'lunch', { kind: 'togo' })), seed);
      const lunches = s.plannedMeals.filter((m) => m.slot === 'lunch' && dates.indexOf(m.date) < 5);
      expect(lunches).toHaveLength(5);
      for (const m of lunches) expect(isPortable(getRecipe(m.recipeId)!), m.recipeId).toBe(true);
    }
  });

  it('a planned dish that does not travel is exchanged when the slot becomes "Mitnehmen"', () => {
    const omelette: PlannedMeal = { id: 'o', date: dates[1]!, slot: 'dinner', recipeId: 'veggie-omelette', servings: 1, status: 'planned', source: 'suggest' };
    const s = state(undefined, { plannedMeals: [omelette] });
    const r = applyWeekChange(s, { type: 'setDayContext', date: dates[1]!, context: { slots: { dinner: { kind: 'togo' } } } }, new Date(2026, 9, 5, 8));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const dinner = r.state.plannedMeals.find((m) => m.date === dates[1] && m.slot === 'dinner' && m.status === 'planned')!;
    expect(isPortable(getRecipe(dinner.recipeId)!)).toBe(true);
  });
});

describe('the template recurs, a single week deviates', () => {
  it('a week deviation does not change the template', () => {
    const s = planned(state(TEMPLATE));
    const tue = dates[1]!;
    const override = weekSlotOverride(s.dayContexts[tue], TEMPLATE[1], 'lunch', { kind: 'home' });
    const r = applyWeekChange(s, { type: 'setDayContext', date: tue, context: { slots: override } }, new Date(2026, 9, 5, 8));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.nutritionProfile!.weekTemplate).toEqual(TEMPLATE);
    expect(slotPlanOn(r.state, tue, 'lunch').kind).toBe('home');
    expect(dayMeals(r.state, tue).some((m) => m.slot === 'lunch')).toBe(true); // planned for this week
    expect(slotPlanOn(r.state, '2026-10-13', 'lunch').kind).toBe('out'); // next Tuesday: the template again
    // Choosing what the template says removes the deviation again.
    expect(weekSlotOverride({ timeBudget: 'normal', mode: 'normal', slots: { lunch: { kind: 'home' } } }, TEMPLATE[1], 'lunch', { kind: 'out', place: 'canteen' })).toEqual({});
  });

  it('a new template applies to this and next week – but not where the week deviates', () => {
    const base = planned(state());
    const wed = dates[2]!;
    const withDeviation: AppState = { ...base, dayContexts: { [dates[3]!]: { timeBudget: 'normal', mode: 'normal', slots: { lunch: { kind: 'home' } } } } };
    const s = structuredClone(withDeviation);
    const before = s.nutritionProfile!.weekTemplate;
    s.nutritionProfile = { ...s.nutritionProfile!, weekTemplate: setSlotOn({}, WORKDAYS, 'lunch', { kind: 'out' }) };
    applyTemplateChange(s, before, WEEK);
    expect(s.plannedMeals.find((m) => m.date === wed && m.slot === 'lunch')).toMatchObject({ status: 'skipped', skippedFor: 'eating_out' });
    expect(dayMeals(s, dates[3]!).some((m) => m.slot === 'lunch')).toBe(true); // Thursday deviates: lunch at home
    expect(weekShopping(s, WEEK, WEEK).flatMap((i) => i.sources).some((src) => src.date === wed && src.slot === 'lunch')).toBe(false);
    // Back to the empty template: the lunches come back.
    const later = s.nutritionProfile!.weekTemplate;
    s.nutritionProfile = { ...s.nutritionProfile!, weekTemplate: undefined };
    applyTemplateChange(s, later, WEEK);
    expect(s.plannedMeals.find((m) => m.date === wed && m.slot === 'lunch')!.status).toBe('planned');
  });
});

describe('editing the template (pure)', () => {
  it('tap cycles the four states; Zuhause is not stored', () => {
    expect(nextPlan({ kind: 'home' })).toEqual({ kind: 'togo' });
    expect(nextPlan({ kind: 'togo' })).toEqual({ kind: 'out' });
    expect(nextPlan({ kind: 'out', place: 'canteen' })).toEqual({ kind: 'skip' });
    expect(nextPlan({ kind: 'skip' })).toEqual({ kind: 'home' });
    expect(setSlot({ 0: { lunch: { kind: 'out' } } }, 0, 'lunch', { kind: 'home' })).toEqual({});
  });

  it('quick actions: Mo–Fr, copy a row, copy a column', () => {
    const t = setSlotOn({}, WORKDAYS, 'lunch', { kind: 'togo' });
    expect(Object.keys(t)).toEqual(['0', '1', '2', '3', '4']);
    const row = copyDay({ 2: { breakfast: { kind: 'skip' }, lunch: { kind: 'out' } } }, 2, [5, 6], SLOTS);
    expect(row[5]).toEqual({ breakfast: { kind: 'skip' }, lunch: { kind: 'out' } });
    const col = copySlot({ 0: { dinner: { kind: 'out', size: 'small' } } }, 'dinner', 0, [1, 2]);
    expect(col[2]).toEqual({ dinner: { kind: 'out', size: 'small' } });
  });

  it('"Wie geplant gegessen" logs the reserved budget', () => {
    const e = outMealEntry({ kind: 'out', place: 'canteen' }, { kcal: 700, protein: 26 });
    expect(e).toMatchObject({ name: 'Auswärts (Kantine)', method: 'quick', macros: { kcal: 700, protein: 26 } });
    const sum = e.macros.protein * 4 + e.macros.carbs * 4 + e.macros.fat * 9;
    expect(Math.abs(sum - 700)).toBeLessThan(10);
  });
});
