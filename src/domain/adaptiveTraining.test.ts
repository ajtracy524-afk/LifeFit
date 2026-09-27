import { describe, expect, it } from 'vitest';
import { findTemplate } from '../data/exercises';
import { emptyState } from '../store/persistence';
import { workoutAchievements } from './adaptive/achievements';
import { prescribe } from './adaptive/progression';
import { applyAdaptations, DISCOMFORT_NOTE, proposeAdaptations } from './adaptive/sessionAdapt';
import { runEngine } from './engine';
import { addDays } from './dates';
import { estimateMinutes } from './training';
import { trainingDayBonus } from './week';
import type { AppState, Effort, TemplateExercise, Workout, WorkoutExercise } from './types';

/** Adaptive training: every suggestion from stored data, explained, applied only on a decision. */

type SetDef = [weight: number | null, reps: number, rpe?: number];
let n = 0;
const ex = (exerciseId: string, sets: SetDef[], extra: Partial<WorkoutExercise> = {}): WorkoutExercise => ({
  id: `e${++n}`,
  exerciseId,
  repMin: 6,
  repMax: 10,
  restSec: 120,
  sets: sets.map(([weightKg, reps, rpe]) => ({ id: `s${++n}`, weightKg, reps, done: true, type: 'working' as const, ...(rpe ? { rpe } : {}) })),
  ...extra,
});
const workout = (date: string, exercises: WorkoutExercise[], extra: Partial<Workout> = {}): Workout => ({
  id: `w${++n}`,
  date,
  templateId: 'ppl-push',
  name: 'Push',
  startedAt: `${date}T17:00:00`,
  endedAt: `${date}T18:00:00`,
  status: 'completed',
  exercises,
  ...extra,
});
const te = (exerciseId: string, sets: number, repMin: number, repMax: number, extra: Partial<TemplateExercise> = {}): TemplateExercise => ({ exerciseId, sets, repMin, repMax, restSec: 120, ...extra });
const TODAY = '2026-09-22';

