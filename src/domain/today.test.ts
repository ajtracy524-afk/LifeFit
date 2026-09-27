import { describe, expect, it } from 'vitest';
import { getRecipe } from '../data/recipes';
import { emptyState } from '../store/persistence';
import { runEngine } from './engine';
import { planSlotId } from './training';
import { nextAction } from './today';
import type { AppState, PlannedMeal, Workout } from './types';

/**
 * "Heute" answers one question: what do I have to do now? And recommendations
 * appear only where they belong – and only with enough real data.
 */

const MON = '2026-09-21';
let seq = 0;
const meal = (slot: PlannedMeal['slot'], patch: Partial<PlannedMeal> = {}): PlannedMeal => ({
  id: `t${++seq}`,
  date: MON,
  slot,
  recipeId: slot === 'breakfast' ? 'overnight-oats' : slot === 'lunch' ? 'chicken-wraps' : 'bolognese',
  servings: 1,
  status: 'planned',
  source: 'suggest',
  ...patch,
});

function state(patch: Partial<AppState> = {}): AppState {
  return {
    ...emptyState(),
    profile: { name: 'T', sex: 'male', age: 30, heightCm: 180, activity: 'moderate', experience: 'beginner', createdAt: `${MON}T07:00:00Z` },
    goal: { type: 'muscle_gain', startWeightKg: 80, startedAt: MON },
    nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['breakfast', 'lunch', 'dinner'] },
    targets: [{ id: 't', validFrom: MON, method: 'formula', kcal: 2800, protein: 160, carbs: 330, fat: 80 }],
    training: { programId: 'full-body', weekdays: [0, 2, 4] },
    weights: [{ id: 'w', date: MON, kg: 80 }],
    ...patch,
  };
}

const dayPlan = () => [meal('breakfast'), meal('lunch'), meal('dinner')];
const completed = (plannedId: string): Workout => ({
  id: 'w1',
  date: MON,
  templateId: 'fb-a',
  name: 'Ganzkörper A',
  startedAt: `${MON}T09:00:00Z`,
  status: 'completed',
  exercises: [],
  plannedId,
});

describe('Heute · next action', () => {
  it('a running workout comes first', () => {
    const running: Workout = { ...completed('x'), status: 'in_progress' };
    expect(nextAction(state({ plannedMeals: dayPlan(), workouts: [running] }), MON, 8).kind).toBe('resume_workout');
  });

  it('without a plan: "Woche planen"', () => {
    expect(nextAction(state(), MON, 8)).toEqual({ kind: 'plan_week', week: MON });
  });

  it('a due meal before training (08:00 → breakfast)', () => {
    const a = nextAction(state({ plannedMeals: dayPlan() }), MON, 8);
    expect(a.kind === 'log_meal' && a.meal.slot === 'breakfast' && a.due).toBe(true);
  });

  it('breakfast eaten → today\'s training', () => {
    const plan = [meal('breakfast', { status: 'eaten' }), meal('lunch'), meal('dinner')];
    const a = nextAction(state({ plannedMeals: plan }), MON, 9);
    expect(a.kind === 'start_training' && a.session.date === MON).toBe(true);
  });

  it('training done, nothing due → shopping needed for today/tomorrow', () => {
    const plan = [meal('breakfast', { status: 'eaten' }), meal('lunch'), meal('dinner')];
    const a = nextAction(state({ plannedMeals: plan, workouts: [completed(planSlotId(MON, 0))] }), MON, 9);
    expect(a.kind).toBe('shopping');
  });

  it('everything bought → the next meal later today', () => {
    const plan = [meal('breakfast', { status: 'eaten' }), meal('lunch'), meal('dinner')];
    const foods = plan.flatMap((m) => getRecipe(m.recipeId)!.ingredients.map((i) => i.foodId));
    const pantry = Object.fromEntries(foods.map((id) => [id, { foodId: id, quantityG: 5000, updatedAt: `${MON}T06:00:00Z` }]));
    const a = nextAction(state({ plannedMeals: plan, workouts: [completed(planSlotId(MON, 0))], pantry }), MON, 9);
    expect(a.kind === 'log_meal' && a.meal.slot === 'lunch' && !a.due).toBe(true);
  });

  it('all eaten and trained → done; an eating-out dinner is not "open"', () => {
    const plan = [meal('breakfast', { status: 'eaten' }), meal('lunch', { status: 'eaten' }), meal('dinner', { status: 'skipped' })];
    expect(nextAction(state({ plannedMeals: plan, workouts: [completed(planSlotId(MON, 0))] }), MON, 20).kind).toBe('done');
  });
});

