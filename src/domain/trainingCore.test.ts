import { describe, expect, it } from 'vitest';
import { builtInTemplates, EXERCISES, findTemplate, getExercise, getProgram, PROGRAMS } from '../data/exercises';
import { emptyState, renameLegacyWorkouts } from '../store/persistence';
import { exerciseRegions } from './engine/trainingRules';
import { alternativesFor, filterExercises } from './exerciseLibrary';
import { programPreview, programWeek, recommendProgram } from './programs';
import { createWorkout, estimateMinutes, workoutVolume } from './training';
import { exerciseHistory, planSummary, planVsActual, workoutStats } from './trainingHistory';
import { syncTraining } from './trainingPersonal';
import { detectRecords, recordText } from './workoutRecords';
import type { AppState, Workout, WorkoutSet } from './types';

/** Training premium core: library, sessions (plan vs. reality), records, history, routines, programs. */

const set = (weightKg: number | null, reps: number, extra: Partial<WorkoutSet> = {}): WorkoutSet => ({ id: `s${Math.random()}`, weightKg, reps, done: true, type: 'working', ...extra });
const workout = (id: string, startedAt: string, exercises: Array<{ exerciseId: string; sets: WorkoutSet[] }>): Workout => ({
  id,
  date: startedAt.slice(0, 10),
  templateId: 'ppl-push',
  name: 'Push',
  startedAt,
  endedAt: startedAt.replace(/T(\d\d)/, (_, h) => `T${String(Number(h) + 1).padStart(2, '0')}`),
  status: 'completed',
  exercises: exercises.map((e, i) => ({ id: `${id}-${i}`, exerciseId: e.exerciseId, repMin: 6, repMax: 10, restSec: 120, sets: e.sets })),
});

describe('exercise library', () => {
  it('every exercise is complete: unique id, muscles, level, type, steps, resolvable alternatives (never itself)', () => {
    const ids = new Set<string>();
    for (const e of EXERCISES) {
      expect(ids.has(e.id), e.id).toBe(false);
      ids.add(e.id);
      expect(e.name && e.muscle && e.description, e.id).toBeTruthy();
      expect(e.steps.length, e.id).toBeGreaterThan(0);
      expect(e.secondary).not.toContain(e.primary);
      for (const a of e.alternatives) {
        expect(getExercise(a), `${e.id} → ${a}`).toBeDefined();
        expect(a).not.toBe(e.id);
      }
    }
    expect(EXERCISES.length).toBeGreaterThanOrEqual(50);
    expect(EXERCISES.filter((e) => e.type === 'cardio').length).toBeGreaterThanOrEqual(4);
  });

  it('every template of every program only uses library exercises', () => {
    for (const t of builtInTemplates()) for (const e of t.exercises) expect(getExercise(e.exerciseId), `${t.id}: ${e.exerciseId}`).toBeDefined();
  });

  it('bench press: chest primary, triceps and front shoulder secondary, barbell, alternatives dumbbell press and chest press', () => {
    const bench = getExercise('bench-press')!;
    expect(bench).toMatchObject({ primary: 'chest', equipment: 'barbell', type: 'strength', mechanics: 'compound' });
    expect(bench.secondary).toEqual(['triceps', 'shoulders']);
    expect(bench.alternatives.slice(0, 2)).toEqual(['db-bench-press', 'chest-press']);
  });

  it('filters: muscle (primary first, secondary after), "Beine" = quads + hamstrings, equipment, level, type, search without umlauts', () => {
    const triceps = filterExercises({ muscle: 'triceps' }).map((e) => e.id);
    expect(triceps.indexOf('triceps-pushdown')).toBeLessThan(triceps.indexOf('bench-press'));
    const legs = filterExercises({ muscle: 'legs' }).map((e) => e.id);
    expect(legs).toEqual(expect.arrayContaining(['squat', 'leg-curl', 'romanian-deadlift']));
    expect(filterExercises({ equipment: 'machine' }).every((e) => e.equipment === 'machine')).toBe(true);
    expect(filterExercises({ difficulty: 'advanced' }).map((e) => e.id)).toEqual(expect.arrayContaining(['pull-up', 'deadlift']));
    expect(filterExercises({ type: 'cardio' }).every((e) => e.type === 'cardio')).toBe(true);
    expect(filterExercises({ query: 'KNIEBEU' }).map((e) => e.id)).toContain('squat');
    expect(filterExercises({ query: 'drucken' }).map((e) => e.id)).toContain('bench-press'); // "drücken" without umlaut
    expect(filterExercises({ muscle: 'chest', equipment: 'bodyweight' }).map((e) => e.id)).toEqual(['push-up', 'dips']);
  });

  it('replacements: curated alternatives first, then same primary muscle – limited to what the user can train with', () => {
    expect(alternativesFor('bench-press').slice(0, 3).map((e) => e.id)).toEqual(['db-bench-press', 'chest-press', 'push-up']);
    const home = alternativesFor('bench-press', 'home');
    expect(home.every((e) => ['dumbbell', 'bodyweight', 'band', 'kettlebell'].includes(e.equipment))).toBe(true);
    expect(home.map((e) => e.id)).toContain('push-up');
    expect(alternativesFor('squat', 'bodyweight').map((e) => e.id)).toEqual(['bodyweight-squat']);
  });

  it('new exercises count for the muscle regions of the engine (primary 1, secondary ½); cardio for none', () => {
    expect(exerciseRegions('bench-press')).toEqual({ chest: 1, shoulders: 0.5, arms: 0.5 }); // the tuned table stays
    expect(exerciseRegions('db-row')).toEqual({ back: 1, arms: 0.5 });
    expect(exerciseRegions('goblet-squat')).toEqual({ legs: 1, core: 0.5 });
    expect(exerciseRegions('zone2-bike')).toEqual({});
  });
});

