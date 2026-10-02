import { describe, expect, it } from 'vitest';
import { emptyState } from '../store/persistence';
import { budgetNote, explainDay, explainMeal, learnedInsights } from './explain';
import { learnFromEvent, type Preferences } from './learning';
import { dayTimeline, postWorkoutSlot, preWorkoutSlot, trainingTimeFor } from './schedule';
import { nextAction } from './today';
import type { AppState, PlannedMeal } from './types';
import { shoppingCost, weekShopping } from './week';

/**
 * "Warum?", "Dein Plan" and "Was LifeFit gelernt hat" – only real factors,
 * nothing said without data behind it.
 */

const MON = '2026-09-21';
const TUE = '2026-09-22';

function state(patch: Partial<AppState> = {}): AppState {
  return {
    ...emptyState(),
    profile: { name: 'T', sex: 'male', age: 30, heightCm: 180, activity: 'moderate', experience: 'beginner', createdAt: `${MON}T07:00:00Z` },
    goal: { type: 'muscle_gain', startWeightKg: 80, startedAt: MON },
    nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['breakfast', 'snack', 'lunch', 'dinner'] },
    targets: [{ id: 't', validFrom: MON, method: 'formula', kcal: 2800, protein: 160, carbs: 330, fat: 80 }],
    training: { programId: 'full-body', weekdays: [0, 2, 4] },
    ...patch,
  };
}
const meal = (id: string, date: string, slot: PlannedMeal['slot'], recipeId: string, patch: Partial<PlannedMeal> = {}): PlannedMeal => ({
  id, date, slot, recipeId, servings: 1, status: 'planned', source: 'suggest', ...patch,
});

describe('Warum dieses Gericht?', () => {
  it('names time, pantry, protein and training – only if they apply', () => {
    const dinner = meal('d', MON, 'dinner', 'chicken-rice-bowl');
    const s = state({ plannedMeals: [dinner], pantry: { rice: { foodId: 'rice', quantityG: 1000, updatedAt: `${MON}T06:00:00Z` } } });
    const reasons = explainMeal(s, dinner, MON);
    expect(reasons).toContain('25 Min. Zubereitung');
    expect(reasons).toContain('1 Zutat ist schon zu Hause');
    expect(reasons.some((r) => /g Protein – \d+ % deines Tagesziels/.test(r))).toBe(true);
    expect(reasons).toContain('Proteinreich nach deinem Training um 18:00'); // Monday training 18:00, dinner 19:00
    // No invented factors: no pantry claim without pantry, no preference without evidence.
    const plain = explainMeal(state({ plannedMeals: [dinner] }), dinner, MON);
    expect(plain.some((r) => r.includes('zu Hause'))).toBe(false);
    expect(plain.some((r) => r.includes('gern'))).toBe(false);
  });

  it('explains a low-time day and meal-prep leftovers', () => {
    const cooked = meal('a', MON, 'dinner', 'chili');
    const leftover = meal('b', TUE, 'lunch', 'chili');
    const quick = meal('c', TUE, 'dinner', 'veggie-omelette');
    // Leftovers only for users who like to cook ahead (E18).
    const cooksAhead = { version: 1 as const, progress: { completed: {}, skipped: [] }, body: {}, health: {}, goal: {}, food: { mealPrep: { value: true, source: 'user' as const, updatedAt: `${MON}T07:00:00Z` } }, training: {} };
    const s = state({ plannedMeals: [cooked, leftover, quick], dayContexts: { [TUE]: { timeBudget: 'low', mode: 'normal' } }, onboarding: cooksAhead });
    expect(explainMeal(s, leftover, MON)).toContain('Rest von Montag – nur aufwärmen');
    // Without it the chili is cooked again – no leftover claim.
    expect(explainMeal({ ...s, onboarding: undefined }, leftover, MON)).not.toContain('Rest von Montag – nur aufwärmen');
    expect(explainMeal(s, quick, MON)).toContain('15 Min. Zubereitung – passt zu „Wenig Zeit“');
  });

  it('mentions learned taste only with repeated evidence', () => {
    const dinner = meal('d', MON, 'dinner', 'bolognese');
    let prefs: Preferences = {};
    const once = explainMeal(state({ plannedMeals: [dinner], learning: { preferences: learnFromEvent(prefs, { type: 'meal_eaten', recipeId: 'bolognese', slot: 'dinner', timeBudget: 'normal' }, 'x') } }), dinner, MON);
    expect(once.some((r) => r.includes('gern'))).toBe(false);
    for (let i = 0; i < 6; i++) prefs = learnFromEvent(prefs, { type: 'meal_eaten', recipeId: 'bolognese', slot: 'dinner', timeBudget: 'normal' }, 'x');
    expect(explainMeal(state({ plannedMeals: [dinner], learning: { preferences: prefs } }), dinner, MON)).toContain('Isst du gern – schon 6× gegessen');
  });

  it('a meal the user picked is said to be fixed', () => {
    const own = meal('o', MON, 'lunch', 'bolognese', { source: 'user' });
    expect(explainMeal(state({ plannedMeals: [own] }), own, MON)[0]).toMatch(/Von dir gewählt/);
  });
});

