import { getExercise, getProgram } from '../data/exercises';
import { newId } from '../lib/id';
import { addDays, daysBetween, weekDays } from './dates';
import { TIME_BUDGETS } from './timeBudget';
import type { DayContext, ISODate, PersonalRecord, PlanSlotId, TemplateExercise, TrainingSetup, Workout, WorkoutOverride, WorkoutSet, WorkoutTemplate } from './types';

export interface ScheduledWorkout {
  date: ISODate;
  template: WorkoutTemplate;
}

const EPOCH_MONDAY = '2024-01-01';

/**
 * Training days of a week with their template. Templates rotate continuously
 * across weeks, so a 3-day full-body plan alternates A/B/A → B/A/B.
 */
export function scheduleForWeek(setup: TrainingSetup | null, weekStartDate: ISODate): ScheduledWorkout[] {
  if (!setup) return [];
  const program = getProgram(setup.programId);
  if (!program || program.templates.length === 0) return [];
  const days = [...setup.weekdays].sort((a, b) => a - b);
  const weekIndex = Math.floor(daysBetween(EPOCH_MONDAY, weekStartDate) / 7);
  const dates = weekDays(weekStartDate);
  return days.map((weekday, k) => ({
    date: dates[weekday]!,
    template: program.templates[(weekIndex * days.length + k) % program.templates.length]!,
  }));
}

/** Session length in seconds: rest time plus ~40 s per set. */
export function estimateSeconds(template: Pick<WorkoutTemplate, 'exercises'>): number {
  return template.exercises.reduce((s, e) => s + e.sets * (e.restSec + 40), 0);
}

/** Rough session length in minutes, rounded to 5. */
export function estimateMinutes(template: Pick<WorkoutTemplate, 'exercises'>): number {
  return Math.max(15, Math.round(estimateSeconds(template) / 60 / 5) * 5);
}

// ---------- Session length ----------

/**
 * Shortens a template to fit the available minutes. Order of cuts:
 * 1. rest of accessories (from the 3rd exercise) to max 75 s
 * 2. accessory sets down to 2, starting at the end
 * 3. drop accessories from the end
 * 4. compound sets down to 2
 * The first two (compound) exercises are always kept.
 */
export function fitTemplateToTime(template: WorkoutTemplate, minutes: number): WorkoutTemplate {
  const budget = minutes * 60;
  let ex: TemplateExercise[] = template.exercises.map((e) => ({ ...e }));
  const fits = () => estimateSeconds({ exercises: ex }) <= budget;

  if (!fits()) ex = ex.map((e, i) => (i >= 2 ? { ...e, restSec: Math.min(e.restSec, 75) } : e));

  while (!fits()) {
    const accessory = findLastIndex(ex, (e, i) => i >= 2 && e.sets > 2);
    if (accessory >= 0) {
      ex[accessory]!.sets -= 1;
      continue;
    }
    if (ex.length > 2) {
      ex.pop();
      continue;
    }
    const compound = findLastIndex(ex, (e) => e.sets > 2);
    if (compound >= 0) {
      ex[compound]!.sets -= 1;
      continue;
    }
    break;
  }
  return { ...template, name: `${template.name} (kurz)`, exercises: ex };
}

function findLastIndex<T>(list: T[], pred: (item: T, index: number) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) if (pred(list[i]!, i)) return i;
  return -1;
}

export function isCompletedOn(workouts: Workout[], date: ISODate): Workout | undefined {
  return workouts.find((w) => w.status === 'completed' && w.date === date);
}

// ---------- Concrete week: rotation + overrides ----------

export function planSlotId(weekStartDate: ISODate, index: number): PlanSlotId {
  return `${weekStartDate}#${index}`;
}

/** A session of a concrete week. Extends ScheduledWorkout, so existing callers keep working. */
export interface PlannedWorkout extends ScheduledWorkout {
  id: PlanSlotId;
  /** Day according to the rotation – the original plan stays traceable. */
  originalDate: ISODate;
  status: 'scheduled' | 'moved' | 'skipped';
  completedWorkoutId?: string;
}

/**
 * The single source for "which session happens when" in a concrete week:
 * the rotation (scheduleForWeek) is the template, overrides move or skip
 * single sessions. Rotation stays calendar-based: a skipped session is done
 * for this week, nothing shifts.
 *
 * Completion: a workout with `plannedId` belongs to that session; older
 * workouts without it are matched by date (as before).
 */