describe('recommendations: right place, real data only', () => {
  it('a new user without history gets no training hints', () => {
    const recs = runEngine(state({ plannedMeals: dayPlan() }), { date: MON, domains: ['training'] });
    expect(recs).toHaveLength(0);
  });

  it('no protein-pattern advice without logged days', () => {
    const recs = runEngine(state({ plannedMeals: dayPlan() }), { date: MON, domains: ['nutrition'], limit: 20 });
    expect(recs.some((r) => r.kind === 'protein_pattern')).toBe(false);
  });

  it('domains filter: each screen only gets its own recommendations', () => {
    // Legs yesterday + legs again today → recovery hint (training) exists.
    const legs: Workout = {
      id: 'legs',
      date: '2026-09-20',
      templateId: 'ppl-legs',
      name: 'Beine',
      startedAt: '2026-09-20T09:00:00Z',
      status: 'completed',
      exercises: ['squat', 'romanian-deadlift', 'leg-press'].map((exerciseId, i) => ({
        id: `e${i}`,
        exerciseId,
        repMin: 6,
        repMax: 10,
        restSec: 120,
        sets: [1, 2, 3].map((k) => ({ id: `s${i}${k}`, weightKg: 60, reps: 8, done: true, type: 'working' as const })),
      })),
    };
    const s = state({
      profile: { ...state().profile!, createdAt: '2026-08-01T07:00:00Z' },
      training: { programId: 'full-body', weekdays: [0, 2, 4] },
      workouts: [legs],
      plannedMeals: dayPlan(),
    });
    const training = runEngine(s, { date: MON, domains: ['training'], limit: 20 });
    expect(training.length).toBeGreaterThan(0);
    expect(training.every((r) => r.domain === 'training')).toBe(true);
    expect(runEngine(s, { date: MON, domains: ['safety'], limit: 20 })).toHaveLength(0);
  });

  it('plan suggestions are actions that go through the cascade', () => {
    const logs = [{ id: 'l', date: MON, slot: 'breakfast' as const, loggedAt: `${MON}T08:00:00Z`, name: 'x', method: 'quick' as const, macros: { kcal: 600, protein: 20, carbs: 80, fat: 20 } }];
    const recs = runEngine(state({ logEntries: logs, training: null }), { date: MON, hour: 18, domains: ['nutrition'], limit: 20 });
    const gap = recs.find((r) => r.kind === 'nutrition_gap')!;
    expect(gap.actions.length).toBeGreaterThan(0);
    expect(gap.actions.every((a) => a.type === 'add_meal' || a.type === 'log_food')).toBe(true);
  });
});

describe('Heute · meal time state (one rule for the card and the timeline)', () => {
  it('"now" from 30 min before the meal time, "overdue" more than 2 h after, other days by date', async () => {
    const { mealTimeState } = await import('./today');
    const T = '2026-09-22';
    expect(mealTimeState(T, '12:30', T, 11 * 60 + 59)).toBe('later');
    expect(mealTimeState(T, '12:30', T, 12 * 60)).toBe('now');
    expect(mealTimeState(T, '12:30', T, 14 * 60 + 30)).toBe('now');
    expect(mealTimeState(T, '12:30', T, 14 * 60 + 31)).toBe('overdue');
    expect(mealTimeState('2026-09-21', '19:00', T, 0)).toBe('overdue');
    expect(mealTimeState('2026-09-23', '07:30', T, 23 * 60)).toBe('later');
  });
});
