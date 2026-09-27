import { EXERCISES, getExercise } from '../data/exercises';
import type { Difficulty, Equipment, Exercise, ExerciseType, MuscleGroup, SetType, TrainingEquipment } from './types';

/** Labels and filters of the exercise library – one place for every screen (library, picker, detail). */

export const MUSCLE_LABEL: Record<MuscleGroup, string> = {
  chest: 'Brust',
  back: 'Rücken',
  shoulders: 'Schultern',
  biceps: 'Bizeps',
  triceps: 'Trizeps',
  forearms: 'Unterarme',
  quads: 'Oberschenkel vorne',
  hamstrings: 'Beinbeuger',
  glutes: 'Po',
  calves: 'Waden',
  core: 'Rumpf',
  cardio: 'Ausdauer',
};

export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  barbell: 'Langhantel',
  dumbbell: 'Kurzhantel',
  machine: 'Maschine',
  cable: 'Kabelzug',
  bodyweight: 'Körpergewicht',
  kettlebell: 'Kettlebell',
  band: 'Band',
  cardio_machine: 'Cardio-Gerät',
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { beginner: 'Einsteiger', intermediate: 'Fortgeschritten', advanced: 'Anspruchsvoll' };
export const TYPE_LABEL: Record<ExerciseType, string> = { strength: 'Kraft', cardio: 'Cardio', mobility: 'Mobility' };

export const SET_TYPE_LABEL: Record<SetType, string> = { working: 'Normal', warmup: 'Aufwärmen', drop: 'Drop-Satz', failure: 'Bis zum Muskelversagen', amrap: 'AMRAP (so viele wie möglich)' };
/** One letter in the set column; normal sets show their number. */
export const SET_TYPE_SHORT: Record<SetType, string> = { working: '', warmup: 'W', drop: 'D', failure: 'F', amrap: 'A' };

/** The filter chips: "Beine" bundles quads and hamstrings, the rest map 1:1. */
export type MuscleFilter = 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps' | 'legs' | 'glutes' | 'calves' | 'core' | 'cardio';
export const MUSCLE_FILTERS: Array<{ id: MuscleFilter; label: string; groups: MuscleGroup[] }> = [
  { id: 'chest', label: 'Brust', groups: ['chest'] },
  { id: 'back', label: 'Rücken', groups: ['back'] },
  { id: 'shoulders', label: 'Schultern', groups: ['shoulders'] },
  { id: 'biceps', label: 'Bizeps', groups: ['biceps'] },
  { id: 'triceps', label: 'Trizeps', groups: ['triceps'] },
  { id: 'legs', label: 'Beine', groups: ['quads', 'hamstrings'] },
  { id: 'glutes', label: 'Po', groups: ['glutes'] },
  { id: 'calves', label: 'Waden', groups: ['calves'] },
  { id: 'core', label: 'Core', groups: ['core'] },
  { id: 'cardio', label: 'Cardio', groups: ['cardio'] },
];

export interface ExerciseFilter {
  query?: string;
  muscle?: MuscleFilter;
  equipment?: Equipment;
  difficulty?: Difficulty;
  type?: ExerciseType;
}

const norm = (s: string) => s.toLocaleLowerCase('de-CH').normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Library search: text in name / muscle / equipment, and the filters. A muscle
 * filter matches the PRIMARY muscle first; exercises where it is secondary
 * follow (a bench press is found under "Trizeps", after the triceps exercises).
 */
export function filterExercises(filter: ExerciseFilter, list: Exercise[] = EXERCISES): Exercise[] {
  const q = filter.query ? norm(filter.query.trim()) : '';
  const groups = filter.muscle ? MUSCLE_FILTERS.find((m) => m.id === filter.muscle)!.groups : undefined;
  const hits = list.filter(
    (e) =>
      (!q || norm(`${e.name} ${e.muscle} ${EQUIPMENT_LABEL[e.equipment]}`).includes(q)) &&
      (!filter.equipment || e.equipment === filter.equipment) &&
      (!filter.difficulty || e.difficulty === filter.difficulty) &&
      (!filter.type || e.type === filter.type) &&
      (!groups || groups.includes(e.primary) || e.secondary.some((g) => groups.includes(g))),
  );
  if (!groups) return hits;
  const primary = (e: Exercise) => (groups.includes(e.primary) ? 0 : 1);
  return hits.sort((a, b) => primary(a) - primary(b));
}

/** Equipment available with the training setup – gym has everything. */
const AVAILABLE: Record<TrainingEquipment, Equipment[] | undefined> = {
  gym: undefined,
  home: ['dumbbell', 'bodyweight', 'band', 'kettlebell'],
  bodyweight: ['bodyweight', 'band'],
};

/**
 * Replacements for an exercise: its curated alternatives first, then other
 * exercises with the same primary muscle and type – filtered to what the
 * user can train with. Never the exercise itself.
 */
export function alternativesFor(exerciseId: string, equipment: TrainingEquipment = 'gym'): Exercise[] {
  const ex = getExercise(exerciseId);
  if (!ex) return [];
  const allowed = AVAILABLE[equipment];
  const ok = (e: Exercise) => e.id !== exerciseId && (!allowed || allowed.includes(e.equipment));
  const curated = ex.alternatives.map((id) => getExercise(id)).filter((e): e is Exercise => !!e && ok(e));
  const similar = EXERCISES.filter((e) => ok(e) && e.type === ex.type && e.primary === ex.primary && !curated.includes(e));
  return [...curated, ...similar];
}
