import { getExercise, getProgram } from '../data/exercises';
import { newId } from '../lib/id';
import { addDays, daysBetween, weekDays } from './dates';
import { effectiveTimeBudget, TIME_BUDGETS } from './timeBudget';
import { prescribe } from './adaptive/progression';
import type { DayContext, ISODate, PlanSlotId, TemplateExercise, TrainingSetup, Workout, WorkoutExercise, WorkoutOverride, WorkoutSet, WorkoutTemplate } from './types';

export interface ScheduledWorkout {
  date: ISODate;
  template: WorkoutTemplate;
}

const EPOCH_MONDAY = '2024-01-01';

/**
 * Training days of a week with their template. Templates rotate continuously
 * across weeks, so a 3-day full-body plan alternates A/B/A → B/A/B.
 */
/** Training days of one week: the weekly check-in's choice, otherwise the default. */
export function trainingWeekdays(setup: TrainingSetup, weekStartDate: ISODate): number[] {
  return setup.weekOverrides?.[weekStartDate] ?? setup.weekdays;
}

export function scheduleForWeek(setup: TrainingSetup | null, weekStartDate: ISODate): ScheduledWorkout[] {
  if (!setup) return [];
  const program = getProgram(setup.programId);
  if (!program || program.templates.length === 0) return [];
  const days = [...trainingWeekdays(setup, weekStartDate)].sort((a, b) => a - b);
  const weekIndex = Math.floor(daysBetween(EPOCH_MONDAY, weekStartDate) / 7);
  const dates = weekDays(weekStartDate);
  // Start position of the week from the DEFAULT day count: changing the days of a
  // running week (check-in) keeps the templates of sessions that already happened.
  const start = weekIndex * setup.weekdays.length;
  return days.map((weekday, k) => ({
    date: dates[weekday]!,
    template: program.templates[(start + k) % program.templates.length]!,
  }));
}

/** Session length in seconds: rest time plus ~40 s per set; cardio / mobility blocks by their minutes. */
export function estimateSeconds(template: Pick<WorkoutTemplate, 'exercises'>): number {
  return template.exercises.reduce((s, e) => s + e.sets * ((e.durationMin ? e.durationMin * 60 : 40) + e.restSec), 0);
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
  const minutes = context ? TIME_BUDGETS[effectiveTimeBudget(context)].trainingMin : undefined;
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

/**
 * A set that really counts: done, not skipped, not a warm-up. Normal, drop,
 * failure and AMRAP sets all count for volume, records and progression.
 */
export function isWorkSet(s: WorkoutSet): boolean {
  return s.done && !s.skipped && s.type !== 'warmup';
}

/** Cardio and mobility log minutes (and km), not kg × reps. */
export const isTimed = (exerciseId: string): boolean => {
  const type = getExercise(exerciseId)?.type;
  return type === 'cardio' || type === 'mobility';
};

export function lastSetsFor(workouts: Workout[], exerciseId: string, excludeId?: string): WorkoutSet[] | undefined {
  const sorted = workouts
    .filter((w) => w.status === 'completed' && w.id !== excludeId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  for (const w of sorted) {
    const done = w.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets.filter(isWorkSet));
    if (done.length > 0) return done;
  }
  return undefined;
}

export function weightStep(exerciseId: string): number {
  const ex = getExercise(exerciseId);
  if (!ex) return 2.5;
  if (ex.equipment === 'dumbbell') return 2;
  if (ex.equipment === 'kettlebell') return 4;
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
  if (ex?.bodyweight || (ex && ex.type !== 'strength')) return undefined;
  const weight = Math.max(...last.map((s) => s.weightKg ?? 0));
  if (weight <= 0) return undefined;
  const allTop = last.every((s) => (s.reps ?? 0) >= repMax);
  return allTop ? weight + weightStep(exerciseId) : undefined;
}

/**
 * A fresh exercise entry of a session: plan snapshot + sets prefilled with the
 * suggestion of the progression engine (domain/adaptive/progression.ts) – one
 * tap confirms. The suggestion and its reason are stored with the exercise, so
 * the user sees why and can accept, change or decline it.
 */
export function workoutExercise(te: TemplateExercise, history: Workout[], opts: { extra?: boolean; date?: ISODate } = {}): WorkoutExercise {
  const rx = prescribe(te, history, opts.date ?? new Date().toISOString().slice(0, 10));
  const timed = isTimed(te.exerciseId);
  const { sets: targets, ...prescription } = rx;
  return {
    id: newId(),
    exerciseId: te.exerciseId,
    repMin: te.repMin,
    repMax: te.repMax,
    restSec: te.restSec,
    ...(te.supersetGroup ? { supersetGroup: te.supersetGroup } : {}),
    ...(opts.extra
      ? { extra: true as const }
      : {
          planned: {
            exerciseId: te.exerciseId,
            sets: te.sets,
            repMin: te.repMin,
            repMax: te.repMax,
            weightKg: targets[0]?.weightKg ?? null,
            ...(te.durationMin ? { durationMin: te.durationMin } : {}),
          },
        }),
    prescription,
    sets: Array.from({ length: te.sets }, (_, i) =>
      timed
        ? { id: newId(), weightKg: null, reps: null, done: false, type: 'working' as const, durationMin: rx.durationMin ?? te.durationMin ?? null, distanceKm: null }
        : { id: newId(), ...targets[i]!, done: false, type: 'working' as const, target: targets[i]! },
    ),
  };
}

export function createWorkout(template: WorkoutTemplate, history: Workout[], date: ISODate): Workout {
  return {
    id: newId(),
    date,
    templateId: template.id,
    name: template.name,
    startedAt: new Date().toISOString(),
    status: 'in_progress',
    exercises: template.exercises.map((te) => workoutExercise(te, history, { date })),
  };
}

// ---------- Stats & records ----------

/** kg × reps of all work sets (warm-ups and skipped sets never count). */
export function exerciseVolume(ex: Pick<WorkoutExercise, 'sets'>): number {
  return ex.sets.reduce((s, set) => (isWorkSet(set) ? s + (set.weightKg ?? 0) * (set.reps ?? 0) : s), 0);
}

export function workoutVolume(w: Workout): number {
  return w.exercises.reduce((sum, ex) => sum + exerciseVolume(ex), 0);
}

export function completedSetCount(w: Workout): number {
  return w.exercises.reduce((n, ex) => n + ex.sets.filter((s) => s.done && !s.skipped).length, 0);
}

/** Epley estimate of the one-rep max. */
export function estimateOneRepMax(weightKg: number, reps: number): number {
  if (reps <= 0 || weightKg <= 0) return 0;
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

export { detectRecords } from './workoutRecords';

export function formatSet(s: Pick<WorkoutSet, 'weightKg' | 'reps'> & Partial<Pick<WorkoutSet, 'durationMin' | 'distanceKm'>>): string {
  if (s.durationMin) return `${formatKg(s.durationMin)} min${s.distanceKm ? ` · ${formatKg(s.distanceKm)} km` : ''}`;
  const reps = s.reps ?? 0;
  if (!s.weightKg) return `${reps} Wdh.`;
  return `${formatKg(s.weightKg)} kg × ${reps}`;
}

/** "82,5" – German decimal comma, no trailing zeros. */
export const formatKg = (n: number): string => String(Math.round(n * 100) / 100).replace('.', ',');