describe('names, programs, beginner logic, cardio', () => {
  it('built-in sessions say what is inside – no "Training A / B"', () => {
    for (const t of builtInTemplates()) expect(t.name, t.id).not.toMatch(/^(Training|Ganzkörper|Oberkörper|Unterkörper) [AB]$|^(Push|Pull|Beine)$/);
    expect(findTemplate('fb-a')!.name).toBe('Ganzkörper – Kniebeuge & Bankdrücken');
    expect(findTemplate('ppl-pull')!.name).toBe('Pull – Rücken & Bizeps');
  });

  it('old workout names in the history get the current name (suffix kept); other names stay', () => {
    const w = (templateId: string, name: string) => ({ ...workout('x', '2026-09-01T10:00', []), templateId, name });
    const s = renameLegacyWorkouts({ ...emptyState(), workouts: [w('fb-a', 'Ganzkörper A'), w('ul-lower-b', 'Unterkörper B (kurz)'), w('fb-a', 'Mein Tag'), w('ppl-push', 'Push')] });
    expect(s.workouts.map((x) => x.name)).toEqual(['Ganzkörper – Kniebeuge & Bankdrücken', 'Unterkörper – Kreuzheben & Po (kurz)', 'Mein Tag', 'Push – Brust, Schulter & Trizeps']);
    const unchanged = { ...emptyState(), workouts: [w('fb-a', 'Mein Tag')] };
    expect(renameLegacyWorkouts(unchanged)).toBe(unchanged);
  });

  it('recommendation: beginner + 2 days → full body, intermediate + 4 → upper/lower, equipment first, fat loss adds Zone 2 (not a split)', () => {
    expect(recommendProgram({ days: 2, experience: 'beginner' })).toBe('full-body');
    expect(recommendProgram({ days: 3, experience: 'beginner' })).toBe('full-body');
    expect(recommendProgram({ days: 3, experience: 'beginner', goal: 'fat_loss' })).toBe('strength-cardio');
    expect(recommendProgram({ days: 3, experience: 'intermediate' })).toBe('push-pull-legs');
    expect(recommendProgram({ days: 4, experience: 'intermediate' })).toBe('upper-lower');
    expect(recommendProgram({ days: 6, experience: 'intermediate' })).toBe('push-pull-legs');
    expect(recommendProgram({ days: 4, experience: 'beginner', equipment: 'home' })).toBe('home-full-body');
    expect(recommendProgram({ days: 3, experience: 'intermediate', equipment: 'bodyweight' })).toBe('bodyweight-basics');
  });

  it('fat-loss program: honest text – no targeted or visceral fat claims; cardio is a real session with minutes', () => {
    const p = getProgram('strength-cardio')!;
    expect(p.description).toMatch(/Kaloriendefizit/);
    expect(p.description).toMatch(/kein Training verbrennt gezielt Bauchfett/);
    for (const x of [...PROGRAMS.map((q) => q.description), ...EXERCISES.flatMap((e) => [e.description, ...e.tips])]) expect(x).not.toMatch(/viszeral|Fett ?verbrennung|fettverbrennend|schmilzt/i);
    const zone2 = findTemplate('cardio-zone2')!;
    expect(zone2.exercises[0]).toMatchObject({ exerciseId: 'zone2-bike', durationMin: 30 });
    expect(estimateMinutes(zone2)).toBe(30);
    const w = createWorkout(zone2, [], '2026-09-22');
    expect(w.exercises[0]!.sets[0]).toMatchObject({ durationMin: 30, weightKg: null, reps: null });
    for (const t of PROGRAMS.flatMap((x) => x.templates)) expect(t.exercises.length).toBeGreaterThan(0);
  });

  it('program preview = the real rotation (Mo / Mi / Fr), "Woche x von y" from the start date', () => {
    const [w1, w2] = programPreview('push-pull-legs', [0, 2, 4], '2026-09-22');
    expect(w1!.days.map((d) => d.weekday)).toEqual([0, 2, 4]);
    expect(new Set([...w1!.days, ...w2!.days].map((d) => d.name)).size).toBe(3);
    expect(programWeek({ programId: 'upper-lower', weekdays: [0, 1, 3, 4], startedAt: '2026-09-01' }, '2026-09-22')).toEqual({ week: 4, of: 12 });
    expect(programWeek({ programId: 'upper-lower', weekdays: [0] }, '2026-09-22')).toBeUndefined();
  });

  it('own routines and programs are known to the scheduler like built-in ones', () => {
    const state: Pick<AppState, 'routines' | 'customPrograms'> = {
      routines: { 'routine:1': { id: 'routine:1', name: 'Mein Push', focus: '', exercises: [{ exerciseId: 'push-up', sets: 3, repMin: 8, repMax: 15, restSec: 60 }], createdAt: '', updatedAt: '' } },
      customPrograms: { 'program:1': { id: 'program:1', name: 'Mein Plan', routineIds: ['routine:1', 'fb-b', 'gone'], createdAt: '' } },
    };
    syncTraining(state);
    expect(findTemplate('routine:1')!.name).toBe('Mein Push');
    expect(getProgram('program:1')!.templates.map((t) => t.id)).toEqual(['routine:1', 'fb-b']); // a deleted routine simply drops out
    expect(programPreview('program:1', [0, 3], '2026-09-21')[0]!.days.map((d) => d.name)).toEqual(expect.arrayContaining(['Mein Push']));
    syncTraining({ routines: {}, customPrograms: {} });
    expect(findTemplate('routine:1')).toBeUndefined();
  });
});

