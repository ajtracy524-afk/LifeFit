import { findTemplate, getExercise, getProgram } from '../../data/exercises';
import { getFood } from '../../data/foods';
import { fmt } from '../../lib/format';
import { sessionLoad } from '../adaptive/load';
import { lastLoad } from '../adaptive/sessionAdapt';
import { addDays, daysBetween } from '../dates';
import { foodAllowed, foodMacros } from '../nutrition';
import { appStartDate } from '../progress';
import { minutesOf, trainingTimeFor } from '../schedule';
import { activeWorkouts, estimateMinutes, formatKg, isWorkSet } from '../training';
import { exerciseHistory, workoutStats } from '../trainingHistory';
import { trainingDayBonus } from '../week';
import type { Experience, Workout } from '../types';
import type { EngineContext } from './context';
import type { EngineAction, Recommendation } from './types';

/**
 * Adaptive rules that connect training, nutrition and the program. Like every
 * rule: deterministic, only from stored data, facts attached, actions only on
 * a tap.
 */

export const ADAPTIVE_RULES = {
  /** Pre-workout window: 30–150 min before the usual training time. */
  preMin: 30,
  preMax: 150,
  /** Carbs eaten so far below this share of the day's carb target → a small carb snack is offered. */
  lowCarbShare: 0.35,
  /** The snack covers this share of the day's carb target (bounded by what is still open). */
  snackCarbShare: 0.12,
  /** A meal within this many minutes before now counts as "just eaten" … */
  recentMealMin: 60,
  /** … and as large with this much fat or this share of the day's energy. */
  largeMealFatG: 30,
  largeMealShare: 0.35,
  /** Level: last 4 full weeks, at least this adherence and this many sessions. */
  levelWeeks: 4,
  levelAdherence: 0.85,
  levelMinSessions: 6,
  /** Real progress: ≥ 2 exercises with +5 % estimated 1RM (or +2 reps) over the last 8 weeks. */
  levelProgress: 0.05,
  levelProgressExercises: 2,
  levelMinTrainingWeeks: 6,
  splitMinTrainingWeeks: 8,
  /** Cardio: none in the last 7 days → one easy session is offered on a free day. */
  cardioLookbackDays: 7,
} as const;

const CARB_SNACKS = ['banana', 'rice-cakes', 'bread', 'oats'];

const localMinutes = (iso: string) => {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
};

// ---------- Nutrition → training ----------

/**
 * Training soon: little carbohydrate so far → a small carb snack (sized from
 * the personal carb target, never beyond what is still open). A large or
 * fat-rich meal just now → a neutral hint. No digestion or medical claims.
 */