describe('progressive overload (next session of an exercise)', () => {
  it('plan 3 × 8 @ 80 kg, reality 8 / 8 / 8 → 82,5 kg × 8, with the reason', () => {
    const r = prescribe(te('bench-press', 3, 8, 8), [workout('2026-09-18', [ex('bench-press', [[80, 8], [80, 8], [80, 8]])])], TODAY);
    expect(r).toMatchObject({ change: 'increase', weightKg: 82.5, reps: 8, delta: { kg: 2.5 } });
    expect(r.reason).toBe('Letztes Training 3 × 80 kg (8 / 8 / 8) geschafft – oberes Ende erreicht.');
    expect(r.sets).toEqual([
      { weightKg: 82.5, reps: 8 },
      { weightKg: 82.5, reps: 8 },
      { weightKg: 82.5, reps: 8 },
    ]);
  });

  it('8 / 8 / 7 → not blindly heavier: hold 80 kg, goal all sets with 8', () => {
    const r = prescribe(te('bench-press', 3, 8, 8), [workout('2026-09-18', [ex('bench-press', [[80, 8], [80, 8], [80, 7]])])], TODAY);
    expect(r).toMatchObject({ change: 'hold', weightKg: 80, reps: 8 });
    expect(r.reason).toBe('Letztes Mal 8 / 8 / 7 – Gewicht halten, Ziel: alle Sätze mit 8 Wdh.');
  });

  it('worse performance (two sets below the range) → about 5 % lighter, at least one weight step', () => {
    const r = prescribe(te('bench-press', 3, 8, 10), [workout('2026-09-18', [ex('bench-press', [[80, 8], [80, 6], [80, 5]])])], TODAY);
    expect(r).toMatchObject({ change: 'reduce', weightKg: 75, reps: 8, delta: { kg: -5 } });
    expect(r.reason).toMatch(/unter 8 Wdh\./);
  });

  it('better performance inside the range → one rep more (never above the top); easy (RPE ≤ 7) → up to two', () => {
    expect(prescribe(te('bench-press', 3, 6, 10), [workout('2026-09-18', [ex('bench-press', [[80, 8], [80, 8], [80, 8]])])], TODAY)).toMatchObject({ change: 'reps', reps: 9, delta: { reps: 1 } });
    const easy = prescribe(te('bench-press', 3, 6, 10), [workout('2026-09-18', [ex('bench-press', [[80, 9, 7], [80, 9, 7], [80, 8, 7]])])], TODAY);
    expect(easy.sets.map((s) => s.reps)).toEqual([10, 10, 10]);
    expect(easy.reason).toMatch(/bei RPE 7 – heute bis zu zwei Wiederholungen mehr/);
  });

  it('high RPE: 9,5 → hold weight and reps; top reached at RPE 9 → hold once more instead of increasing', () => {
    const hard = prescribe(te('bench-press', 3, 6, 10), [workout('2026-09-18', [ex('bench-press', [[80, 8, 10], [80, 8, 9.5], [80, 8, 9]])])], TODAY);
    expect(hard).toMatchObject({ change: 'hold', weightKg: 80, reps: 8 });
    expect(hard.reason).toMatch(/Sehr hohe Belastung letztes Mal \(RPE 9,5\)/);
    const top = prescribe(te('bench-press', 3, 6, 10), [workout('2026-09-18', [ex('bench-press', [[80, 10, 9], [80, 10, 9], [80, 10, 9]])])], TODAY);
    expect(top).toMatchObject({ change: 'hold', weightKg: 80, reps: 10 });
    expect(top.reason).toBe('Oberes Ende erreicht, aber RPE 9 – noch einmal 80 kg, dann steigern.');
  });

  it('"zu hart" as feedback → lighter; "hart" at the top → hold', () => {
    const w = (effort: Effort) => [workout('2026-09-18', [ex('bench-press', [[80, 10], [80, 10], [80, 10]])], { feedback: { effort } })];
    expect(prescribe(te('bench-press', 3, 6, 10), w('too_hard'), TODAY)).toMatchObject({ change: 'reduce', weightKg: 75 });
    expect(prescribe(te('bench-press', 3, 6, 10), w('hard'), TODAY)).toMatchObject({ change: 'hold', weightKg: 80 });
    expect(prescribe(te('bench-press', 3, 6, 10), w('ok'), TODAY)).toMatchObject({ change: 'increase', weightKg: 82.5 });
  });

  it('replaced / skipped exercises: each exercise learns only from its own real sets', () => {
    const history = [
      workout('2026-09-10', [ex('bench-press', [[80, 10], [80, 10], [80, 10]])]),
      // Last time bench was skipped (no sets) and replaced by the machine press.
      workout('2026-09-17', [ex('bench-press', [], { skipped: true, planned: { exerciseId: 'bench-press', sets: 3, repMin: 6, repMax: 10 } }), ex('chest-press', [[50, 12], [50, 12], [50, 12]], { replacedFrom: 'incline-db-press' })]),
    ];
    expect(prescribe(te('bench-press', 3, 6, 10), history, TODAY)).toMatchObject({ change: 'increase', weightKg: 82.5 });
    expect(prescribe(te('bench-press', 3, 6, 10), history, TODAY).reason).toMatch(/80 kg \(10 \/ 10 \/ 10\)/);
    expect(prescribe(te('chest-press', 3, 8, 12), history, TODAY)).toMatchObject({ change: 'increase', weightKg: 55, reps: 8 }); // machine step 5 kg
  });

  it('first time → nothing invented; a long break → 10 % lighter to ease back in', () => {
    expect(prescribe(te('squat', 3, 6, 10), [], TODAY)).toMatchObject({ change: 'first', weightKg: null, reps: null });
    const r = prescribe(te('squat', 3, 6, 10), [workout('2026-08-15', [ex('squat', [[100, 8], [100, 8], [100, 8]])])], TODAY);
    expect(r).toMatchObject({ change: 'reduce', weightKg: 90 });
    expect(r.reason).toBe('Letztes Training vor 5 Wochen – leichter wieder einsteigen.');
  });

  it('the user overrides: two declined increases in a row → hold instead of pushing again', () => {
    const declined = (date: string) => workout(date, [ex('bench-press', [[80, 10], [80, 10], [80, 10]], { prescription: { change: 'increase', reason: '', weightKg: 82.5, reps: 6, decision: 'declined' } })]);
    const r = prescribe(te('bench-press', 3, 6, 10), [declined('2026-09-15'), declined('2026-09-18')], TODAY);
    expect(r).toMatchObject({ change: 'hold', weightKg: 80, reps: 10 });
    expect(r.reason).toMatch(/die letzten 2 Steigerungen nicht übernommen/);
    // One accepted in between → normal progression again.
    const mixed = [declined('2026-09-15'), workout('2026-09-18', [ex('bench-press', [[80, 10], [80, 10], [80, 10]], { prescription: { change: 'increase', reason: '', weightKg: 82.5, reps: 6, decision: 'accepted' } })])];
    expect(prescribe(te('bench-press', 3, 6, 10), mixed, TODAY).change).toBe('increase');
  });

  it('bodyweight: more reps; cardio: +5 min after two sessions that reached the plan, same when it was hard', () => {
    expect(prescribe(te('pull-up', 3, 5, 10), [workout('2026-09-18', [ex('pull-up', [[null, 6], [null, 6], [null, 5]])])], TODAY)).toMatchObject({ change: 'reps', weightKg: null, reps: 7 });
    const cardio = (date: string, effort?: Effort) =>
      workout(date, [{ ...ex('zone2-bike', []), sets: [{ id: `c${++n}`, weightKg: null, reps: null, done: true, type: 'working', durationMin: 30 }] }], { templateId: 'cardio-zone2', ...(effort ? { feedback: { effort } } : {}) });
    const plan = te('zone2-bike', 1, 0, 0, { durationMin: 30 });
    expect(prescribe(plan, [cardio('2026-09-15'), cardio('2026-09-19')], TODAY)).toMatchObject({ change: 'increase', durationMin: 35, delta: { min: 5 } });
    expect(prescribe(plan, [cardio('2026-09-15'), cardio('2026-09-19', 'hard')], TODAY)).toMatchObject({ change: 'same', durationMin: 30 });
  });
});

