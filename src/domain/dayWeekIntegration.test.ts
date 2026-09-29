import { describe, expect, it } from 'vitest';
import { emptyState } from '../store/persistence';
import { workoutAchievements } from './adaptive/achievements';
import { cookableRecipes } from './cookable';
import { dayGoals } from './dayGoals';
import { planSlotId } from './training';
import { weekProgress } from './weekProgress';
import type { AppState, LogEntry, Workout } from './types';

/** Heute + Ernährung + Training as one day and one week. */

const MON = '2026-09-21';
const TUE = '2026-09-22';
const WED = '2026-09-23';
const base = (patch: Partial<AppState> = {}): AppState => ({
  ...emptyState(),
  profile: { name: 'A', sex: 'male', age: 30, heightCm: 180, activity: 'moderate', experience: 'beginner', createdAt: '2026-09-01T08:00:00' },
  goal: { type: 'muscle_gain', startWeightKg: 80, startedAt: '2026-09-01' },
  nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['breakfast', 'lunch', 'dinner'], waterGoalMl: 2000 },
  targets: [{ id: 't', validFrom: '2026-09-01', method: 'formula', kcal: 2600, protein: 150, carbs: 320, fat: 75 }],
  training: { programId: 'push-pull-legs', weekdays: [0, 2] },
  ...patch,
});
const log = (date: string, kcal: number, protein: number): LogEntry => ({ id: `l${date}${kcal}`, date, slot: 'lunch', loggedAt: `${date}T12:00:00`, name: 'x', method: 'quick', macros: { kcal, protein, carbs: 200, fat: 60 } });
const done = (id: string, date: string, templateId: string, plannedId?: string): Workout => ({
  id,
  date,
  templateId,
  name: templateId,
  startedAt: `${date}T17:00:00`,
  endedAt: `${date}T18:00:00`,
  status: 'completed',
  exercises: [{ id: `${id}e`, exerciseId: 'bench-press', repMin: 6, repMax: 10, restSec: 120, sets: [{ id: `${id}s`, weightKg: 80, reps: 8, done: true, type: 'working' }] }],
  ...(plannedId ? { plannedId } : {}),
});

describe('training is part of the day', () => {
  it('a training day has a training goal (done once the session is done); a rest day has none', () => {
    const s = base();
    expect(dayGoals(s, MON).goals.find((g) => g.key === 'training')).toMatchObject({ done: false });
    expect(dayGoals(s, TUE).goals.some((g) => g.key === 'training')).toBe(false);
    const trained = base({ workouts: [done('w', MON, 'ppl-push')] });
    expect(dayGoals(trained, MON).goals.find((g) => g.key === 'training')).toMatchObject({ done: true, detail: 'ppl-push ✓' });
  });

  it('"Tag abgeschlossen" on a training day needs the training too', () => {
    const fed = { ...base({ logEntries: [log(MON, 2600, 160)], water: { [MON]: 2000 } }) };
    expect(dayGoals(fed, MON).complete).toBe(false);
    expect(dayGoals({ ...fed, workouts: [done('w', MON, 'ppl-push')] }, MON).complete).toBe(true);
  });
});

describe('the week as one story', () => {
  it('trainings done / planned, protein, calories and water days – counted only on days with data; next session and improvements', () => {
    const s = base({
      logEntries: [log(MON, 2600, 160), log(TUE, 1500, 90), log(WED, 2550, 155)],
      water: { [MON]: 2100, [TUE]: 800, [WED]: 2000 },
      workouts: [{ ...done('w', MON, 'ppl-push', planSlotId(MON, 0)), records: [{ exerciseId: 'bench-press', kind: 'rep', value: 9, weightKg: 80, reps: 9 }] }],
    });
    const p = weekProgress(s, MON, TUE);
    expect(p).toMatchObject({ days: 2, trainings: { done: 1, planned: 2 }, protein: 1, calories: 1, water: 1 });
    expect(p.next).toMatch(/ · (Push|Pull|Beine)/);
    expect(p.improvements).toEqual(['🏆 1 neue Bestleistung']);
    const later = weekProgress(s, MON, WED);
    expect(later).toMatchObject({ days: 3, protein: 2, water: 2 });
  });

  it('nothing logged → no protein / calorie count (no fake "0 von 3"); protein improvement only with enough days in both weeks', () => {
    const empty = weekProgress(base(), MON, WED);
    expect(empty.protein).toBeUndefined();
    expect(empty.calories).toBeUndefined();
    const lastWeek = ['2026-09-14', '2026-09-15', '2026-09-16'].map((d) => log(d, 2400, 120));
    const thisWeek = [MON, TUE, WED].map((d) => log(d, 2500, 140));
    expect(weekProgress(base({ logEntries: [...lastWeek, ...thisWeek] }), MON, WED).improvements).toEqual(['💪 Ø 20 g Protein mehr pro Tag als letzte Woche']);
  });

  it('the last planned session of the week → "Alle 2 Trainings dieser Woche erledigt"', () => {
    const first = done('a', MON, 'ppl-push', planSlotId(MON, 0));
    const second = done('b', WED, 'ppl-pull', planSlotId(MON, 1));
    const s = base({ workouts: [first, second] });
    expect(workoutAchievements(second, s).find((a) => a.kind === 'week_complete')).toMatchObject({ title: 'Alle 2 Trainings dieser Woche erledigt' });
    expect(workoutAchievements(first, base({ workouts: [first] })).some((a) => a.kind === 'week_complete')).toBe(false);
  });
});

describe('pantry → meals → training day', () => {
  it('"Was kann ich kochen?" prefers protein-rich dishes on a training day and says why; a rest day ranks as before', () => {
    const have = new Set(['rice', 'chicken', 'egg', 'skyr', 'broccoli']);
    const training = cookableRecipes(base(), MON, have);
    const rest = cookableRecipes(base(), TUE, have);
    expect(training.length).toBeGreaterThan(0);
    const first = training[0]!;
    expect(first.because[0]).toMatch(/^💪 \d+ g Protein – passt zum (Trainingstag|Beintag)$/);
    expect(rest.every((o) => o.because.length === 0)).toBe(true);
    const proteinShare = (list: typeof training) => list.slice(0, 3).reduce((s, o) => s + o.macros.protein, 0);
    expect(proteinShare(training)).toBeGreaterThanOrEqual(proteinShare(rest));
  });
});