describe('Warum dieser Plan? (day)', () => {
  it('summarises the day from real factors', () => {
    const s = state({
      plannedMeals: [meal('d', MON, 'dinner', 'chicken-rice-bowl')],
      dayContexts: { [MON]: { timeBudget: 'low', mode: 'normal' } },
      pantry: { rice: { foodId: 'rice', quantityG: 1000, updatedAt: `${MON}T06:00:00Z` } },
    });
    const reasons = explainDay(s, MON, MON);
    expect(reasons).toContain('Wenig Zeit – schnelle Gerichte oder Reste');
    expect(reasons.some((r) => /^Training um 18:00 · ~\d+ min$/.test(r))).toBe(true);
    expect(reasons).toContain('1 Zutat kommt aus deinem Vorrat');
    expect(reasons.some((r) => r.startsWith('Für heute und morgen fehlen noch'))).toBe(true);
  });
});

describe('Dein Plan (timeline) and meal times', () => {
  it('orders meals and training by time and marks before/after training', () => {
    const s = state({
      plannedMeals: [meal('b', MON, 'breakfast', 'overnight-oats'), meal('s', MON, 'snack', 'protein-shake'), meal('l', MON, 'lunch', 'chicken-wraps'), meal('d', MON, 'dinner', 'bolognese')],
      plannerSettings: { priority: 'balanced', mealTimes: { breakfast: '07:30', lunch: '12:30', snack: '16:30', snack2: '16:00', dinner: '20:00' }, trainingTime: '18:00' },
    });
    const items = dayTimeline(s, MON).map((i) => (i.kind === 'training' ? `${i.time} training` : i.kind === 'closed' ? `${i.time} closed` : `${i.time} ${i.meal.slot}${i.kind === 'meal' && i.role ? `:${i.role}` : ''}`));
    expect(items).toEqual(['07:30 breakfast', '12:30 lunch', '16:30 snack:pre', '18:00 training', '20:00 dinner:post']);
    expect(preWorkoutSlot(s, TUE)).toBeUndefined(); // rest day
    expect(postWorkoutSlot(s, TUE)).toBeUndefined();
  });

  it('training time: set by the user, else learned, else 18:00', () => {
    expect(trainingTimeFor(state()).time).toBe('18:00');
    let prefs: Preferences = {};
    for (const date of ['2026-09-01', '2026-09-03', '2026-09-08', '2026-09-10', '2026-09-15']) prefs = learnFromEvent(prefs, { type: 'workout_completed', date, hour: 7 }, 'x');
    expect(trainingTimeFor(state({ learning: { preferences: prefs } }))).toEqual({ time: '07:00', source: 'learned' });
    expect(trainingTimeFor(state({ learning: { preferences: prefs }, plannerSettings: { ...emptyState().plannerSettings, trainingTime: '19:30' } })).time).toBe('19:30');
  });

  it('a meal is due 30 min before its time (not by fixed hours)', () => {
    const s = state({
      plannedMeals: [meal('b', MON, 'breakfast', 'overnight-oats')],
      plannerSettings: { priority: 'balanced', mealTimes: { breakfast: '09:30', snack: '11:00', lunch: '13:00', snack2: '16:00', dinner: '19:00' } },
      training: null,
    });
    const dueAt = (hour: number) => {
      const a = nextAction(s, MON, hour);
      return a.kind === 'log_meal' && a.due;
    };
    expect(dueAt(8)).toBe(false); // 08:00 < 09:00
    expect(dueAt(9)).toBe(true); // 09:00 = 09:30 − 30 min
  });
});