describe('personal records (one logic for live + summary)', () => {
  const before = workout('a', '2026-09-01T10:00', [{ exerciseId: 'bench-press', sets: [set(80, 8), set(80, 8), set(80, 7)] }]);

  it('weight PR: heavier than ever → "+5 kg"', () => {
    const w = workout('b', '2026-09-08T10:00', [{ exerciseId: 'bench-press', sets: [set(85, 6)] }]);
    const [r] = detectRecords(w, [before, w]);
    expect(r).toMatchObject({ kind: 'max_weight', value: 85, previous: 80 });
    expect(recordText(r!)).toEqual({ icon: '🏆', title: 'Neue Bestleistung', detail: 'Bankdrücken · 85 kg × 6 (+5 kg)' });
  });

  it('rep PR: more reps at the same weight → "10 statt 8"', () => {
    const w = workout('b', '2026-09-08T10:00', [{ exerciseId: 'bench-press', sets: [set(80, 10)] }]);
    const [r] = detectRecords(w, [before, w]);
    expect(r).toMatchObject({ kind: 'rep', value: 10, previous: 8 });
    expect(recordText(r!).detail).toBe('Bankdrücken · 80 kg: 10 statt 8');
  });

  it('volume PR when no set beats a best; e1RM PR for a lighter but stronger set', () => {
    const volume = workout('b', '2026-09-08T10:00', [{ exerciseId: 'bench-press', sets: [set(80, 8), set(80, 8), set(80, 8), set(80, 6)] }]);
    expect(detectRecords(volume, [before, volume])[0]).toMatchObject({ kind: 'volume', previous: 1840 });
    const e1rm = workout('c', '2026-09-08T10:00', [{ exerciseId: 'bench-press', sets: [set(75, 12)] }]); // 105 kg est. vs 101.3
    expect(detectRecords(e1rm, [before, e1rm])[0]).toMatchObject({ kind: 'est_1rm' });
  });

  it('no fake records: first time, same performance, warm-ups, skipped sets never count; one per exercise', () => {
    const first = workout('x', '2026-09-08T10:00', [{ exerciseId: 'squat', sets: [set(100, 5)] }]);
    expect(detectRecords(first, [first])).toEqual([]);
    const same = workout('b', '2026-09-08T10:00', [{ exerciseId: 'bench-press', sets: [set(80, 8)] }]);
    expect(detectRecords(same, [before, same])).toEqual([]);
    const warm = workout('c', '2026-09-08T10:00', [{ exerciseId: 'bench-press', sets: [set(100, 5, { type: 'warmup' }), set(90, 3, { skipped: true, done: false })] }]);
    expect(detectRecords(warm, [before, warm])).toEqual([]);
    const both = workout('d', '2026-09-08T10:00', [{ exerciseId: 'bench-press', sets: [set(85, 6), set(80, 10)] }]);
    expect(detectRecords(both, [before, both])).toHaveLength(1);
    expect(detectRecords(both, [before, both])[0]!.kind).toBe('max_weight');
  });

  it('bodyweight: more reps than ever; drop / failure / AMRAP sets count like normal sets', () => {
    const p1 = workout('p1', '2026-09-01T10:00', [{ exerciseId: 'pull-up', sets: [set(null, 8)] }]);
    const p2 = workout('p2', '2026-09-08T10:00', [{ exerciseId: 'pull-up', sets: [set(null, 10, { type: 'amrap' })] }]);
    expect(detectRecords(p2, [p1, p2])[0]).toMatchObject({ kind: 'max_reps', value: 10, previous: 8 });
    expect(workoutVolume(workout('v', '2026-09-08T10:00', [{ exerciseId: 'bench-press', sets: [set(80, 8, { type: 'drop' }), set(20, 10, { type: 'warmup' })] }]))).toBe(640);
  });
});

