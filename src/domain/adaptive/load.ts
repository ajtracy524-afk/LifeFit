import { getExercise } from '../../data/exercises';
import type { WorkoutTemplate } from '../types';

/**
 * How demanding a session is – relative, from its content: sets × a weight
 * per exercise kind. Big leg / hip lifts move the most muscle, back lifts a
 * bit less, other compound lifts less, isolation exercises least; cardio by
 * minutes (HIIT more per minute). It is a relative score to distribute the
 * week's training energy between days – not a calorie measurement.
 */
const W = { legsCompound: 1.5, backCompound: 1.2, compound: 1, isolation: 0.6, cardioPer5Min: 1, hiitPer5Min: 1.4 } as const;

export interface SessionLoad {
  score: number;
  /** Share of the score from legs / hips – "Beintag" from 50 %. */
  legsShare: number;
  label?: 'Beintag' | 'Oberkörper' | 'Ganzkörper' | 'Cardio';
}

export function sessionLoad(template: Pick<WorkoutTemplate, 'exercises'>): SessionLoad {
  let score = 0;
  let legs = 0;
  let upper = 0;
  let cardio = 0;
  for (const e of template.exercises) {
    const ex = getExercise(e.exerciseId);
    if (!ex) continue;
    if (ex.type !== 'strength') {
      const s = ((e.durationMin ?? 20) * e.sets) / 5 * (ex.id.startsWith('hiit') ? W.hiitPer5Min : W.cardioPer5Min) * (ex.type === 'mobility' ? 0.3 : 1);
      score += s;
      cardio += s;
      continue;
    }
    const lower = ['quads', 'hamstrings', 'glutes', 'calves'].includes(ex.primary);
    const w = ex.mechanics === 'isolation' ? W.isolation : lower ? W.legsCompound : ex.primary === 'back' ? W.backCompound : W.compound;
    score += e.sets * w;
    if (lower) legs += e.sets * w;
    else upper += e.sets * w;
  }
  const legsShare = score ? legs / score : 0;
  const label = !score ? undefined : cardio / score > 0.6 ? 'Cardio' : legsShare >= 0.5 ? 'Beintag' : legsShare < 0.15 && upper > 0 ? 'Oberkörper' : 'Ganzkörper';
  return { score: Math.round(score * 10) / 10, legsShare: Math.round(legsShare * 100) / 100, ...(label ? { label } : {}) };
}
