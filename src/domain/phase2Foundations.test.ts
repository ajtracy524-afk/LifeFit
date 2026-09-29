import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState } from '../store/persistence';
import { diffPlans, planVersionAt, planVersionLabel, planVersions } from './planVersions';
import { exerciseProgress } from './trainingHistory';
import type { Workout } from './types';

const session = (date: string, weightKg: number, reps: number, rpe?: number): Workout =>
  ({
    id: date,
    date,
    status: 'completed',
    startedAt: `${date}T10:00:00`,
    exercises: [{ exerciseId: 'bench-press', sets: [0, 1, 2].map(() => ({ weightKg, reps, done: true, ...(rpe ? { rpe } : {}) })) }],
  }) as unknown as Workout;

describe('stagnation data basis', () => {
  it('says "insufficient" instead of guessing with few sessions', () => {
    const p = exerciseProgress([session('2026-09-01', 80, 8), session('2026-09-04', 80, 8), session('2026-09-08', 80, 8)], 'bench-press');
    expect(p).toEqual({ status: 'insufficient', sessions: 3 });
  });

  it('flags a possible stall when the last three sessions do not beat the earlier best', () => {
    const w = [session('2026-09-01', 80, 8), session('2026-09-04', 80, 8), session('2026-09-08', 80, 7), session('2026-09-11', 80, 8)];
    const p = exerciseProgress(w, 'bench-press');
    expect(p.status).toBe('possible_stall');
    expect(p.since).toBe('2026-09-04');
    expect(p.easy).toBeUndefined(); // no RPE logged → no claim about effort
  });

  it('sees progress and respects the date limit', () => {
    const w = [session('2026-09-01', 80, 8), session('2026-09-04', 80, 8), session('2026-09-08', 80, 8), session('2026-09-11', 82.5, 8)];
    expect(exerciseProgress(w, 'bench-press').status).toBe('progress');
    expect(exerciseProgress(w, 'bench-press', '2026-09-08').status).toBe('insufficient');
  });

  it('marks easy plateaus (mean RIR ≥ 3) and ignores bodyweight exercises', () => {
    const w = [session('2026-09-01', 80, 8, 7), session('2026-09-04', 80, 8, 7), session('2026-09-08', 80, 8, 6.5), session('2026-09-11', 80, 8, 7)];
    expect(exerciseProgress(w, 'bench-press')).toMatchObject({ status: 'possible_stall', easy: true, recentRpe: 6.8 });
    expect(exerciseProgress(w, 'push-up').status).toBe('bodyweight');
  });
});

describe('plan versions', () => {
  const at = (iso: string) => vi.setSystemTime(new Date(`${iso}T12:00:00`));
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
  afterEach(() => vi.useRealTimers());

  it('derives a v1 for older data without writing anything', () => {
    at('2026-10-10');
    const s = { ...emptyState(), training: { programId: 'full-body', weekdays: [0, 3], startedAt: '2026-10-01' } };
    const v = planVersions(s);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ number: 1, validFrom: '2026-10-01', current: true, programName: 'Ganzkörper', reason: 'start' });
    expect(planVersionLabel(v[0]!)).toBe('v1 · seit 01.10.');
    expect(s.planVersions).toBeUndefined();
  });

  it('writes a new version only when the plan really changes, one per day, with ranges and a diff', async () => {
    const store = await import('../store/store');
    const actions = await import('../store/actions');
    at('2026-10-01');
    store.commit({ ...emptyState(), training: { programId: 'full-body', weekdays: [0, 3], startedAt: '2026-10-01' } });

    at('2026-10-29');
    actions.updateTrainingProfile({ sessionMinutes: 45 }); // profile only → no version
    actions.updateTraining({ ...store.getState().training!, equipment: 'gym' }); // nothing plan-relevant
    expect(planVersions(store.getState()).map(planVersionLabel)).toEqual(['v1 · seit 01.10.']); // baseline only

    actions.updateTraining({ ...store.getState().training!, weekdays: [0, 2, 4] });
    actions.updateTraining({ ...store.getState().training!, weekdays: [0, 2, 5] }); // same day → same version
    const v = planVersions(store.getState());
    expect(v.map(planVersionLabel)).toEqual(['v1 · 01.10.–28.10.', 'v2 · seit 29.10.']);
    expect(v[1]!.reason).toBe('days');
    expect(diffPlans(v[0]!, v[1]!)).toEqual(['Trainingstage: Mo, Do → Mo, Mi, Sa']);
    expect(planVersionAt(store.getState(), '2026-10-15')!.number).toBe(1);

    at('2026-11-05');
    actions.updateTraining({ ...store.getState().training!, programId: 'upper-lower', startedAt: undefined }, { reason: 'coach' });
    const v3 = planVersions(store.getState())[2]!;
    expect(v3).toMatchObject({ reason: 'coach', programId: 'upper-lower', validFrom: '2026-11-05' });
    expect(diffPlans(planVersions(store.getState())[1]!, v3)).toEqual(['Programm: Ganzkörper → Oberkörper / Unterkörper']);
    // Scheduling still reads the live setup.
    expect(store.getState().training!.programId).toBe('upper-lower');
    store.commit(emptyState());
  });

  it('versions edits of routines in the active program – and ignores others', async () => {
    const store = await import('../store/store');
    const actions = await import('../store/actions');
    at('2026-10-01');
    store.commit({ ...emptyState(), training: { programId: 'full-body', weekdays: [0, 3], startedAt: '2026-10-01' } });
    const ex = (exerciseId: string, sets = 3) => ({ exerciseId, sets, repMin: 8, repMax: 10, restSec: 90 });
    const r = actions.saveRoutine({ name: 'Push', exercises: [ex('bench-press')] })!;
    expect(store.getState().planVersions ?? []).toHaveLength(1); // baseline only, the routine is not planned

    at('2026-10-08');
    const program = actions.saveProgram({ name: 'Mein Plan', routineIds: [r] })!;
    actions.updateTraining({ ...store.getState().training!, programId: program });
    at('2026-10-20');
    actions.saveRoutine({ name: 'Push', exercises: [ex('bench-press', 4), ex('lateral-raise')] }, r);
    const v = planVersions(store.getState());
    expect(v.map((x) => x.reason)).toEqual(['start', 'program', 'sessions']);
    expect(diffPlans(v[1]!, v[2]!)).toEqual(['Push: Bankdrücken 3 × 8–10 → 4 × 8–10', 'Push: Seitheben neu (3 × 8–10)']);
    // The frozen copy does not follow later edits.
    expect(v[1]!.sessions[0]!.exercises).toHaveLength(1);
    store.commit(emptyState());
  });

  it('an undo on the same day removes the day version again', async () => {
    const store = await import('../store/store');
    const actions = await import('../store/actions');
    at('2026-10-01');
    store.commit({ ...emptyState(), training: { programId: 'full-body', weekdays: [0, 3], startedAt: '2026-09-01' } });
    at('2026-10-02');
    actions.updateTraining({ ...store.getState().training!, weekdays: [1, 3] });
    actions.updateTraining({ ...store.getState().training!, weekdays: [0, 3] });
    expect(planVersions(store.getState()).map((x) => x.validFrom)).toEqual(['2026-09-01']);
    store.commit(emptyState());
  });
});