describe('check-in before the session (time, discomfort, energy) – proposals only', () => {
  const push = findTemplate('ppl-push')!;
  const legs = findTemplate('ppl-legs')!;

  it('less time: a compact version that keeps the main lifts, with what changes and why', () => {
    const [p] = proposeAdaptations(push, { minutes: 25 }, { history: [] });
    expect(p).toMatchObject({ kind: 'shorten', minutes: 25 });
    expect(p!.reason).toBe(`Du hast heute 25 min, geplant sind ~${estimateMinutes(push)} min. Die ersten Grundübungen bleiben, Zusatzübungen werden gekürzt.`);
    expect(p!.details!.length).toBeGreaterThan(0);
    const short = applyAdaptations(push, [p!]);
    expect(estimateMinutes(short)).toBeLessThanOrEqual(25);
    expect(short.exercises.slice(0, 2).map((e) => e.exerciseId)).toEqual(['bench-press', 'overhead-press']);
    expect(short.id).toBe(push.id); // still the same planned session
  });

  it('more time: an optional extra set on the main lifts (never automatically)', () => {
    const [p] = proposeAdaptations(push, { minutes: estimateMinutes(push) + 20 }, { history: [] });
    expect(p).toMatchObject({ kind: 'extra_set', title: 'Optional: +1 Satz bei Bankdrücken und Schulterdrücken (KH)' });
    expect(applyAdaptations(push, [p!]).exercises.slice(0, 2).map((e) => e.sets)).toEqual([4, 4]);
    expect(applyAdaptations(push, [])).toEqual({ ...push, exercises: push.exercises }); // nothing accepted → nothing changes
  });

  it('shoulder discomfort: bench press → dumbbell press as a proposal, no diagnosis; knee without a knee-friendly alternative → "auslassen"', () => {
    const shoulder = proposeAdaptations(push, { discomfort: ['shoulder'] }, { history: [] });
    const bench = shoulder.find((p) => p.index === 0)!;
    expect(bench).toMatchObject({ kind: 'swap', toExerciseId: 'db-bench-press', title: 'Kurzhantel-Bankdrücken statt Bankdrücken' });
    expect(bench.reason).toMatch(/Beschwerden \(Schulter\)/);
    expect(bench.reason).not.toMatch(/sicher|unbedenklich|heilt|Verletzung/);
    // The shoulder press itself targets the shoulder → no replacement (push-ups would be another muscle and load it too), only "auslassen".
    expect(shoulder.find((p) => p.index === 1)).toMatchObject({ kind: 'drop', title: 'Schulterdrücken (KH) heute auslassen' });
    expect(shoulder.find((p) => p.index === 2)).toMatchObject({ kind: 'swap', toExerciseId: 'db-bench-press' }); // incline: same main muscle (chest)
    expect(DISCOMFORT_NOTE).toMatch(/keine Diagnose/);
    expect(DISCOMFORT_NOTE).toMatch(/ärztlich oder physiotherapeutisch/);
    const knee = proposeAdaptations(legs, { discomfort: ['knee'] }, { history: [] });
    expect(knee.find((p) => p.index === 0)).toMatchObject({ kind: 'drop', title: 'Kniebeugen heute auslassen' });
    const applied = applyAdaptations(push, [bench]);
    expect(applied.exercises[0]!.exerciseId).toBe('db-bench-press');
  });

  it('last session very hard + only 25 min → "1 Satz weniger" with both reasons', () => {
    const hard = workout('2026-09-18', [ex('bench-press', [[80, 8, 9.5], [80, 8, 9.5]])], { templateId: 'ppl-push' });
    const proposals = proposeAdaptations(push, { minutes: 25 }, { history: [hard] });
    const fewer = proposals.find((p) => p.kind === 'fewer_sets')!;
    expect(fewer.reason).toBe('Letztes Training war bei hoher Belastung (RPE 9,5) und du hast heute nur 25 min. Die Grundübungen bleiben wie geplant.');
    expect(proposals.find((p) => p.kind === 'shorten')!.reason).toMatch(/Letztes Training war bei hoher Belastung \(RPE 9,5\)/);
    expect(proposeAdaptations(push, { energy: 'low' }, { history: [] })[0]!.reason).toMatch(/^Du fühlst dich heute müde\./);
  });
});

