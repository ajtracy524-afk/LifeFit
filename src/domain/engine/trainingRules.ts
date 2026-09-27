import { getExercise, getProgram, PROGRAMS } from '../../data/exercises';
import { fmt, weekdayLong } from '../../lib/format';
import { addDays, weekdayIndex } from '../dates';
import { appStartDate } from '../progress';
import { activeWorkouts, estimateMinutes, estimateOneRepMax, fitTemplateToTime, isWorkSet, scheduleForWeek } from '../training';
import type { Experience, ISODate, MuscleGroup, Workout, WorkoutTemplate } from '../types';
import type { EngineContext } from './context';
import type { EngineAction, Recommendation } from './types';

// ---------- Muscle regions ----------

export type Region = 'legs' | 'chest' | 'back' | 'shoulders' | 'arms' | 'core';
export const MAJOR_REGIONS: Region[] = ['legs', 'chest', 'back', 'shoulders'];

export const REGION_LABEL: Record<Region, string> = {
  legs: 'Beine',
  chest: 'Brust',
  back: 'Rücken',
  shoulders: 'Schultern',
  arms: 'Arme',
  core: 'Bauch',
};

/** Effective sets per region: 1 = primary mover, 0.5 = strong synergist. */
const EXERCISE_REGIONS: Record<string, Partial<Record<Region, number>>> = {
  'bench-press': { chest: 1, shoulders: 0.5, arms: 0.5 },
  'incline-db-press': { chest: 1, shoulders: 0.5, arms: 0.5 },
  'overhead-press': { shoulders: 1, arms: 0.5 },
  'lateral-raise': { shoulders: 1 },
  'triceps-pushdown': { arms: 1 },
  dips: { chest: 1, arms: 0.5 },
  'barbell-row': { back: 1, arms: 0.5 },
  'lat-pulldown': { back: 1, arms: 0.5 },
  'pull-up': { back: 1, arms: 0.5 },
  'cable-row': { back: 1, arms: 0.5 },
  'face-pull': { shoulders: 1, back: 0.5 },
  'biceps-curl': { arms: 1 },
  'hammer-curl': { arms: 1 },
  squat: { legs: 1, core: 0.25 },
  deadlift: { legs: 1, back: 0.5 },
  'romanian-deadlift': { legs: 1, back: 0.25 },
  'leg-press': { legs: 1 },
  'leg-curl': { legs: 1 },
  'leg-extension': { legs: 1 },
  'split-squat': { legs: 1 },
  lunges: { legs: 1 },
  'hip-thrust': { legs: 1 },
  'calf-raise': { legs: 0.5 },
  'hanging-leg-raise': { core: 1 },
};

export const TRAINING_RULES = {
  /** A session "trains" a region from this many effective sets on. */
  hitSets: 4,
  /** A region is the main focus of a session from this many sets on. */
  primarySets: 6,
  /** Hours a primary region should rest before the next hard session. */
  recoveryDays: 1,
  /** Upper weekly set volume per region (general hypertrophy guidance). */
  weeklyCap: { beginner: 14, intermediate: 20 } satisfies Record<Experience, number>,
  /** Legs and arms bundle several muscles – higher cap. */
  regionFactor: { legs: 1.5, arms: 1.2, core: 0.8, chest: 1, back: 1, shoulders: 1 } satisfies Record<Region, number>,
  /** Stall: no e1RM progress over this many sessions … */
  stallSessions: 3,
  /** … compared with the best before them (tolerance). */
  stallTolerance: 0.005,
  /** From Thursday on, missing regions are pointed out. */
  undertrainedFromWeekday: 3,
} as const;

export type RegionSets = Record<Region, number>;

const emptyRegions = (): RegionSets => ({ legs: 0, chest: 0, back: 0, shoulders: 0, arms: 0, core: 0 });

