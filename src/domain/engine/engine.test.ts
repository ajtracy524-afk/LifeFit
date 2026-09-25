import { describe, expect, it } from 'vitest';
import { findTemplate } from '../../data/exercises';
import { getRecipe } from '../../data/recipes';
import { emptyState } from '../../store/persistence';
import { addDays } from '../dates';
import { recipeAllowed } from '../nutrition';
import { estimateSeconds } from '../training';
import type { AppState, LogEntry, PlannedMeal, Workout } from '../types';
import { applyGuardrails, computeSafety, validateCoachText } from './guardrails';
import { fitTemplateToTime } from './trainingRules';
import { runEngine, type Recommendation } from './index';

const MONDAY = '2026-09-21';
const SATURDAY = '2026-09-26';

function baseState(patch: Partial<AppState> = {}): AppState {
  return {
    ...emptyState(),
    profile: { name: 'Test', sex: 'male', age: 30, heightCm: 180, activity: 'moderate', experience: 'intermediate', createdAt: '2026-08-01T08:00:00' },
    goal: { type: 'muscle_gain', startWeightKg: 80, startedAt: '2026-08-01' },
    nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['breakfast', 'snack', 'lunch', 'dinner'] },
    targets: [{ id: 't', validFrom: '2026-08-01', method: 'formula', kcal: 2500, protein: 160, carbs: 300, fat: 75 }],
    training: { programId: 'push-pull-legs', weekdays: [0, 1, 2, 3, 4, 5] },
    weights: [{ id: 'w', date: '2026-08-01', kg: 80 }],
    ...patch,
  };
}

const quick = (date: string, slot: LogEntry['slot'], kcal: number, protein: number): LogEntry => ({
  id: `${date}-${slot}-${kcal}`,
  date,
  slot,
  loggedAt: `${date}T12:00:00`,
  name: 'Eintrag',
  method: 'quick',
  macros: { kcal, protein, carbs: 0, fat: 0 },
});

function completed(templateId: string, date: string): Workout {
  const t = findTemplate(templateId)!;
  return {
    id: `${templateId}-${date}`,
    date,
    templateId,
    name: t.name,
    startedAt: `${date}T18:00:00`,
    status: 'completed',
    exercises: t.exercises.map((e, i) => ({
      id: `${date}-${i}`,
      exerciseId: e.exerciseId,
      repMin: e.repMin,
      repMax: e.repMax,
      restSec: e.restSec,
      sets: Array.from({ length: e.sets }, (_, k) => ({ id: `${date}-${i}-${k}`, weightKg: 50, reps: 8, done: true, type: 'working' as const })),
    })),
  };
}

const byKind = (recs: Recommendation[], kind: Recommendation['kind']) => recs.find((r) => r.kind === kind);