describe('Was LifeFit gelernt hat', () => {
  it('stays empty without evidence and speaks plainly with it', () => {
    expect(learnedInsights(state())).toEqual([]);
    let prefs: Preferences = {};
    for (let i = 0; i < 6; i++) prefs = learnFromEvent(prefs, { type: 'meal_eaten', recipeId: 'bolognese', slot: 'dinner', timeBudget: 'normal' }, 'x');
    for (let i = 0; i < 6; i++) prefs = learnFromEvent(prefs, { type: 'meal_skipped', recipeId: 'chili', slot: 'dinner', timeBudget: 'normal' }, 'x');
    for (let i = 0; i < 5; i++) prefs = learnFromEvent(prefs, { type: 'meal_skipped', recipeId: 'oven-salmon', slot: 'dinner', timeBudget: 'low' }, 'x');
    for (const date of ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29']) prefs = learnFromEvent(prefs, { type: 'workout_completed', date, hour: 18 }, 'x');
    const insights = learnedInsights(state({ learning: { preferences: prefs } }));
    expect(insights).toContain('Du isst gern: Vollkorn-Pasta Bolognese');
    expect(insights.some((l) => l.startsWith('Tauschst oder überspringst du oft: Chili'))).toBe(true);
    expect(insights.some((l) => l.startsWith('An Tagen mit wenig Zeit lässt du eher aus: Ofenlachs'))).toBe(true);
    expect(insights).toContain('Du trainierst meistens Di');
    expect(insights).toContain('Dein Training beginnt meist gegen 18 Uhr');
  });
});

describe('estimated costs on the shopping list', () => {
  it('prices open items by whole packages and counts items without a price', () => {
    const s = state({ plannedMeals: [meal('d', TUE, 'dinner', 'chicken-rice-bowl'), meal('s', TUE, 'snack', 'protein-shake')] });
    const items = weekShopping(s, MON, MON);
    expect(items.find((i) => i.foodId === 'chicken')!.estCostChf).toBeCloseTo(11.2); // one 400 g pack at ~28 CHF/kg
    expect(items.find((i) => i.foodId === 'whey')!.estCostChf).toBeUndefined();
    const cost = shoppingCost(items);
    expect(cost.unpriced).toBe(1);
    expect(cost.totalChf).toBeGreaterThan(11.2);
  });
});

describe('budget note', () => {
  it('says plainly whether the week fits and what would help', () => {
    const r = (lowChf: number, highChf: number) => ({ lowChf, highChf });
    expect(budgetNote(r(45, 50), undefined, 'save')).toBeUndefined();
    expect(budgetNote(r(45, 50), 60, 'balanced')).toBe('Passt in dein Budget von CHF 60.–.');
    expect(budgetNote(r(55, 65), 60, 'balanced')).toMatch(/^Liegt etwa bei deinem Budget von CHF 60\.– \(ca\. CHF/);
    expect(budgetNote(r(75, 80), 60, 'balanced')).toMatch(/Sparen/);
    expect(budgetNote(r(75, 80), 60, 'save')).toMatch(/Kalorien und Protein haben Vorrang/);
    // Too few prices → no verdict at all (a partial sum must never say "passt").
    expect(budgetNote(undefined, 60, 'balanced')).toBe('Zu wenig Preisdaten für einen Vergleich mit deinem Budget von CHF 60.–.');
  });
});