// ---------- Engine: level, cardio, training ↔ nutrition ----------

const MON = '2026-09-21';
const profile = { name: 'A', sex: 'male' as const, age: 30, heightCm: 180, activity: 'moderate' as const, experience: 'beginner' as const, createdAt: '2026-05-01T08:00:00' };
const base = (patch: Partial<AppState> = {}): AppState => ({
  ...emptyState(),
  profile,
  goal: { type: 'muscle_gain', startWeightKg: 80, startedAt: '2026-05-01' },
  nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['breakfast', 'lunch', 'snack', 'dinner'] },
  targets: [{ id: 't', validFrom: '2026-05-01', method: 'formula', kcal: 2600, protein: 160, carbs: 320, fat: 75 }],
  training: { programId: 'full-body', weekdays: [0, 3] },
  ...patch,
});

/** Two full-body sessions per week (Mon, Thu) for `weeks` weeks before MON; bench / squat rising by `step` kg per session. */
function history(weeks: number, step: number, days = [0, 3]): Workout[] {
  const out: Workout[] = [];
  let k = 0;
  for (let w = weeks; w >= 1; w--) {
    for (const d of days) {
      const date = addDays(MON, -7 * w + d);
      out.push(workout(date, [ex('bench-press', [[60 + k * step, 8], [60 + k * step, 8]]), ex('squat', [[80 + k * step, 8], [80 + k * step, 8]])], { templateId: 'fb-a', name: 'Ganzkörper' }));
      k++;
    }
  }
  return out;
}