describe('engine · nutrition gap', () => {
  // Without a training plan every day has the plain stored target (no training/rest-day shift).
  const plain = (patch: Partial<AppState> = {}) => baseState({ training: null, ...patch });
  const eaten = [quick(SATURDAY, 'breakfast', 600, 35), quick(SATURDAY, 'lunch', 900, 50), quick(SATURDAY, 'snack', 350, 25)];

  it('detects "650 kcal und 50 g Protein" and suggests dinner meals', () => {
    const recs = runEngine(plain({ logEntries: eaten }), { date: SATURDAY, hour: 18, limit: 20 });
    const gap = byKind(recs, 'nutrition_gap')!;
    expect(gap.title).toBe('Heute fehlen noch 650 kcal und 50 g Protein');
    expect(gap.actions.length).toBeGreaterThan(0);
    for (const a of gap.actions) {
      expect(a.type).toBe('add_meal');
      if (a.type === 'add_meal') expect(a.slot).toBe('dinner');
    }
  });

  it('respects diet exclusions as a hard filter', () => {
    const state = plain({ logEntries: eaten, nutritionProfile: { diet: 'vegan', excluded: ['gluten'], slots: ['breakfast', 'snack', 'lunch', 'dinner'] } });
    const gap = byKind(runEngine(state, { date: SATURDAY, hour: 18, limit: 20 }), 'nutrition_gap')!;
    for (const a of gap.actions) if (a.type === 'add_meal') expect(recipeAllowed(getRecipe(a.recipeId)!, state.nutritionProfile)).toBe(true);
  });

  it('suggests lean protein foods when only protein is missing', () => {
    const state = plain({ logEntries: [quick(SATURDAY, 'breakfast', 1200, 50), quick(SATURDAY, 'lunch', 1250, 60)] });
    const gap = byKind(runEngine(state, { date: SATURDAY, hour: 16, limit: 20 }), 'nutrition_gap')!;
    expect(gap.actions.length).toBeGreaterThan(0);
    expect(gap.actions.every((a) => a.type === 'log_food')).toBe(true);
  });

  it('counts still planned meals before suggesting anything', () => {
    const dinner: PlannedMeal = { id: 'd', date: SATURDAY, slot: 'dinner', recipeId: 'chicken-rice-bowl', servings: 1.3, status: 'planned', source: 'user' };
    const recs = runEngine(plain({ logEntries: eaten, plannedMeals: [dinner] }), { date: SATURDAY, hour: 18, limit: 20 });
    expect(byKind(recs, 'nutrition_gap')).toBeUndefined();
  });

  it('never proposes compensation when over target', () => {
    const recs = runEngine(plain({ logEntries: [quick(SATURDAY, 'lunch', 3200, 150)] }), { date: SATURDAY, hour: 20, limit: 20 });
    const over = byKind(recs, 'nutrition_over')!;
    expect(over.actions).toHaveLength(0);
    expect(validateCoachText(over.message).ok).toBe(true);
  });
});

describe('engine · training', () => {
  it('"bereits zweimal Beine trainiert" → alternative or reduced session', () => {
    // PPL on Mon–Sat: Saturday is legs. Legs were hit on Monday (full body) and Wednesday.
    const workouts = [completed('fb-a', MONDAY), completed('ppl-legs', addDays(MONDAY, 2))];
    const recs = runEngine(baseState({ workouts }), { date: SATURDAY, limit: 20 });
    const freq = byKind(recs, 'training_frequency')!;
    expect(freq.title).toBe('Du hast diese Woche bereits zweimal Beine trainiert');
    expect(freq.actions.some((a) => a.type === 'start_workout' && a.template.id === 'ppl-push')).toBe(true);
  });

  it('protects recovery when the same region was trained yesterday', () => {
    const recs = runEngine(baseState({ workouts: [completed('ppl-legs', addDays(SATURDAY, -1))] }), { date: SATURDAY, limit: 20 });
    const rec = byKind(recs, 'training_recovery')!;
    expect(rec.priority).toBe('high');
    expect(rec.actions[0]?.type === 'start_workout' && rec.actions[0].template.id).toBe('ppl-push');
    expect(byKind(recs, 'training_frequency')).toBeUndefined();
  });

  it('shortens the session to the available time and keeps the main lifts', () => {
    const template = findTemplate('ul-lower-a')!;
    const short = fitTemplateToTime(template, 30);
    expect(estimateSeconds(short)).toBeLessThanOrEqual(30 * 60);
    expect(short.exercises.slice(0, 2).map((e) => e.exerciseId)).toEqual(['squat', 'romanian-deadlift']);

    const recs = runEngine(baseState(), { date: SATURDAY, availableMinutes: 30, limit: 20 });
    expect(byKind(recs, 'training_time')?.title).toMatch(/^Nur 30 min\?/);
  });

  it('offers to catch up a missed session on a rest day', () => {
    const state = baseState({ training: { programId: 'push-pull-legs', weekdays: [0, 2, 4] } });
    const recs = runEngine(state, { date: addDays(MONDAY, 1), limit: 20 });
    expect(byKind(recs, 'training_missed')?.actions[0]?.type).toBe('start_workout');
  });
});

