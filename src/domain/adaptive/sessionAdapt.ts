import { getExercise, loadsArea } from '../../data/exercises';
import { alternativesFor } from '../exerciseLibrary';
import { effortText } from '../effort';
import { isExcluded } from '../trainingProfile';
import { estimateMinutes, fitTemplateToTime, isWorkSet } from '../training';
import type { AppliedAdaptation, BodyArea, MuscleGroup, SessionCheckIn, TrainingEquipment, TrainingSetup, Workout, WorkoutTemplate } from '../types';

/**
 * Before the session: what the user says today (time, discomfort, energy)
 * plus how the last session of this workout felt → PROPOSED changes, each
 * with its reason. Nothing is changed until the user accepts a proposal.
 *
 *   discomfort  → an alternative from the library that does not load that
 *                 area notably (or "auslassen" when there is none) – no diagnosis
 *   tired / last time very hard → one set less on accessory exercises
 *   less time   → compact version (existing fitTemplateToTime: main lifts stay,
 *                 accessory rest and sets first, then accessories)
 *   more time   → optional extra set on the main lifts
 */

export const AREA_LABEL: Record<BodyArea, string> = {
  shoulder: 'Schulter',
  elbow: 'Ellbogen',
  wrist: 'Handgelenk',
  lower_back: 'Unterer Rücken',
  hip: 'Hüfte',
  knee: 'Knie',
};

/** Shown whenever discomfort was reported. */
export const DISCOMFORT_NOTE =
  'LifeFit stellt keine Diagnose. Eine Alternative ist nicht automatisch unbedenklich – hör auf deinen Körper. Bei starken oder anhaltenden Beschwerden lass dich ärztlich oder physiotherapeutisch beraten.';

export const EXTRA_TIME_MIN = 15;

/** Muscle groups whose exercises work right at the area – no alternative, only "auslassen". */
const AREA_TARGET: Record<BodyArea, MuscleGroup[]> = { shoulder: ['shoulders'], elbow: ['biceps', 'triceps'], wrist: [], lower_back: [], hip: [], knee: [] };
const HARD_RPE = 9;

export interface AdaptationProposal extends AppliedAdaptation {
  id: string;
  /** Exercise it changes (index in the template). */
  index?: number;
  toExerciseId?: string;
  minutes?: number;
  /** "Seitheben entfällt", "Bankdrücken: 2 statt 3 Sätze" */
  details?: string[];
}

/** How hard the last session of this workout was – from feedback or RPE, only if recorded. */
export function lastLoad(template: WorkoutTemplate, history: Workout[]): { hard: boolean; text?: string } {
  const last = history.filter((w) => w.status === 'completed' && w.templateId === template.id.replace(/ \(kurz\)$/, '')).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (!last) return { hard: false };
  const effort = last.feedback?.effort;
  if (effort === 'hard' || effort === 'too_hard') return { hard: true, text: `Letztes Training war „${effort === 'hard' ? 'hart' : 'zu hart'}“` };
  const rpes = last.exercises.flatMap((e) => e.sets.filter(isWorkSet).map((s) => s.rpe)).filter((r): r is number => typeof r === 'number');
  const avg = rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : undefined;
  if (avg !== undefined && avg >= HARD_RPE) return { hard: true, text: `Letztes Training war bei hoher Belastung (${effortText(avg)})` };
  return { hard: false };
}

const nameOf = (id: string) => getExercise(id)?.name ?? 'Übung';
const isStrength = (id: string) => getExercise(id)?.type === 'strength';

