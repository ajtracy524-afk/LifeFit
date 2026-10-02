import { getExercise } from '../../data/exercises';
import { daysBetween } from '../dates';
import { effortText } from '../effort';
import { startWeight } from '../onboarding/training';
import { formatKg, isTimed, isWorkSet, weightStep } from '../training';
import type { Prescription, TemplateExercise, Workout, WorkoutSet } from '../types';

/**
 * Progressive overload – the next session of an exercise, derived only from
 * what really happened last time (sets, reps, weight, RPE, effort feedback,
 * the user's decisions). Deterministic and explainable: every result carries
 * one sentence why. Nothing is applied by itself – the sets are prefilled and
 * the user accepts, changes or declines (see the session screen).
 *
 * Rules, first match wins (strength):
 *   no history                       → first time, the user picks the weight
 *   last session ≥ 28 days ago       → −10 %, ease back in
 *   ≥ 2 sets below the range / "zu hart" → −5 % (at least one weight step)
 *   RPE ≥ 9.5                        → hold weight and reps
 *   all planned sets at the top      → + one weight step, reps back to the bottom
 *     (RPE ≥ 9 → hold once more; two declined increases in a row → reps first)
 *   all planned sets inside the range → same weight, +1 rep (+2 with RPE ≤ 7), never above the top
 *   otherwise (8 / 8 / 7, sets missing) → hold weight, aim for the best set of last time on every set
 * Cardio / mobility: minutes – +5 after two sessions that reached the plan without "hart".
 */

export const PROGRESSION = {
  breakDays: 28,
  breakFactor: 0.9,
  reduceFactor: 0.95,
  holdRpe: 9.5,
  cautiousRpe: 9,
  easyRpe: 7,
  declinedInARow: 2,
  cardioStepMin: 5,
  cardioMaxFactor: 1.5,
} as const;

export interface ExerciseSession {
  workout: Workout;
  date: string;
  sets: WorkoutSet[];
  plannedSets?: number;
  rpe?: number;
  prescription?: Prescription;
}

/** Completed sessions of an exercise (newest first) that have at least one work set. */
export function exerciseSessions(history: Workout[], exerciseId: string): ExerciseSession[] {
  return history
    .filter((w) => w.status === 'completed')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .flatMap((w) => {
      const entries = w.exercises.filter((e) => e.exerciseId === exerciseId);
      const sets = entries.flatMap((e) => e.sets.filter(isWorkSet));
      if (!sets.length) return [];
      const rpes = sets.map((s) => s.rpe).filter((r): r is number => typeof r === 'number');
      const planned = entries.find((e) => e.planned && e.planned.exerciseId === exerciseId)?.planned?.sets ?? entries.find((e) => e.planned)?.planned?.sets;
      return [
        {
          workout: w,
          date: w.date,
          sets,
          ...(planned ? { plannedSets: planned } : {}),
          ...(rpes.length ? { rpe: Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10 } : {}),
          ...(entries.find((e) => e.prescription)?.prescription ? { prescription: entries.find((e) => e.prescription)!.prescription } : {}),
        },
      ];
    });
}

const roundTo = (kg: number, step: number) => Math.round(kg / step) * step;
const repsText = (sets: WorkoutSet[]) => sets.map((s) => s.reps ?? 0).join(' / ');
/** Shown as RIR (stored as RPE – see domain/effort.ts). */
const rpeText = (rpe: number) => effortText(rpe);

export interface PrescriptionResult extends Prescription {
  /** Target per set (same weight, reps may differ). */
  sets: Array<{ weightKg: number | null; reps: number | null }>;
}

/** The suggestion for one exercise of the next session. `today` is the date of the new session. */
/**
 * `startWeights` (Prompt 7): current working weights (kg × reps) from the onboarding – used
 * only while an exercise has no history. Without them the first session is an entry set.
 */