describe('engine · shopping', () => {
  const meals: PlannedMeal[] = [
    { id: 'a', date: addDays(SATURDAY, 1), slot: 'lunch', recipeId: 'chicken-rice-bowl', servings: 1, status: 'planned', source: 'user' },
  ];

  it('counts missing foods for planned meals and honours the pantry', () => {
    const count = getRecipe('chicken-rice-bowl')!.ingredients.length;
    let rec = byKind(runEngine(baseState({ plannedMeals: meals }), { date: SATURDAY, limit: 20 }), 'shopping_missing')!;
    expect(rec.title).toBe(`Für die geplanten Mahlzeiten fehlen noch ${count} Lebensmittel`);
    expect(rec.priority).toBe('high'); // needed tomorrow

    // 1 kg chicken in the pantry covers the planned 180 g.
    const state = baseState({ plannedMeals: meals, pantry: { chicken: { foodId: 'chicken', quantityG: 1000, updatedAt: '2026-09-20T08:00:00Z' } } });
    rec = byKind(runEngine(state, { date: SATURDAY, limit: 20 }), 'shopping_missing')!;
    expect(rec.facts.missing).toBe(count - 1);
  });
});

describe('engine · body trend & guardrails', () => {
  const flatWeights = Array.from({ length: 6 }, (_, i) => ({ id: `w${i}`, date: addDays('2026-09-01', i * 4), kg: 80 }));
  const logs = Array.from({ length: 12 }, (_, i) => quick(addDays(SATURDAY, -(i + 1)), 'lunch', 2500, 160));

  it('suggests a small calorie increase when muscle gain stalls', () => {
    const rec = byKind(runEngine(baseState({ weights: flatWeights, logEntries: logs }), { date: SATURDAY, limit: 20 }), 'body_rate')!;
    expect(rec.facts.delta).toBe(150);
    expect(rec.actions[0]?.type).toBe('set_targets');
  });

  it('never proposes eating less in safe mode', () => {
    const safety = computeSafety({ profile: { age: 30, heightCm: 180 }, goal: { type: 'fat_loss' }, weightKg: 58 });
    expect(safety.flags).toContain('underweight_deficit');

    const state = baseState({ goal: { type: 'fat_loss', startWeightKg: 58, startedAt: '2026-08-01' }, weights: flatWeights.map((w) => ({ ...w, kg: 58 })), logEntries: logs });
    const recs = runEngine(state, { date: SATURDAY, limit: 20 });
    expect(recs[0]?.kind).toBe('safety');
    expect(recs.some((r) => r.increasesDeficit)).toBe(false);
  });

  it('guardrails drop deficit recommendations only in safe mode', () => {
    const rec = { id: 'x', kind: 'body_rate', increasesDeficit: true } as Recommendation;
    expect(applyGuardrails([rec], { restricted: false, flags: [] }, SATURDAY)).toHaveLength(1);
    expect(applyGuardrails([rec], { restricted: true, flags: ['rapid_loss'] }, SATURDAY).map((r) => r.kind)).toEqual(['safety']);
  });

  it('validates generated text: no medical claims, no invented numbers', () => {
    expect(validateCoachText('Das deutet auf einen Eisenmangel hin.').ok).toBe(false);
    expect(validateCoachText('Lass das Abendessen heute einfach weg und faste.').ok).toBe(false);
    expect(validateCoachText('Dir fehlen noch 650 kcal – eine Bowl passt gut.', { missingKcal: 650 }).ok).toBe(true);
    expect(validateCoachText('Dir fehlen noch 1.850 kcal.', { missingKcal: 650 }).ok).toBe(false);
  });

  it('dismissed recommendations stay hidden for that day', () => {
    const state = baseState({ logEntries: [quick(SATURDAY, 'lunch', 3200, 150)] });
    const id = byKind(runEngine(state, { date: SATURDAY, limit: 20 }), 'nutrition_over')!.id;
    const recs = runEngine({ ...state, coach: { dismissed: { [id]: SATURDAY } } }, { date: SATURDAY, limit: 20 });
    expect(byKind(recs, 'nutrition_over')).toBeUndefined();
  });
});
