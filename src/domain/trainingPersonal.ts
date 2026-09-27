import { findTemplate, setPersonalTraining } from '../data/exercises';
import type { AppState, CustomProgram, Routine, WorkoutProgram, WorkoutTemplate } from './types';

/**
 * The user's own routines and programs, made known to the existing training
 * system (findTemplate / getProgram → rotation, sessions, history) – no
 * second scheduler. Own routine ids start with `routine:`, own program ids
 * with `program:`; built-in ids never contain a colon.
 */

export const isOwnRoutineId = (id: string) => id.startsWith('routine:');
export const isOwnProgramId = (id: string) => id.startsWith('program:');

let last: { routines: unknown; programs: unknown } | undefined;

export function syncTraining(state: Pick<AppState, 'routines' | 'customPrograms'>): void {
  if (last && last.routines === state.routines && last.programs === state.customPrograms) return;
  last = { routines: state.routines, programs: state.customPrograms };
  const routines = new Map<string, WorkoutTemplate>();
  for (const r of Object.values(state.routines ?? {})) routines.set(r.id, routineTemplate(r));
  // Programs resolve their routines after the routines are registered.
  setPersonalTraining(routines, new Map());
  const programs = new Map<string, WorkoutProgram>();
  for (const p of Object.values(state.customPrograms ?? {})) programs.set(p.id, programOf(p));
  setPersonalTraining(routines, programs);
}

const routineTemplate = (r: Routine): WorkoutTemplate => ({ id: r.id, name: r.name, focus: r.focus, exercises: r.exercises });

function programOf(p: CustomProgram): WorkoutProgram {
  const templates = p.routineIds.map((id) => findTemplate(id)).filter((t): t is WorkoutTemplate => !!t);
  return { id: p.id, name: p.name, description: `Eigenes Programm · ${templates.length} ${templates.length === 1 ? 'Routine' : 'Routinen'} im Wechsel`, templates, ...(p.weeks ? { weeks: p.weeks } : {}) };
}