export function resolveWorkouts(
  setup: TrainingSetup | null,
  overrides: Record<PlanSlotId, WorkoutOverride>,
  workouts: Workout[],
  weekStartDate: ISODate,
  dayContexts: Record<ISODate, DayContext> = {},
): PlannedWorkout[] {
  const planned: PlannedWorkout[] = scheduleForWeek(setup, weekStartDate).map((s, k) => {
    const id = planSlotId(weekStartDate, k);
    const o = overrides[id];
    const moved = o?.status === 'moved' && o.date;
    const date = moved ? o.date! : s.date;
    return {
      ...s,
      id,
      originalDate: s.date,
      date,
      template: templateForDay(s.template, dayContexts[date]),
      status: o?.status === 'skipped' ? 'skipped' : moved ? 'moved' : 'scheduled',
    };
  });

  const completed = workouts.filter((w) => w.status === 'completed');
  const claimed = new Set<string>();
  for (const p of planned) {
    const byId = completed.find((w) => w.plannedId === p.id);
    if (byId) {
      p.completedWorkoutId = byId.id;
      claimed.add(byId.id);
    }
  }
  for (const p of planned) {
    if (p.completedWorkoutId || p.status === 'skipped') continue;
    const byDate = completed.find((w) => !w.plannedId && !claimed.has(w.id) && w.date === p.date);
    if (byDate) {
      p.completedWorkoutId = byDate.id;
      claimed.add(byDate.id);
    }
  }
  return planned.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * F5: on a "wenig Zeit" day the session is shortened to the day's training
 * time (main lifts stay). Date and rotation do not change.
 */
export function templateForDay(template: WorkoutTemplate, context: DayContext | undefined): WorkoutTemplate {
  const minutes = context ? TIME_BUDGETS[context.timeBudget].trainingMin : undefined;
  return minutes && estimateMinutes(template) > minutes ? fitTemplateToTime(template, minutes) : template;
}

/** Sessions that take place (not skipped) – what the screens show. */
export function activeWorkouts(
  setup: TrainingSetup | null,
  overrides: Record<PlanSlotId, WorkoutOverride>,
  workouts: Workout[],
  weekStartDate: ISODate,
  dayContexts: Record<ISODate, DayContext> = {},
): PlannedWorkout[] {
  return resolveWorkouts(setup, overrides, workouts, weekStartDate, dayContexts).filter((p) => p.status !== 'skipped');
}

/** Next open session from `fromDate` on (today first if still open). */
export function nextScheduled(
  setup: TrainingSetup | null,
  workouts: Workout[],
  fromDate: ISODate,
  weekStartDate: ISODate,
  overrides: Record<PlanSlotId, WorkoutOverride> = {},
  dayContexts: Record<ISODate, DayContext> = {},
): PlannedWorkout | undefined {
  const upcoming = [
    ...activeWorkouts(setup, overrides, workouts, weekStartDate, dayContexts),
    ...activeWorkouts(setup, overrides, workouts, addDays(weekStartDate, 7), dayContexts),
  ];
  return upcoming.find((s) => s.date >= fromDate && !s.completedWorkoutId);
}

// ---------- Session creation & progression ----------

export function lastSetsFor(workouts: Workout[], exerciseId: string, excludeId?: string): WorkoutSet[] | undefined {
  const sorted = workouts
    .filter((w) => w.status === 'completed' && w.id !== excludeId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  for (const w of sorted) {
    const ex = w.exercises.find((e) => e.exerciseId === exerciseId);
    const done = ex?.sets.filter((s) => s.done && s.type === 'working');
    if (done && done.length > 0) return done;
  }
  return undefined;
}

export function weightStep(exerciseId: string): number {
  const ex = getExercise(exerciseId);
  if (!ex) return 2.5;
  if (ex.equipment === 'dumbbell') return 2;
  if (ex.equipment === 'machine' || ex.equipment === 'cable') return 5;
  return 2.5;
}

/**
 * Double progression: when every working set reached the top of the rep range,
 * suggest more weight. Returns undefined if the user should repeat the weight.
 */
export function progressionSuggestion(last: WorkoutSet[] | undefined, repMax: number, exerciseId: string): number | undefined {
  if (!last || last.length === 0) return undefined;
  const ex = getExercise(exerciseId);
  if (ex?.bodyweight) return undefined;
  const weight = Math.max(...last.map((s) => s.weightKg ?? 0));
  if (weight <= 0) return undefined;
  const allTop = last.every((s) => (s.reps ?? 0) >= repMax);
  return allTop ? weight + weightStep(exerciseId) : undefined;
}

export function createWorkout(template: WorkoutTemplate, history: Workout[], date: ISODate): Workout {
  return {
    id: newId(),
    date,
    templateId: template.id,
    name: template.name,
    startedAt: new Date().toISOString(),
    status: 'in_progress',
    exercises: template.exercises.map((te) => {
      const last = lastSetsFor(history, te.exerciseId);
      const suggested = progressionSuggestion(last, te.repMax, te.exerciseId);
      return {
        id: newId(),
        exerciseId: te.exerciseId,
        repMin: te.repMin,
        repMax: te.repMax,
        restSec: te.restSec,
        sets: Array.from({ length: te.sets }, (_, i) => {
          const prev = last?.[Math.min(i, last.length - 1)];
          return {
            id: newId(),
            // Prefill with last performance so logging is mostly a single tap.
            weightKg: suggested ?? prev?.weightKg ?? null,
            reps: suggested ? te.repMin : (prev?.reps ?? null),
            done: false,
            type: 'working' as const,
          };
        }),
      };
    }),
  };
}

// ---------- Stats & records ----------

export function workoutVolume(w: Workout): number {
  return w.exercises.reduce(
    (sum, ex) => sum + ex.sets.reduce((s, set) => (set.done && set.type === 'working' ? s + (set.weightKg ?? 0) * (set.reps ?? 0) : s), 0),
    0,
  );
}

export function completedSetCount(w: Workout): number {
  return w.exercises.reduce((n, ex) => n + ex.sets.filter((s) => s.done).length, 0);
}

/** Epley estimate of the one-rep max. */
export function estimateOneRepMax(weightKg: number, reps: number): number {
  if (reps <= 0 || weightKg <= 0) return 0;
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

function bestOf(workout: Workout, exerciseId: string): PersonalRecord | undefined {
  const bodyweight = getExercise(exerciseId)?.bodyweight;
  let best: PersonalRecord | undefined;
  for (const ex of workout.exercises) {
    if (ex.exerciseId !== exerciseId) continue;
    for (const s of ex.sets) {
      if (!s.done || s.type !== 'working' || !s.reps) continue;
      const weighted = !bodyweight && (s.weightKg ?? 0) > 0;
      const candidate: PersonalRecord = weighted
        ? { exerciseId, kind: 'est_1rm', value: estimateOneRepMax(s.weightKg!, s.reps), weightKg: s.weightKg, reps: s.reps }
        : { exerciseId, kind: 'max_reps', value: s.reps, weightKg: s.weightKg, reps: s.reps };
      if (!best || candidate.value > best.value) best = candidate;
    }
  }
  return best;
}

/** Records beaten in `workout` compared with all earlier completed workouts. First-time lifts don't count. */
export function detectRecords(workout: Workout, history: Workout[]): PersonalRecord[] {
  const earlier = history.filter((w) => w.status === 'completed' && w.id !== workout.id && w.startedAt < workout.startedAt);
  const records: PersonalRecord[] = [];
  for (const ex of workout.exercises) {
    const current = bestOf(workout, ex.exerciseId);
    if (!current) continue;
    const previous = earlier
      .map((w) => bestOf(w, ex.exerciseId))
      .filter((r): r is PersonalRecord => !!r && r.kind === current.kind);
    if (previous.length === 0) continue;
    const prevBest = Math.max(...previous.map((r) => r.value));
    if (current.value > prevBest + 0.01) records.push(current);
  }
  return records;
}

export function formatSet(s: Pick<WorkoutSet, 'weightKg' | 'reps'>): string {
  const reps = s.reps ?? 0;
  if (!s.weightKg) return `${reps} Wdh.`;
  return `${String(s.weightKg).replace('.', ',')} kg × ${reps}`;
}