describe('adaptive level (from real data, not from time alone)', () => {
  it('beginner, 2× full body, 4 weeks done reliably and stronger → offer 3× full body (user decides)', () => {
    const s = base({ workouts: history(8, 1.25) });
    const rec = runEngine(s, { date: MON, domains: ['training'], limit: 10 }).find((r) => r.kind === 'training_level')!;
    expect(rec.title).toBe('Bereit für eine Einheit mehr pro Woche');
    expect(rec.reasons[0]).toBe('8 / 8 Einheiten in 4 Wochen');
    expect(rec.reasons.some((r) => /Bankdrücken: \+\d+ % \(1RM geschätzt\)/.test(r))).toBe(true);
    expect(rec.actions).toEqual([{ type: 'set_program', label: '3× Ganzkörper pro Woche', programId: 'full-body', weekdays: [0, 2, 4] }]);
  });

  it('no level step without progress, with low adherence, or with too little history', () => {
    const level = (s: AppState) => runEngine(s, { date: MON, domains: ['training'], limit: 10 }).some((r) => r.kind === 'training_level');
    expect(level(base({ workouts: history(8, 0) }))).toBe(false); // time alone is not enough
    expect(level(base({ workouts: history(8, 1.25).filter((_, i) => i % 2 === 0) }))).toBe(false); // half the sessions
    expect(level(base({ workouts: history(4, 1.25) }))).toBe(false); // < 6 weeks
  });

  it('beginner on 3 days full body for 8+ weeks → a split (and the profile level) is offered – applied only via the action', async () => {
    const s = base({ training: { programId: 'full-body', weekdays: [0, 2, 4] }, workouts: history(9, 1, [0, 2, 4]) });
    const rec = runEngine(s, { date: MON, domains: ['training'], limit: 10 }).find((r) => r.kind === 'training_level')!;
    expect(rec.actions.map((a) => a.label)).toEqual(['Oberkörper / Unterkörper · 4 Tage', 'Push / Pull / Beine · 3 Tage']);
    const store = await import('../store/store');
    const actions = await import('../store/actions');
    store.commit(s);
    expect(store.getState().training!.programId).toBe('full-body'); // nothing happened by itself
    actions.applyEngineAction(rec.actions[0]!);
    expect(store.getState().training).toMatchObject({ programId: 'upper-lower', weekdays: [0, 1, 3, 4] });
    expect(store.getState().profile!.experience).toBe('intermediate');
    store.commit(emptyState());
  });
});