export function preWorkoutRule(ctx: EngineContext): Recommendation[] {
  const R = ADAPTIVE_RULES;
  const session = ctx.todaysSession;
  const t = ctx.target;
  if (!session || !t) return [];
  const training = minutesOf(trainingTimeFor(ctx.state).time);
  const now = ctx.hour * 60 + ctx.minute;
  const until = training - now;
  if (until < 0 || until > R.preMax) return [];
  const load = sessionLoad(session.template);
  const bonus = trainingDayBonus(ctx.state, ctx.date);
  const out: Recommendation[] = [];

  const recent = ctx.state.logEntries.filter((e) => e.date === ctx.date && now - localMinutes(e.loggedAt) >= 0 && now - localMinutes(e.loggedAt) <= R.recentMealMin);
  const big = recent.find((e) => e.macros.fat >= R.largeMealFatG || e.macros.kcal >= t.kcal * R.largeMealShare);
  if (big) {
    out.push({
      id: `heavy_meal:${ctx.date}`,
      kind: 'heavy_meal',
      domain: 'nutrition',
      priority: 'low',
      confidence: 'medium',
      title: `Training in ${until} min – gerade eine größere Mahlzeit gegessen`,
      message: 'Manche trainieren nach einer großen Mahlzeit lieber etwas später oder starten lockerer. Entscheide nach deinem Gefühl.',
      reasons: [`${big.name}: ${fmt.kcal(big.macros.kcal)}, ${fmt.g(big.macros.fat)} Fett`],
      facts: { minutesUntil: until, kcal: Math.round(big.macros.kcal), fat: Math.round(big.macros.fat) },
      actions: [{ type: 'open', label: 'Trainingsplan', route: 'training' }],
    });
  }

  const openCarbs = t.carbs - ctx.eaten.carbs - ctx.plannedOpenMacros.carbs;
  const plannedBefore = ctx.plannedOpen.some((m) => {
    const at = minutesOf(ctx.state.plannerSettings.mealTimes[m.slot]);
    return at >= now - 15 && at <= training - 20;
  });
  if (!big && until >= R.preMin && ctx.eaten.carbs < t.carbs * R.lowCarbShare && !plannedBefore && openCarbs > 15) {
    const want = Math.min(openCarbs, Math.max(15, t.carbs * R.snackCarbShare));
    const actions: EngineAction[] = CARB_SNACKS.map((id) => getFood(id))
      .filter((f): f is NonNullable<typeof f> => !!f && foodAllowed(f, ctx.state.nutritionProfile))
      .map((food) => {
        let grams = (want / food.per100.carbs) * 100;
        grams = food.pieceG ? Math.max(1, Math.round(grams / food.pieceG)) * food.pieceG : Math.max(20, Math.round(grams / 10) * 10);
        return { food, grams, macros: foodMacros(food, grams), home: ctx.pantry.has(food.id) };
      })
      .sort((a, b) => Number(b.home) - Number(a.home))
      .slice(0, 2)
      .map(({ food, grams, macros }) => ({ type: 'log_food', label: `${food.name} ${fmt.g(grams)} erfassen · ${fmt.int(macros.carbs)} g KH`, date: ctx.date, slot: 'snack', foodId: food.id, grams }));
    if (actions.length) {
      out.push({
        id: `pre_workout:${ctx.date}`,
        kind: 'pre_workout',
        domain: 'nutrition',
        priority: until <= 90 ? 'high' : 'medium',
        confidence: 'medium',
        title: `Training in ${until} min – ein kleiner Snack mit Kohlenhydraten?`,
        message: `Bisher ${fmt.int(ctx.eaten.carbs)} von ${fmt.int(t.carbs)} g Kohlenhydraten heute.${bonus?.label === 'Beintag' ? ` Heute ist Beintag – dein Tagesziel enthält +${bonus.kcal} kcal, vor allem Kohlenhydrate.` : ''} Etwas Leichtes davor ist für viele angenehm – musst du aber nicht.`,
        reasons: [`${session.template.name} um ${trainingTimeFor(ctx.state).time} · ~${estimateMinutes(session.template)} min`, ...(load.label ? [load.label] : [])],
        facts: { minutesUntil: until, eatenCarbs: Math.round(ctx.eaten.carbs), targetCarbs: Math.round(t.carbs), snackCarbs: Math.round(want), load: load.score },
        actions,
      });
    }
  }
  return out;
}

/** The workout finished today in the last 3 hours (for "Nach dem Training"). */
export function recentWorkout(ctx: EngineContext): Workout | undefined {
  const now = ctx.hour * 60 + ctx.minute;
  return ctx.state.workouts
    .filter((w) => w.status === 'completed' && w.date === ctx.date && w.endedAt)
    .find((w) => {
      const since = now - localMinutes(w.endedAt!);
      return since >= 0 && since <= 180;
    });
}

// ---------- Cardio ----------

function cardioMinutes(workouts: Workout[], from: string, to: string): number {
  return workouts
    .filter((w) => w.status === 'completed' && w.date >= from && w.date <= to)
    .reduce((m, w) => m + w.exercises.filter((e) => getExercise(e.exerciseId)?.type === 'cardio').reduce((n, e) => n + e.sets.filter(isWorkSet).reduce((k, s) => k + (s.durationMin ?? 0), 0), 0), 0);
}

/**
 * Cardio by goal and history: a free day without cardio in the last 7 days
 * (fat loss / fit bleiben) → an easy Zone-2 session; the day after a very hard
 * session → mobility / recovery; a planned HIIT after a very hard session → Zone 2.
 */