/** Library muscle group → coarse region of the engine (cardio counts for none). */
const GROUP_REGION: Record<MuscleGroup, Region | undefined> = {
  chest: 'chest',
  back: 'back',
  shoulders: 'shoulders',
  biceps: 'arms',
  triceps: 'arms',
  forearms: 'arms',
  quads: 'legs',
  hamstrings: 'legs',
  glutes: 'legs',
  calves: 'legs',
  core: 'core',
  cardio: undefined,
};

/**
 * Effective sets per region of an exercise: the tuned table above for the
 * original exercises, otherwise derived from the library (primary 1,
 * secondary 0.5 – calves count half for "legs"). Cardio and mobility add none.
 */
export function exerciseRegions(exerciseId: string): Partial<Record<Region, number>> {
  const known = EXERCISE_REGIONS[exerciseId];
  if (known) return known;
  const ex = getExercise(exerciseId);
  if (!ex || ex.type !== 'strength') return {};
  const out: Partial<Record<Region, number>> = {};
  const add = (g: MuscleGroup, f: number) => {
    const r = GROUP_REGION[g];
    if (r) out[r] = Math.max(out[r] ?? 0, g === 'calves' ? f / 2 : f);
  };
  for (const g of ex.secondary) add(g, 0.5);
  add(ex.primary, 1);
  return out;
}

function addRegions(target: RegionSets, exerciseId: string, sets: number) {
  for (const [region, factor] of Object.entries(exerciseRegions(exerciseId))) {
    target[region as Region] += sets * (factor ?? 0);
  }
}

export function templateRegions(t: Pick<WorkoutTemplate, 'exercises'>): RegionSets {
  const r = emptyRegions();
  for (const e of t.exercises) addRegions(r, e.exerciseId, e.sets);
  return r;
}

export function workoutRegions(w: Workout): RegionSets {
  const r = emptyRegions();
  for (const e of w.exercises) addRegions(r, e.exerciseId, e.sets.filter(isWorkSet).length);
  return r;
}

const regionsOver = (sets: RegionSets, min: number) => (Object.keys(sets) as Region[]).filter((r) => sets[r] >= min);

export interface RegionLoad {
  sets: number;
  sessions: number;
  dates: ISODate[];
}

/** Completed volume per region in [from, to]. */
export function regionLoad(workouts: Workout[], from: ISODate, to: ISODate): Record<Region, RegionLoad> {
  const load = Object.fromEntries((Object.keys(emptyRegions()) as Region[]).map((r) => [r, { sets: 0, sessions: 0, dates: [] }])) as unknown as Record<
    Region,
    RegionLoad
  >;
  for (const w of workouts) {
    if (w.status !== 'completed' || w.date < from || w.date > to) continue;
    const sets = workoutRegions(w);
    for (const r of Object.keys(sets) as Region[]) {
      load[r].sets += sets[r];
      if (sets[r] >= TRAINING_RULES.hitSets) {
        load[r].sessions += 1;
        load[r].dates.push(w.date);
      }
    }
  }
  return load;
}

export function weeklyCap(region: Region, experience: Experience): number {
  return Math.round(TRAINING_RULES.weeklyCap[experience] * TRAINING_RULES.regionFactor[region]);
}

// ---------- Session length ----------

/** Removes exercises dominated by `region`, keeping the first (main lift) of them. */
export function reduceRegion(template: WorkoutTemplate, region: Region): WorkoutTemplate {
  let keptMain = false;
  const exercises = template.exercises.filter((e) => {
    const share = exerciseRegions(e.exerciseId)[region] ?? 0;
    if (share < 1) return true;
    if (!keptMain) return (keptMain = true);
    return false;
  });
  return { ...template, name: `${template.name} (reduziert)`, exercises };
}

// ---------- Helpers ----------

function recentPrimary(ctx: EngineContext): Set<Region> {
  const since = addDays(ctx.date, -TRAINING_RULES.recoveryDays);
  const recent = ctx.state.workouts.filter((w) => w.status === 'completed' && w.date >= since && w.date < ctx.date);
  return new Set(recent.flatMap((w) => regionsOver(workoutRegions(w), TRAINING_RULES.primarySets)));
}