describe('cardio adaptation', () => {
  const rest = '2026-09-23'; // Wednesday – no session in the Mon / Thu plan
  it('fat loss, free day, no cardio in 7 days → an easy Zone-2 session with an honest message', () => {
    const rec = runEngine(base({ goal: { type: 'fat_loss', startWeightKg: 80, startedAt: '2026-05-01' } }), { date: rest, domains: ['training'], limit: 10 }).find((r) => r.kind === 'training_cardio')!;
    expect(rec.title).toBe('Trainingsfrei – 30 min lockeres Cardio?');
    expect(rec.message).toMatch(/Fett verlierst du über das Kaloriendefizit/);
    expect(rec.message).not.toMatch(/viszeral|verbrennt gezielt|Fettverbrennung/);
    expect(rec.actions[0]).toMatchObject({ type: 'start_workout', template: { id: 'cardio-zone2' } });
  });

  it('cardio done recently → nothing; the day after a very hard session → mobility instead', () => {
    const cardio = workout('2026-09-20', [{ ...ex('zone2-bike', []), sets: [{ id: 'c', weightKg: null, reps: null, done: true, type: 'working', durationMin: 30 }] }], { templateId: 'cardio-zone2' });
    expect(runEngine(base({ goal: { type: 'fat_loss', startWeightKg: 80, startedAt: '2026-05-01' }, workouts: [cardio] }), { date: rest, domains: ['training'], limit: 10 }).some((r) => r.kind === 'training_cardio')).toBe(false);
    const hard = workout('2026-09-22', [ex('squat', [[100, 8]])], { templateId: 'fb-a', feedback: { effort: 'too_hard' } });
    const rec = runEngine(base({ workouts: [hard] }), { date: rest, domains: ['training'], limit: 10 }).find((r) => r.kind === 'training_cardio')!;
    expect(rec).toMatchObject({ title: 'Trainingsfrei – Lust auf lockere Mobility?' });
    expect(rec.actions[0]).toMatchObject({ template: { id: 'mobility-recovery' } });
  });
});

describe('training ↔ nutrition', () => {
  const ppl = base({ training: { programId: 'push-pull-legs', weekdays: [0, 2, 4] }, plannerSettings: { priority: 'balanced', mealTimes: { breakfast: '07:30', snack: '15:00', lunch: '12:30', dinner: '19:30' }, trainingTime: '18:00' } });

  it('the day target knows the session: leg day with its bonus and label', () => {
    const days = ['2026-09-21', '2026-09-23', '2026-09-25'].map((d) => trainingDayBonus(ppl, d)!);
    const legs = days.find((d) => d.label === 'Beintag')!;
    expect(legs.kcal).toBeGreaterThan(150);
    expect(Math.min(...days.map((d) => d.kcal))).toBeLessThan(150);
  });

  it('pre-workout: training in 75 min, few carbs so far → a small carb snack sized from the own carb target', () => {
    const recs = runEngine(ppl, { date: MON, hour: 16, minute: 45, domains: ['nutrition'], limit: 10 });
    const pre = recs.find((r) => r.kind === 'pre_workout')!;
    expect(pre.title).toBe('Training in 75 min – ein kleiner Snack mit Kohlenhydraten?');
    expect(pre.message).toMatch(/^Bisher 0 von \d+ g Kohlenhydraten heute\./);
    expect(pre.message).toMatch(/musst du aber nicht/);
    expect(pre.actions[0]).toMatchObject({ type: 'log_food', foodId: 'banana', slot: 'snack' });
    expect(pre.facts.snackCarbs).toBe(Math.round((pre.facts.targetCarbs as number) * 0.12)); // 12 % of today's own carb target
    // Enough carbs already, or too early / too late → nothing.
    const fed = { ...ppl, logEntries: [{ id: 'l', date: MON, slot: 'lunch' as const, loggedAt: `${MON}T12:30:00`, name: 'Pasta', method: 'quick' as const, macros: { kcal: 900, protein: 40, carbs: 140, fat: 20 } }] };
    expect(runEngine(fed, { date: MON, hour: 16, minute: 45, domains: ['nutrition'] }).some((r) => r.kind === 'pre_workout')).toBe(false);
    expect(runEngine(ppl, { date: MON, hour: 13, domains: ['nutrition'] }).some((r) => r.kind === 'pre_workout')).toBe(false);
  });

  it('a large, fat-rich meal just now → a neutral hint instead of a snack (no digestion claims)', () => {
    const s = { ...ppl, logEntries: [{ id: 'b', date: MON, slot: 'snack' as const, loggedAt: `${MON}T16:20:00`, name: 'Burger', method: 'quick' as const, macros: { kcal: 1100, protein: 40, carbs: 80, fat: 60 } }] };
    const recs = runEngine(s, { date: MON, hour: 16, minute: 45, domains: ['nutrition'], limit: 10 });
    const heavy = recs.find((r) => r.kind === 'heavy_meal')!;
    expect(heavy.title).toBe('Training in 75 min – gerade eine größere Mahlzeit gegessen');
    expect(heavy.message).not.toMatch(/Verdauung|Magen|Krampf|schadet|gefährlich/);
    expect(recs.some((r) => r.kind === 'pre_workout')).toBe(false);
  });

  it('post-workout: the open gap is told as "Nach dem Training" with the session; a rest day stays as before', () => {
    const done = workout(MON, [ex('squat', [[100, 8], [100, 8], [100, 8]])], { templateId: 'ppl-legs', name: 'Beine – Kniebeuge & Hüfte', startedAt: `${MON}T18:00:00`, endedAt: `${MON}T19:00:00` });
    const gap = runEngine({ ...ppl, workouts: [done] }, { date: MON, hour: 20, domains: ['nutrition'], limit: 10 }).find((r) => r.kind === 'nutrition_gap')!;
    expect(gap.title).toMatch(/^Nach dem Training: noch /);
    expect(gap.reasons[0]).toBe('Training: Beine – Kniebeuge & Hüfte · 3 Sätze · 2.400 kg');
    expect(gap.reasons.some((r) => /^Beintag · Tagesziel heute \+\d+ kcal \(vor allem Kohlenhydrate\)$/.test(r))).toBe(true);
    // No regression: a normal day without training keeps the old title.
    const plain = runEngine(base(), { date: '2026-09-23', hour: 12, domains: ['nutrition'] }).find((r) => r.kind === 'nutrition_gap')!;
    expect(plain.title).toMatch(/^Heute fehlen noch /);
    expect(plain.facts.postWorkout).toBe(false);
  });
});