export function prescribe(te: TemplateExercise, history: Workout[], today: string, startWeights?: Record<string, { kg: number; reps: number }>): PrescriptionResult {
  const R = PROGRESSION;
  const sessions = exerciseSessions(history, te.exerciseId);
  const last = sessions[0];
  const ex = getExercise(te.exerciseId);
  const n = te.sets;
  const uniform = (weightKg: number | null, reps: number | null) => Array.from({ length: n }, () => ({ weightKg, reps }));

  if (isTimed(te.exerciseId)) return prescribeTimed(te, sessions);
  if (!last) {
    const given = startWeights?.[te.exerciseId];
    const kg = given && !ex?.bodyweight ? startWeight(given, te.repMax, weightStep(te.exerciseId)) : undefined;
    if (kg !== undefined) {
      return {
        change: 'first',
        reason: `Startgewicht aus deinem Arbeitsgewicht (${formatKg(given!.kg)} kg × ${given!.reps}) – mit 2 Wiederholungen Reserve.`,
        weightKg: kg,
        reps: te.repMin,
        sets: uniform(kg, te.repMin),
      };
    }
    // Entry set: the first session tells the progression the start weight.
    return {
      change: 'first',
      reason: `Einstiegs-Satz: Wähle ein Gewicht, mit dem du ${te.repMax} saubere Wiederholungen schaffst und noch 2–3 im Tank hast – daraus leiten wir dein Startgewicht ab.`,
      weightKg: null,
      reps: null,
      sets: uniform(null, null),
    };
  }

  const bodyweight = !!ex?.bodyweight;
  const weight = Math.max(...last.sets.map((s) => s.weightKg ?? 0));
  const kg = weight > 0 ? weight : null;
  const reps = last.sets.map((s) => s.reps ?? 0);
  const plannedSets = last.plannedSets ?? n;
  const doneAll = reps.length >= Math.min(plannedSets, n);
  const considered = reps.slice(0, n);
  const effort = last.workout.feedback?.effort;
  const step = weightStep(te.exerciseId);
  const gap = daysBetween(last.date, today);
  const lastText = `${last.sets.length} × ${kg ? `${formatKg(kg)} kg` : 'Körpergewicht'} (${repsText(last.sets)})`;

  // 1. Long break: ease back in.
  if (gap >= R.breakDays && kg && !bodyweight) {
    const w = Math.max(step, roundTo(kg * R.breakFactor, step));
    return {
      change: 'reduce',
      reason: `Letztes Training vor ${Math.floor(gap / 7)} Wochen – leichter wieder einsteigen.`,
      weightKg: w,
      reps: te.repMin,
      delta: { kg: w - kg },
      sets: uniform(w, te.repMin),
    };
  }

  // 2. Clearly too heavy last time.
  const belowMin = considered.filter((r) => r < te.repMin).length;
  if ((belowMin >= 2 || effort === 'too_hard') && kg && !bodyweight) {
    const w = Math.max(step, Math.min(kg - step, roundTo(kg * R.reduceFactor, step)));
    return {
      change: 'reduce',
      reason: effort === 'too_hard' ? `Letztes Training war „zu hart“ (${lastText}) – etwas leichter.` : `Letztes Mal ${repsText(last.sets)} – unter ${te.repMin} Wdh. Mit etwas weniger Gewicht schaffst du den Bereich.`,
      weightKg: w,
      reps: te.repMin,
      delta: { kg: w - kg },
      sets: uniform(w, te.repMin),
    };
  }

  // 3. Very high exertion: hold.
  if (last.rpe !== undefined && last.rpe >= R.holdRpe) {
    const best = Math.max(...considered);
    return { change: 'hold', reason: `Sehr hohe Belastung letztes Mal (${rpeText(last.rpe)}) – Gewicht und Wiederholungen halten.`, weightKg: kg, reps: best, sets: uniform(kg, best) };
  }

  const allTop = doneAll && considered.length >= Math.min(plannedSets, n) && considered.every((r) => r >= te.repMax);
  const inRange = doneAll && considered.every((r) => r >= te.repMin);
  const cautious = (last.rpe !== undefined && last.rpe >= R.cautiousRpe) || effort === 'hard';

  // 4. Top of the range everywhere: more weight (with a brake for high RPE and declined increases).
  if (allTop && !bodyweight && kg) {
    if (cautious) {
      return {
        change: 'hold',
        reason: `Oberes Ende erreicht, aber ${last.rpe !== undefined ? rpeText(last.rpe) : '„hart“'} – noch einmal ${formatKg(kg)} kg, dann steigern.`,
        weightKg: kg,
        reps: te.repMax,
        sets: uniform(kg, te.repMax),
      };
    }
    const declined = sessions.slice(0, R.declinedInARow);
    if (declined.length === R.declinedInARow && declined.every((s) => s.prescription?.change === 'increase' && s.prescription.decision === 'declined')) {
      return {
        change: 'hold',
        reason: `Du hast die letzten ${R.declinedInARow} Steigerungen nicht übernommen – heute ${formatKg(kg)} kg sauber wiederholen.`,
        weightKg: kg,
        reps: te.repMax,
        sets: uniform(kg, te.repMax),
      };
    }
    const w = kg + step;
    return {
      change: 'increase',
      reason: `Letztes Training ${lastText} geschafft – oberes Ende erreicht.`,
      weightKg: w,
      reps: te.repMin,
      delta: { kg: step },
      sets: uniform(w, te.repMin),
    };
  }

  // 5. Inside the range: one rep more (two when it felt easy), never above the top.
  if (inRange && !cautious) {
    const plus = last.rpe !== undefined && last.rpe <= R.easyRpe ? 2 : 1;
    const targets = Array.from({ length: n }, (_, i) => Math.min(te.repMax, (reps[Math.min(i, reps.length - 1)] ?? te.repMin) + plus));
    const all = targets.every((t, i) => t === (reps[Math.min(i, reps.length - 1)] ?? 0));
    if (all) return { change: 'same', reason: `Wie letztes Mal: ${lastText}.`, weightKg: kg, reps: targets[0]!, sets: targets.map((r) => ({ weightKg: kg, reps: r })) };
    return {
      change: 'reps',
      reason: `Letztes Mal ${repsText(last.sets)}${plus === 2 ? ` bei ${rpeText(last.rpe!)}` : ''} – heute ${plus === 2 ? 'bis zu zwei' : 'eine'} Wiederholung${plus === 2 ? 'en' : ''} mehr pro Satz.`,
      weightKg: kg,
      reps: targets[0]!,
      delta: { reps: plus },
      sets: targets.map((r) => ({ weightKg: kg, reps: r })),
    };
  }

  // 6. Not every set reached the goal (8 / 8 / 7, a set missing, or "hart"): hold, aim for the best set on every set.
  const best = Math.min(te.repMax, Math.max(...considered));
  return {
    change: 'hold',
    reason: cautious && inRange ? `Letztes Training war anstrengend (${last.rpe !== undefined ? rpeText(last.rpe) : '„hart“'}) – gleiche Werte noch einmal.` : `Letztes Mal ${repsText(last.sets)} – Gewicht halten, Ziel: alle Sätze mit ${best} Wdh.`,
    weightKg: kg,
    reps: best,
    sets: uniform(kg, best),
  };
}