export function cardioRule(ctx: EngineContext): Recommendation[] {
  const R = ADAPTIVE_RULES;
  if (!ctx.state.training || ctx.trainedToday) return [];
  const goal = ctx.state.goal?.type;
  const yesterday = ctx.state.workouts.filter((w) => w.status === 'completed' && w.date === addDays(ctx.date, -1)).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const hardYesterday = yesterday ? lastLoad({ id: yesterday.templateId, name: '', focus: '', exercises: [] }, [yesterday]) : { hard: false };
  const zone2 = findTemplate('cardio-zone2')!;
  const mobility = findTemplate('mobility-recovery')!;
  const session = ctx.todaysSession;

  if (session?.template.exercises.some((e) => e.exerciseId === 'hiit-bike') && hardYesterday.hard) {
    return [
      {
        id: `training_cardio:${ctx.date}:hiit`,
        kind: 'training_cardio',
        domain: 'training',
        priority: 'medium',
        confidence: 'medium',
        title: 'Heute Zone 2 statt HIIT?',
        message: `${hardYesterday.text}. Eine lockere Einheit belastet weniger – HIIT kannst du später in der Woche nachholen.`,
        reasons: [`Gestern: ${yesterday!.name}`],
        facts: { hardYesterday: true },
        actions: [{ type: 'start_workout', label: `${zone2.name} starten · ~${estimateMinutes(zone2)} min`, template: zone2 }],
      },
    ];
  }
  if (session) return [];
  if (hardYesterday.hard) {
    return [
      {
        id: `training_cardio:${ctx.date}:recovery`,
        kind: 'training_cardio',
        domain: 'training',
        priority: 'low',
        confidence: 'medium',
        title: 'Trainingsfrei – Lust auf lockere Mobility?',
        message: `${hardYesterday.text}. ${mobility.focus} – ruhig und ohne Zusatzbelastung. Ein freier Tag ist genauso in Ordnung.`,
        reasons: [`Gestern: ${yesterday!.name}`],
        facts: { hardYesterday: true },
        actions: [{ type: 'start_workout', label: `${mobility.name} starten · ~${estimateMinutes(mobility)} min`, template: mobility }],
      },
    ];
  }
  const minutes = cardioMinutes(ctx.state.workouts, addDays(ctx.date, -R.cardioLookbackDays), ctx.date);
  if ((goal === 'fat_loss' || goal === 'maintain') && minutes === 0 && appStartDate(ctx.state) <= addDays(ctx.date, -R.cardioLookbackDays)) {
    return [
      {
        id: `training_cardio:${ctx.date}`,
        kind: 'training_cardio',
        domain: 'training',
        priority: 'low',
        confidence: 'medium',
        title: `Trainingsfrei – ${zone2.exercises[0]?.durationMin ?? 30} min lockeres Cardio?`,
        message:
          goal === 'fat_loss'
            ? 'Zusätzliche lockere Bewegung erhöht deinen Energieverbrauch. Fett verlierst du über das Kaloriendefizit – Cardio hilft dabei, ersetzt es aber nicht.'
            : 'Lockere Ausdauer ergänzt dein Krafttraining für die allgemeine Fitness.',
        reasons: [`Letzte ${R.cardioLookbackDays} Tage: kein Cardio`],
        facts: { cardioMinutes: 0 },
        actions: [{ type: 'start_workout', label: `${zone2.name} starten · ~${estimateMinutes(zone2)} min`, template: zone2 }],
      },
    ];
  }
  return [];
}

// ---------- Level ----------

export interface LevelAssessment {
  adherence: { done: number; scheduled: number };
  progressing: Array<{ exerciseId: string; text: string }>;
  trainingWeeks: number;
  options: Array<{ label: string; programId: string; weekdays: number[]; experience?: Experience }>;
}

/**
 * Ready for the next step? Not by time alone: the last 4 weeks must be done
 * reliably (≥ 85 %) AND at least two exercises must have really improved over
 * the last 8 weeks. Then: 2× → 3× full body; later full body → a split.
 */