describe('achievements (only from data)', () => {
  it('streak of planned sessions, heavier than last time, more volume, faster – and none without a reason', () => {
    const s = base({ training: { programId: 'full-body', weekdays: [0, 3] } });
    const prev = [
      workout('2026-09-10', [ex('bench-press', [[60, 8]])], { templateId: 'fb-a' }),
      workout('2026-09-14', [ex('bench-press', [[60, 8]])], { templateId: 'fb-b' }),
      workout('2026-09-17', [ex('bench-press', [[60, 8], [60, 8]])], { templateId: 'fb-a', startedAt: '2026-09-17T17:00:00', endedAt: '2026-09-17T18:00:00' }),
    ];
    const today = workout(MON, [ex('bench-press', [[62.5, 8], [62.5, 8]])], { templateId: 'fb-a', startedAt: `${MON}T17:00:00`, endedAt: `${MON}T17:50:00` });
    const all = { ...s, workouts: [...prev, today] };
    const a = workoutAchievements(today, all);
    expect(a.map((x) => x.kind)).toEqual(['streak', 'weight_up', 'volume_up', 'faster']);
    expect(a[0]).toMatchObject({ icon: '🔥', title: '4. Training in Folge' });
    expect(a[1]!.detail).toBe('Bankdrücken 62,5 kg (+2,5 kg)');
    expect(a[3]!.detail).toBe('50 statt 60 min – mit mindestens gleich vielen Sätzen');
    // A missed planned session ends the streak; same performance → nothing to celebrate.
    const missed = { ...s, workouts: [prev[0]!, prev[2]!, today] };
    expect(workoutAchievements(today, missed).some((x) => x.kind === 'streak')).toBe(false);
    const same = workout(MON, [ex('bench-press', [[60, 8], [60, 8]])], { templateId: 'fb-a', startedAt: `${MON}T17:00:00`, endedAt: `${MON}T18:00:00` });
    expect(workoutAchievements(same, { ...s, workouts: [prev[2]!, same] })).toEqual([]);
  });
});