function programTemplates(ctx: EngineContext): WorkoutTemplate[] {
  return ctx.state.training ? (getProgram(ctx.state.training.programId)?.templates ?? []) : [];
}

/** Next template in rotation after `current` that satisfies `ok`. */
function alternativeTemplate(ctx: EngineContext, current: WorkoutTemplate, ok: (t: WorkoutTemplate) => boolean): WorkoutTemplate | undefined {
  const all = programTemplates(ctx);
  const start = all.findIndex((t) => t.id === current.id);
  for (let k = 1; k < all.length; k++) {
    const t = all[(start + k) % all.length]!;
    if (ok(t)) return t;
  }
  return undefined;
}

const times = (n: number) => (n === 1 ? 'einmal' : n === 2 ? 'zweimal' : n === 3 ? 'dreimal' : `${n}-mal`);

function start(template: WorkoutTemplate, label?: string): EngineAction {
  return { type: 'start_workout', label: label ?? `${template.name} starten · ~${estimateMinutes(template)} min`, template };
}

/** This week's sessions after overrides (moved on their new day, skipped removed). */
function weekSessions(ctx: EngineContext) {
  return activeWorkouts(ctx.state.training, ctx.state.workoutOverrides, ctx.state.workouts, ctx.weekStart, ctx.state.dayContexts);
}

// ---------- Rules ----------

/** Today's focus was already trained hard yesterday → swap for another template of the program. */
export function recoveryRule(ctx: EngineContext): Recommendation[] {
  const session = ctx.todaysSession;
  if (!session) return [];
  const recent = recentPrimary(ctx);
  const conflicts = regionsOver(templateRegions(session.template), TRAINING_RULES.primarySets).filter((r) => recent.has(r));
  if (conflicts.length === 0) return [];

  const alt = alternativeTemplate(ctx, session.template, (t) => !regionsOver(templateRegions(t), TRAINING_RULES.primarySets).some((r) => recent.has(r)));
  const labels = conflicts.map((r) => REGION_LABEL[r]).join(' & ');

  return [
    {
      id: `training_recovery:${ctx.date}`,
      kind: 'training_recovery',
      domain: 'training',
      priority: 'high',
      confidence: 'high',
      title: `${labels} wurde${conflicts.length > 1 ? 'n' : ''} gestern schon trainiert`,
      message: alt
        ? `Heute steht ${session.template.name} an. Tausch gegen ${alt.name} – so bekommen ${labels} Zeit zur Erholung.`
        : `Heute steht erneut ${session.template.name} an. Verschiebe die Einheit auf morgen oder trainiere heute locker.`,
      reasons: [`Mindestens ${TRAINING_RULES.primarySets} Sätze ${labels} in den letzten 24–48 h`],
      facts: { conflicts: conflicts.join(','), planned: session.template.id, alternative: alt?.id ?? '' },
      actions: alt ? [start(alt), { type: 'open', label: 'Trainingsplan', route: 'training' }] : [{ type: 'open', label: 'Trainingsplan', route: 'training' }],
    },
  ];
}