export function assessLevel(ctx: EngineContext): LevelAssessment | undefined {
  const R = ADAPTIVE_RULES;
  const setup = ctx.state.training;
  if (!setup) return undefined;
  const start = appStartDate(ctx.state);
  let scheduled = 0;
  let done = 0;
  for (let k = 1; k <= R.levelWeeks; k++) {
    const ws = addDays(ctx.weekStart, -7 * k);
    scheduled += activeWorkouts(setup, ctx.state.workoutOverrides, ctx.state.workouts, ws, ctx.state.dayContexts).filter((x) => x.date >= start).length;
    done += ctx.state.workouts.filter((w) => w.status === 'completed' && w.date >= ws && w.date <= addDays(ws, 6)).length;
  }
  if (scheduled < R.levelMinSessions || done / scheduled < R.levelAdherence) return undefined;

  const completed = ctx.state.workouts.filter((w) => w.status === 'completed' && w.date < ctx.date);
  const first = completed.map((w) => w.date).sort()[0];
  const trainingWeeks = first ? Math.floor(daysBetween(first, ctx.date) / 7) : 0;
  if (trainingWeeks < R.levelMinTrainingWeeks) return undefined;

  const recent = completed.filter((w) => w.date >= addDays(ctx.date, -56));
  const ids = [...new Set(recent.flatMap((w) => w.exercises.map((e) => e.exerciseId)))].filter((id) => getExercise(id)?.type === 'strength');
  const progressing: LevelAssessment['progressing'] = [];
  for (const id of ids) {
    const h = exerciseHistory(recent, id);
    if (h.length < 4) continue;
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const weighted = h.every((s) => s.e1rm > 0);
    const early = avg(h.slice(0, 2).map((s) => (weighted ? s.e1rm : s.best.reps)));
    const late = avg(h.slice(-2).map((s) => (weighted ? s.e1rm : s.best.reps)));
    const ok = weighted ? late >= early * (1 + R.levelProgress) : late >= early + 2;
    if (ok) progressing.push({ exerciseId: id, text: weighted ? `${getExercise(id)!.name}: +${Math.round((late / early - 1) * 100)} % (1RM geschätzt)` : `${getExercise(id)!.name}: +${formatKg(late - early)} Wdh.` });
  }
  if (progressing.length < R.levelProgressExercises) return undefined;

  const program = getProgram(setup.programId);
  const days = setup.weekdays.length;
  const experience = ctx.state.profile?.experience ?? 'beginner';
  const fullBody = ['full-body', 'strength-cardio', 'home-full-body', 'bodyweight-basics'].includes(setup.programId);
  const options: LevelAssessment['options'] = [];
  if (fullBody && days <= 2) options.push({ label: `3× ${program?.name ?? 'Ganzkörper'} pro Woche`, programId: setup.programId, weekdays: [0, 2, 4] });
  else if (fullBody && days >= 3 && experience === 'beginner' && trainingWeeks >= R.splitMinTrainingWeeks && (setup.equipment ?? 'gym') === 'gym') {
    options.push({ label: 'Oberkörper / Unterkörper · 4 Tage', programId: 'upper-lower', weekdays: [0, 1, 3, 4], experience: 'intermediate' });
    options.push({ label: 'Push / Pull / Beine · 3 Tage', programId: 'push-pull-legs', weekdays: [...setup.weekdays], experience: 'intermediate' });
  }
  if (!options.length) return undefined;
  return { adherence: { done, scheduled }, progressing, trainingWeeks, options };
}

export function levelRule(ctx: EngineContext): Recommendation[] {
  const a = assessLevel(ctx);
  if (!a) return [];
  const toSplit = a.options.some((o) => o.experience === 'intermediate');
  return [
    {
      id: `training_level:${ctx.weekStart}`,
      kind: 'training_level',
      domain: 'training',
      priority: 'low',
      confidence: 'high',
      title: toSplit ? 'Bereit für den nächsten Schritt: ein Split' : 'Bereit für eine Einheit mehr pro Woche',
      message: `Du hast ${a.adherence.done} von ${a.adherence.scheduled} geplanten Einheiten der letzten ${ADAPTIVE_RULES.levelWeeks} Wochen gemacht und wirst stärker. ${toSplit ? 'Mit einem Split trainierst du mehr Volumen pro Muskel bei guter Erholung.' : 'Mit einem dritten Tag trainierst du jeden Muskel öfter.'} Du entscheidest.`,
      reasons: [`${a.adherence.done} / ${a.adherence.scheduled} Einheiten in ${ADAPTIVE_RULES.levelWeeks} Wochen`, ...a.progressing.slice(0, 3).map((p) => p.text), `${a.trainingWeeks} Wochen Training`],
      facts: { done: a.adherence.done, scheduled: a.adherence.scheduled, progressing: a.progressing.length, trainingWeeks: a.trainingWeeks },
      actions: a.options.map((o) => ({ type: 'set_program', label: o.label, programId: o.programId, weekdays: o.weekdays, ...(o.experience ? { experience: o.experience } : {}) })),
    },
  ];
}

/** "Push – 12 Sätze · 3'450 kg" – a finished workout in one line (post-workout reasons). */
export function workoutLine(w: Workout): string {
  const s = workoutStats(w);
  return [w.name, `${s.sets} Sätze`, s.volumeKg ? `${fmt.int(s.volumeKg)} kg` : s.cardioMin ? `${s.cardioMin} min` : undefined].filter(Boolean).join(' · ');
}