describe('plan vs. reality and history (through the real actions)', () => {
  it('fewer reps, an extra set, a skipped and a replaced exercise, an extra exercise, stopping early – plan and reality both stay readable', async () => {
    const store = await import('../store/store');
    const actions = await import('../store/actions');
    const history = workout('old', '2026-09-01T10:00', [{ exerciseId: 'bench-press', sets: [set(80, 8), set(80, 8), set(80, 8)] }]);
    store.commit({ ...emptyState(), workouts: [history], training: { programId: 'push-pull-legs', weekdays: [0, 2, 4] } });
    const id = actions.startWorkoutFrom(findTemplate('ppl-push')!, '2026-09-08')!;
    const w = () => store.getState().workouts.find((x) => x.id === id)!;
    const ex = (i: number) => w().exercises[i]!;

    // Bench: prefilled with today's target (80 × 9), 9 / 9 / 7 done, plus one extra set.
    expect(ex(0).sets.map((s) => [s.weightKg, s.reps])).toEqual([
      [80, 9],
      [80, 9],
      [80, 9],
    ]);
    actions.updateSet(id, ex(0).id, ex(0).sets[2]!.id, { reps: 7 });
    for (const s of ex(0).sets) actions.completeSet(id, ex(0).id, s.id, true);
    actions.addSet(id, ex(0).id);
    actions.completeSet(id, ex(0).id, ex(0).sets[3]!.id, true);
    // Shoulder press: skipped. Incline: replaced by the machine chest press (keeps the plan), 2 of 3 sets.
    actions.skipExercise(id, ex(1).id, true);
    actions.replaceExercise(id, ex(2).id, 'chest-press');
    expect(ex(2)).toMatchObject({ exerciseId: 'chest-press', replacedFrom: 'incline-db-press', planned: { exerciseId: 'incline-db-press', sets: 3 } });
    actions.updateSet(id, ex(2).id, ex(2).sets[0]!.id, { weightKg: 50, reps: 10 });
    actions.completeSet(id, ex(2).id, ex(2).sets[0]!.id, true);
    actions.completeSet(id, ex(2).id, ex(2).sets[1]!.id, true);
    // Lateral raise: one set skipped on purpose, one as warm-up, one done.
    actions.skipSet(id, ex(3).id, ex(3).sets[0]!.id, true);
    actions.setSetType(id, ex(3).id, ex(3).sets[1]!.id, 'warmup');
    actions.updateSet(id, ex(3).id, ex(3).sets[1]!.id, { weightKg: 4, reps: 15 });
    actions.updateSet(id, ex(3).id, ex(3).sets[2]!.id, { weightKg: 8, reps: 15 });
    actions.completeSet(id, ex(3).id, ex(3).sets[1]!.id, true);
    actions.completeSet(id, ex(3).id, ex(3).sets[2]!.id, true);
    // An exercise that was not planned; triceps pushdown never started (stopped early).
    actions.addExerciseToWorkout(id, 'face-pull');
    const face = w().exercises[w().exercises.length - 1]!;
    actions.updateSet(id, face.id, face.sets[0]!.id, { weightKg: 20, reps: 15 });
    actions.completeSet(id, face.id, face.sets[0]!.id, true);
    actions.finishWorkout(id);

    const done = w();
    expect(done.status).toBe('completed');
    const rows = done.exercises.map((e) => [e.exerciseId, planVsActual(e).status]);
    expect(rows).toEqual([
      ['bench-press', 'more'],
      ['overhead-press', 'skipped'],
      ['chest-press', 'replaced'],
      ['lateral-raise', 'less'],
      ['triceps-pushdown', 'skipped'],
      ['face-pull', 'extra'],
    ]);
    expect(planVsActual(done.exercises[0]!)).toMatchObject({ planned: '3 × 6–10 @ 80 kg', actual: '9 @ 80 · 9 @ 80 · 7 @ 80 · 7 @ 80' }); // "+ Satz" copies the last set
    expect(planVsActual(done.exercises[2]!)).toMatchObject({ replacedFrom: 'Schrägbankdrücken (KH)', actual: '10 @ 50 · 10 @ 50' });
    expect(planSummary(done)).toBe('1 von 5 Übungen wie geplant · 1 mit weniger Sätzen/Wdh. · 1 ersetzt · 2 ausgelassen · 1 zusätzlich');
    // Warm-up is kept, but not counted; the skipped set is gone from the history.
    expect(done.exercises[3]!.sets.map((s) => s.type)).toEqual(['warmup', 'working']);
    const stats = workoutStats(done);
    // bench 9·80 + 9·80 + 7·80 + 7·80, chest press 2 × 10·50, lateral 8·15 (warm-up not counted), face pull 20·15
    expect(stats).toMatchObject({ exercises: 4, sets: 8, volumeKg: 2560 + 1000 + 120 + 300 });
    // Rep record on the bench (9 statt 8) – real, against the old session only.
    expect(done.records?.map((r) => [r.exerciseId, r.kind])).toEqual([['bench-press', 'rep']]);
    // The next session reads what really happened – the history is intact.
    expect(exerciseHistory(store.getState().workouts, 'bench-press').map((h) => h.best)).toEqual([
      { weightKg: 80, reps: 8 },
      { weightKg: 80, reps: 9 },
    ]);
    store.commit(emptyState());
  });

  it('routines: create, edit, duplicate (also from a built-in session), delete; own programs rotate them; the active program cannot be deleted', async () => {
    const store = await import('../store/store');
    const actions = await import('../store/actions');
    store.commit({ ...emptyState(), training: { programId: 'full-body', weekdays: [0, 3] } });
    expect(actions.saveRoutine({ name: ' ', exercises: [] })).toBeUndefined();
    const id = actions.saveRoutine({ name: 'Push', exercises: [{ exerciseId: 'bench-press', sets: 30, repMin: 8, repMax: 6, restSec: 90 }] })!;
    expect(store.getState().routines[id]!.exercises[0]).toMatchObject({ sets: 10, repMin: 8, repMax: 8 }); // clamped, range kept valid
    actions.saveRoutine({ name: 'Push – Brust', exercises: [{ exerciseId: 'bench-press', sets: 3, repMin: 6, repMax: 8, restSec: 120 }] }, id);
    expect(findTemplate(id)!.name).toBe('Push – Brust');
    const copy = actions.duplicateRoutine(id)!;
    expect(store.getState().routines[copy]!.name).toBe('Push – Brust (Kopie)');
    const builtIn = actions.duplicateRoutine('ppl-pull')!;
    expect(store.getState().routines[builtIn]).toMatchObject({ name: 'Pull – Rücken & Bizeps (Kopie)', copiedFrom: 'ppl-pull' });

    const program = actions.saveProgram({ name: 'Mein Split', routineIds: [id, builtIn], weeks: 10 })!;
    actions.updateTraining({ programId: program, weekdays: [0, 3] });
    expect(store.getState().training).toMatchObject({ programId: program, startedAt: expect.any(String) });
    expect(actions.deleteProgram(program)).toBe(false);
    // Starting an own routine works like any session.
    const wid = actions.startWorkoutFrom(findTemplate(id)!, '2026-09-22');
    expect(store.getState().workouts.find((w) => w.id === wid)!.templateId).toBe(id);
    actions.discardWorkout(wid);
    expect(actions.deleteRoutine(id)).toBe(true);
    expect(store.getState().customPrograms[program]!.routineIds).toEqual([builtIn]);
    expect(findTemplate(id)).toBeUndefined();
    store.commit(emptyState());
  });
});