/** "Der Nutzer hat diese Woche bereits zweimal Beine trainiert." → reduce or swap today's session. */
export function frequencyRule(ctx: EngineContext): Recommendation[] {
  const session = ctx.todaysSession;
  const experience = ctx.state.profile?.experience ?? 'beginner';
  if (!session) return [];
  const recent = recentPrimary(ctx);
  const tpl = templateRegions(session.template);
  const load = regionLoad(ctx.state.workouts, ctx.weekStart, addDays(ctx.date, -1));

  const over = (Object.keys(tpl) as Region[]).filter(
    (r) => tpl[r] >= TRAINING_RULES.hitSets && !recent.has(r) && load[r].sessions >= 2 && load[r].sets + tpl[r] > weeklyCap(r, experience),
  );
  const region = over[0];
  if (!region) return [];

  const l = load[region];
  const cap = weeklyCap(region, experience);
  const reduced = reduceRegion(session.template, region);
  const alt = alternativeTemplate(ctx, session.template, (t) => templateRegions(t)[region] < TRAINING_RULES.hitSets);
  const actions: EngineAction[] = [];
  if (alt) actions.push(start(alt));
  if (reduced.exercises.length < session.template.exercises.length) actions.push(start(reduced, `${reduced.name} · ~${estimateMinutes(reduced)} min`));

  return [
    {
      id: `training_frequency:${ctx.date}:${region}`,
      kind: 'training_frequency',
      domain: 'training',
      priority: 'medium',
      confidence: 'high',
      title: `Du hast diese Woche bereits ${times(l.sessions)} ${REGION_LABEL[region]} trainiert`,
      message: `Mit ${session.template.name} kämen ${fmt.int(l.sets + tpl[region])} Sätze ${REGION_LABEL[region]} zusammen – mehr als die rund ${cap} Sätze, die für dich pro Woche sinnvoll sind.`,
      reasons: l.dates.map((d) => `${weekdayLong(weekdayIndex(d))}: ${REGION_LABEL[region]}`),
      facts: { region, sessions: l.sessions, weekSets: Math.round(l.sets), todaySets: Math.round(tpl[region]), cap },
      actions,
    },
  ];
}

/** From Thursday: a major region not trained this week and not covered by the remaining sessions. */
export function undertrainedRule(ctx: EngineContext): Recommendation[] {
  if (!ctx.state.training || ctx.trainedToday) return [];
  if (weekdayIndex(ctx.date) < TRAINING_RULES.undertrainedFromWeekday) return [];
  if (appStartDate(ctx.state) > ctx.weekStart) return [];

  const load = regionLoad(ctx.state.workouts, ctx.weekStart, ctx.date);
  const remaining = weekSessions(ctx).filter((s) => s.date >= ctx.date && !s.completedWorkoutId);
  const covered = new Set(remaining.flatMap((s) => regionsOver(templateRegions(s.template), TRAINING_RULES.hitSets)));
  const missing = MAJOR_REGIONS.filter((r) => load[r].sessions === 0 && !covered.has(r));
  if (missing.length === 0) return [];

  const recent = recentPrimary(ctx);
  const best = programTemplates(ctx)
    .map((t) => ({ t, hits: regionsOver(templateRegions(t), TRAINING_RULES.hitSets).filter((r) => missing.includes(r)).length }))
    .filter((x) => x.hits > 0 && !regionsOver(templateRegions(x.t), TRAINING_RULES.primarySets).some((r) => recent.has(r)))
    .sort((a, b) => b.hits - a.hits)[0];
  const labels = missing.map((r) => REGION_LABEL[r]).join(', ');

  return [
    {
      id: `training_undertrained:${ctx.date}`,
      kind: 'training_undertrained',
      domain: 'training',
      priority: 'low',
      confidence: 'medium',
      title: `${labels} kam${missing.length > 1 ? 'en' : ''} diese Woche noch nicht vor`,
      message: best
        ? `${best.t.name} deckt das ab${ctx.todaysSession ? ` – statt ${ctx.todaysSession.template.name} heute` : ''}.`
        : 'Die restlichen Einheiten dieser Woche decken das nicht ab.',
      reasons: [],
      facts: { missing: missing.join(',') },
      actions: best ? [start(best.t)] : [],
    },
  ];
}