function prescribeTimed(te: TemplateExercise, sessions: ExerciseSession[]): PrescriptionResult {
  const R = PROGRESSION;
  const planned = te.durationMin ?? null;
  const minutesOf = (s: ExerciseSession) => s.sets.reduce((m, x) => m + (x.durationMin ?? 0), 0);
  const base = { weightKg: null, reps: null, sets: [] };
  const last = sessions[0];
  if (!last || !minutesOf(last)) return { ...base, change: planned ? 'same' : 'first', reason: planned ? `Geplant: ${planned} min.` : 'Trag die Minuten ein, die du machst.', durationMin: planned };
  const lastMin = Math.round(minutesOf(last) / Math.max(1, last.sets.length));
  const two = sessions.slice(0, 2);
  const goal = planned ?? lastMin;
  const reached = two.length === 2 && two.every((s) => minutesOf(s) / Math.max(1, s.sets.length) >= goal && s.workout.feedback?.effort !== 'hard' && s.workout.feedback?.effort !== 'too_hard');
  const cap = planned ? Math.round(planned * R.cardioMaxFactor) : lastMin + R.cardioStepMin;
  if (reached && lastMin + R.cardioStepMin <= cap) {
    return { ...base, change: 'increase', reason: `Zweimal ${lastMin} min geschafft – heute ${R.cardioStepMin} min mehr.`, durationMin: lastMin + R.cardioStepMin, delta: { min: R.cardioStepMin } };
  }
  return { ...base, change: 'same', reason: `Wie letztes Mal: ${lastMin} min.`, durationMin: Math.max(lastMin, planned ?? 0) || lastMin };
}

/** "+2,5 kg" / "−5 kg" / "+1 Wdh." / "+5 min" / "halten" – the short label of a suggestion. */
export function changeLabel(p: Pick<Prescription, 'change' | 'delta'>): string {
  const d = p.delta;
  if (d?.kg) return `${d.kg > 0 ? '+' : '−'}${formatKg(Math.abs(d.kg))} kg`;
  if (d?.reps) return `+${d.reps} Wdh.`;
  if (d?.min) return `+${d.min} min`;
  return p.change === 'hold' ? 'Halten' : p.change === 'first' ? 'Erstes Mal' : 'Wie letztes Mal';
}