export function proposeAdaptations(template: WorkoutTemplate, input: SessionCheckIn, ctx: { history: Workout[]; equipment?: TrainingEquipment; setup?: TrainingSetup | null }): AdaptationProposal[] {
  const out: AdaptationProposal[] = [];
  const areas = input.discomfort ?? [];

  // 0. Exercises marked as "nicht möglich" in the profile: an alternative (or leave out).
  template.exercises.forEach((e, index) => {
    if (!isExcluded(ctx.setup, e.exerciseId)) return;
    const alt = alternativesFor(e.exerciseId, ctx.setup ?? ctx.equipment)[0];
    out.push(
      alt
        ? { id: `swap:${index}`, kind: 'swap', index, toExerciseId: alt.id, title: `${alt.name} statt ${nameOf(e.exerciseId)}`, reason: `Du hast ${nameOf(e.exerciseId)} in deinem Profil als „nicht möglich“ markiert.` }
        : { id: `drop:${index}`, kind: 'drop', index, title: `${nameOf(e.exerciseId)} auslassen`, reason: `Du hast ${nameOf(e.exerciseId)} als „nicht möglich“ markiert – eine passende Alternative gibt es in der Bibliothek nicht.` },
    );
  });

  // 1. Discomfort: alternative or leave out – per exercise, the user decides.
  template.exercises.forEach((e, index) => {
    if (out.some((p) => p.index === index)) return;
    const hit = areas.filter((a) => loadsArea(e.exerciseId, a));
    if (!hit.length) return;
    const where = hit.map((a) => AREA_LABEL[a]).join(' & ');
    // Same main muscle, no notable load on the area – and no alternative when the exercise targets that area itself (shoulder press with shoulder discomfort).
    const primary = getExercise(e.exerciseId)?.primary;
    const targetsArea = hit.some((area) => primary !== undefined && AREA_TARGET[area].includes(primary));
    const alt = targetsArea ? undefined : alternativesFor(e.exerciseId, ctx.setup ?? ctx.equipment).find((a) => a.primary === primary && !areas.some((area) => loadsArea(a.id, area)));
    out.push(
      alt
        ? {
            id: `swap:${index}`,
            kind: 'swap',
            index,
            toExerciseId: alt.id,
            title: `${alt.name} statt ${nameOf(e.exerciseId)}`,
            reason: `Du hast Beschwerden (${where}) angegeben. ${nameOf(e.exerciseId)} belastet diesen Bereich deutlich; ${alt.name} trainiert ähnliche Muskeln mit anderer Belastung.`,
          }
        : {
            id: `drop:${index}`,
            kind: 'drop',
            index,
            title: `${nameOf(e.exerciseId)} heute auslassen`,
            reason: targetsArea ? `Du hast Beschwerden (${where}) angegeben. ${nameOf(e.exerciseId)} trainiert genau diesen Bereich – heute besser auslassen.` : `Du hast Beschwerden (${where}) angegeben. In der Bibliothek gibt es keine Alternative für ${nameOf(e.exerciseId)}, die diesen Bereich weniger belastet.`,
          },
    );
  });

  // 2. Volume: tired today or last time very hard → one set less on accessories.
  const load = lastLoad(template, ctx.history);
  const accessories = template.exercises.map((e, i) => ({ e, i })).filter(({ e, i }) => i >= 2 && e.sets > 2 && isStrength(e.exerciseId));
  const short = input.minutes !== undefined && input.minutes < estimateMinutes(template) - 2;
  if ((input.energy === 'low' || load.hard) && accessories.length) {
    const why = [input.energy === 'low' ? 'Du fühlst dich heute müde' : undefined, load.hard ? load.text : undefined, short ? `du hast heute nur ${input.minutes} min` : undefined].filter(Boolean);
    out.push({
      id: 'fewer_sets',
      kind: 'fewer_sets',
      title: `Zusatzübungen je 1 Satz weniger`,
      reason: `${capitalize(why.join(' und '))}. Die Grundübungen bleiben wie geplant.`,
      details: accessories.map(({ e }) => `${nameOf(e.exerciseId)}: ${e.sets - 1} statt ${e.sets} Sätze`),
    });
  }

  // 3. Time.
  const planned = estimateMinutes(template);
  if (input.minutes !== undefined && short) {
    const compact = fitTemplateToTime(template, input.minutes);
    out.push({
      id: 'shorten',
      kind: 'shorten',
      minutes: input.minutes,
      title: `Kompakte Variante · ~${estimateMinutes(compact)} min`,
      reason: `Du hast heute ${input.minutes} min, geplant sind ~${planned} min${load.hard ? `. ${load.text}` : ''}. Die ersten Grundübungen bleiben, Zusatzübungen werden gekürzt.`,
      details: diff(template, compact),
    });
  }
  if (input.minutes !== undefined && input.minutes >= planned + EXTRA_TIME_MIN && !load.hard && input.energy !== 'low') {
    const main = template.exercises.map((e, i) => ({ e, i })).filter(({ e, i }) => i < 2 && isStrength(e.exerciseId));
    if (main.length) {
      out.push({
        id: 'extra_set',
        kind: 'extra_set',
        title: `Optional: +1 Satz bei ${main.map(({ e }) => nameOf(e.exerciseId)).join(' und ')}`,
        reason: `Du hast heute ${input.minutes} min, geplant sind ~${planned} min – Zeit für einen Zusatzsatz bei den Grundübungen.`,
      });
    }
  }
  return out;
}

/** The template with the accepted proposals applied (order: exercises, volume, time last). */
export function applyAdaptations(template: WorkoutTemplate, accepted: AdaptationProposal[]): WorkoutTemplate {
  const drop = new Set(accepted.filter((a) => a.kind === 'drop').map((a) => a.index));
  const swap = new Map(accepted.filter((a) => a.kind === 'swap').map((a) => [a.index, a.toExerciseId!]));
  const fewer = accepted.some((a) => a.kind === 'fewer_sets');
  const extra = accepted.some((a) => a.kind === 'extra_set');
  let exercises = template.exercises
    .map((e, i) => {
      let next = swap.has(i) ? { ...e, exerciseId: swap.get(i)! } : { ...e };
      if (fewer && i >= 2 && next.sets > 2 && isStrength(next.exerciseId)) next = { ...next, sets: next.sets - 1 };
      if (extra && i < 2 && isStrength(next.exerciseId)) next = { ...next, sets: next.sets + 1 };
      return { e: next, i };
    })
    .filter(({ i }) => !drop.has(i))
    .map(({ e }) => e);
  if (!exercises.length) exercises = template.exercises.slice(0, 1);
  let result: WorkoutTemplate = { ...template, exercises };
  const shorten = accepted.find((a) => a.kind === 'shorten');
  if (shorten?.minutes && estimateMinutes(result) > shorten.minutes) result = { ...fitTemplateToTime(result, shorten.minutes), id: template.id };
  return result;
}

/** "Seitheben entfällt" / "Bankdrücken: 2 statt 3 Sätze" – what a compact version changes. */
export function diff(from: WorkoutTemplate, to: WorkoutTemplate): string[] {
  const lines: string[] = [];
  from.exercises.forEach((e, i) => {
    const next = to.exercises[i];
    if (!next || next.exerciseId !== e.exerciseId) lines.push(`${nameOf(e.exerciseId)} entfällt`);
    else if (next.sets < e.sets) lines.push(`${nameOf(e.exerciseId)}: ${next.sets} statt ${e.sets} Sätze`);
    else if (next.restSec < e.restSec) lines.push(`${nameOf(e.exerciseId)}: ${next.restSec} s Pause statt ${e.restSec} s`);
  });
  return lines;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