/** Missed a scheduled session this week and today is free → catch up. */
export function missedRule(ctx: EngineContext): Recommendation[] {
  if (!ctx.state.training || ctx.todaysSession || ctx.trainedToday) return [];
  const startDate = appStartDate(ctx.state);
  const sessions = weekSessions(ctx);
  const past = sessions.filter((s) => s.date < ctx.date && s.date >= startDate);
  // Workouts not linked to a session (older data, extra days) still count by template.
  const claimed = new Set(sessions.map((s) => s.completedWorkoutId).filter(Boolean));
  const doneThisWeek = ctx.state.workouts.filter((w) => w.status === 'completed' && w.date >= ctx.weekStart && w.date < ctx.date && !claimed.has(w.id));
  const doneIds = doneThisWeek.map((w) => w.templateId);
  const missed = past.filter((s) => {
    if (s.completedWorkoutId) return false;
    const i = doneIds.indexOf(s.template.id);
    if (i >= 0) {
      doneIds.splice(i, 1);
      return false;
    }
    return true;
  });
  if (missed.length === 0) return [];

  const recent = recentPrimary(ctx);
  const candidate = [...missed].reverse().find((s) => !regionsOver(templateRegions(s.template), TRAINING_RULES.primarySets).some((r) => recent.has(r)));
  if (!candidate) return [];

  return [
    {
      id: `training_missed:${ctx.date}`,
      kind: 'training_missed',
      domain: 'training',
      priority: 'medium',
      confidence: 'high',
      title: `${candidate.template.name} von ${weekdayLong(weekdayIndex(candidate.date))} nachholen?`,
      message: 'Heute ist kein Training geplant – die Einheit passt noch gut in die Woche.',
      reasons: [`${missed.length} von ${past.length} geplanten Einheiten diese Woche offen`],
      facts: { missed: missed.length, scheduled: past.length },
      actions: [start(candidate.template)],
    },
  ];
}

/** Less time than the session needs → shortened version that keeps the main lifts. */
export function timeRule(ctx: EngineContext): Recommendation[] {
  const session = ctx.todaysSession;
  const minutes = ctx.availableMinutes;
  if (!session || !minutes) return [];
  const needed = estimateMinutes(session.template);
  if (minutes >= needed - 2) return [];

  const short = fitTemplateToTime(session.template, minutes);
  const sets = short.exercises.reduce((s, e) => s + e.sets, 0);
  const fullSets = session.template.exercises.reduce((s, e) => s + e.sets, 0);

  return [
    {
      id: `training_time:${ctx.date}:${minutes}`,
      kind: 'training_time',
      domain: 'training',
      priority: 'high',
      confidence: 'high',
      title: `Nur ${minutes} min? Kurzversion von ${session.template.name}`,
      message: `${short.exercises.length} Übungen, ${sets} statt ${fullSets} Sätze, ~${estimateMinutes(short)} min. Die Grundübungen bleiben, Zusatzübungen werden gekürzt.`,
      reasons: [`Geplant: ~${needed} min`],
      facts: { available: minutes, needed, sets, fullSets },
      actions: [start(short, `Kurzversion starten · ~${estimateMinutes(short)} min`)],
    },
  ];
}

/** No estimated-1RM progress over the last sessions of an exercise → deload / variation. */
export function stallRule(ctx: EngineContext): Recommendation[] {
  const R = TRAINING_RULES;
  const completed = ctx.state.workouts.filter((w) => w.status === 'completed' && w.date <= ctx.date).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const candidates = ctx.todaysSession
    ? ctx.todaysSession.template.exercises.map((e) => e.exerciseId)
    : [...new Set(completed.filter((w) => w.date >= addDays(ctx.date, -14)).flatMap((w) => w.exercises.map((e) => e.exerciseId)))];

  const stalled: { id: string; best: number }[] = [];
  for (const exerciseId of candidates) {
    if (getExercise(exerciseId)?.bodyweight) continue;
    const bests = completed
      .map((w) => {
        const sets = w.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets.filter(isWorkSet));
        return Math.max(0, ...sets.map((s) => estimateOneRepMax(s.weightKg ?? 0, s.reps ?? 0)));
      })
      .filter((v) => v > 0);
    if (bests.length < R.stallSessions + 1) continue;
    const before = Math.max(...bests.slice(0, -R.stallSessions));
    const lastBest = Math.max(...bests.slice(-R.stallSessions));
    if (lastBest <= before * (1 + R.stallTolerance)) stalled.push({ id: exerciseId, best: before });
  }
  if (stalled.length === 0) return [];

  const names = stalled.slice(0, 3).map((s) => getExercise(s.id)?.name ?? s.id);
  const cutting = ctx.state.goal?.type === 'fat_loss';
  return [
    {
      id: `training_stall:${ctx.date}`,
      kind: 'training_stall',
      domain: 'training',
      priority: 'low',
      confidence: 'medium',
      title: `Seit ${R.stallSessions} Einheiten kein Fortschritt: ${names.join(', ')}`,
      message: cutting
        ? 'Im Kaloriendefizit ist Kraft halten schon ein gutes Ergebnis. Wenn es sich schwer anfühlt: eine Woche mit ~10 % weniger Gewicht, dann wieder steigern.'
        : 'Vorschlag: eine Woche mit ~10 % weniger Gewicht trainieren und danach wieder steigern – oder den Wiederholungsbereich wechseln. Auch Schlaf und Eiweiß spielen mit.',
      reasons: [],
      facts: { stalled: stalled.length },
      actions: [],
    },
  ];
}

/** Program vs. number of training days: frequency per region and adherence over the last weeks. */
export function programRule(ctx: EngineContext): Recommendation[] {
  const setup = ctx.state.training;
  if (!setup) return [];
  const id = `training_program:${ctx.weekStart}`;

  // Adherence over the last three full weeks.
  const startDate = appStartDate(ctx.state);
  let scheduled = 0;
  let done = 0;
  for (let k = 1; k <= 3; k++) {
    const ws = addDays(ctx.weekStart, -7 * k);
    // Skipped sessions were a decision, not a miss – they don't count.
    const s = activeWorkouts(setup, ctx.state.workoutOverrides, ctx.state.workouts, ws, ctx.state.dayContexts).filter((x) => x.date >= startDate);
    scheduled += s.length;
    done += ctx.state.workouts.filter((w) => w.status === 'completed' && w.date >= ws && w.date <= addDays(ws, 6)).length;
  }
  if (scheduled >= 6 && done / scheduled < 0.5) {
    const perWeek = Math.max(2, Math.round(done / 3));
    return [
      {
        id,
        kind: 'training_program',
        domain: 'training',
        priority: 'low',
        confidence: 'medium',
        title: `Zuletzt ${done} von ${scheduled} Einheiten geschafft`,
        message: `Ein Plan mit ${perWeek} Tagen, den du durchziehst, bringt mehr als ${setup.weekdays.length} Tage auf dem Papier.`,
        reasons: ['Letzte 3 Wochen'],
        facts: { done, scheduled, suggestedDays: perWeek },
        actions: [{ type: 'open', label: 'Trainingstage anpassen', route: 'training' }],
      },
    ];
  }

  // Frequency: how often does each major region get trained per week?
  const frequency = (programId: string) => {
    const s = [...scheduleForWeek({ ...setup, programId }, ctx.weekStart), ...scheduleForWeek({ ...setup, programId }, addDays(ctx.weekStart, 7))];
    return Math.min(...MAJOR_REGIONS.map((r) => s.filter((x) => templateRegions(x.template)[r] >= TRAINING_RULES.hitSets).length / 2));
  };
  const current = frequency(setup.programId);
  if (ctx.state.goal?.type !== 'muscle_gain' || current >= 1.5) return [];
  const best = PROGRAMS.filter((p) => p.id !== setup.programId)
    .map((p) => ({ p, f: frequency(p.id) }))
    .sort((a, b) => b.f - a.f)[0];
  if (!best || best.f < 2) return [];

  return [
    {
      id,
      kind: 'training_program',
      domain: 'training',
      priority: 'low',
      confidence: 'medium',
      title: `${best.p.name} passt besser zu ${setup.weekdays.length} Trainingstagen`,
      message: `Damit wird jede große Muskelgruppe ${fmt.dec(best.f)}× pro Woche trainiert statt ${fmt.dec(current)}× – für Muskelaufbau meist effektiver.`,
      reasons: [],
      facts: { currentFrequency: current, betterFrequency: best.f, programId: best.p.id },
      actions: [{ type: 'open', label: 'Programm ansehen', route: 'training' }],
    },
  ];
}
