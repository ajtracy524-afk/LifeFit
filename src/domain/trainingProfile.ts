import type { Equipment, EquipmentItem, Experience, FreeWeightSkill, GoalType, TrainingEquipment, TrainingFocus, TrainingSetup } from './types';

/**
 * The extended training profile – one place for what follows from it, so the
 * planner, the replacements and the check-in read the same answers:
 *   level from training age and free-weight skill
 *   available equipment from single items (or the gym / home profile)
 *   a sensible default focus from the energy goal
 */

/** Training age → level. No free-weight practice keeps it at "Einsteiger" (technique first). */
export function experienceFrom(years: number | undefined, freeWeights: FreeWeightSkill | undefined): Experience {
  if (years === undefined) return 'beginner';
  const byYears: Experience = years < 1 ? 'beginner' : years < 5 ? 'intermediate' : 'advanced';
  if (freeWeights === 'none') return 'beginner';
  if (freeWeights === 'some' && byYears === 'advanced') return 'intermediate';
  return byYears;
}

export const TRAINING_YEARS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Unter 1 Jahr' },
  { value: 1, label: '1–2 Jahre' },
  { value: 3, label: '3–4 Jahre' },
  { value: 5, label: '5+ Jahre' },
];

export const EQUIPMENT_ITEM_LABEL: Record<EquipmentItem, string> = {
  barbell: 'Langhantel',
  rack: 'Rack / Ständer',
  bench: 'Hantelbank',
  dumbbells: 'Kurzhanteln',
  kettlebell: 'Kettlebell',
  cable: 'Kabelzug',
  machines: 'Maschinen',
  pullup_bar: 'Klimmzugstange',
  bands: 'Widerstandsbänder',
  cardio: 'Cardio-Geräte',
};

/** Typical items of the three profiles – the starting selection, editable. */
export const DEFAULT_ITEMS: Record<TrainingEquipment, EquipmentItem[]> = {
  gym: ['barbell', 'rack', 'bench', 'dumbbells', 'kettlebell', 'cable', 'machines', 'pullup_bar', 'bands', 'cardio'],
  home: ['dumbbells', 'bench', 'bands'],
  bodyweight: [],
};

/** Library equipment each item makes possible (bodyweight is always possible). */
const ITEM_EQUIPMENT: Record<EquipmentItem, Equipment[]> = {
  barbell: ['barbell'],
  rack: [],
  bench: [],
  dumbbells: ['dumbbell'],
  kettlebell: ['kettlebell'],
  cable: ['cable'],
  machines: ['machine'],
  pullup_bar: [],
  bands: ['band'],
  cardio: ['cardio_machine'],
};

/** The library equipment the user can use – from single items if given, otherwise from the profile. */
export function availableEquipment(setup: Pick<TrainingSetup, 'equipment' | 'equipmentItems'> | null | undefined): Equipment[] | undefined {
  const items = setup?.equipmentItems ?? (setup?.equipment && setup.equipment !== 'gym' ? DEFAULT_ITEMS[setup.equipment] : undefined);
  if (!items) return undefined; // gym without a list: everything
  return [...new Set<Equipment>(['bodyweight', ...items.flatMap((i) => ITEM_EQUIPMENT[i])])];
}

export const FOCUS_LABEL: Record<TrainingFocus, string> = { muscle: 'Muskelaufbau', strength: 'Kraft', fitness: 'Allgemeine Fitness' };

/** A focus that fits the energy goal – a proposal the user can change (several = combination). */
export function defaultFocus(goal: GoalType | undefined): TrainingFocus[] {
  return goal === 'maintain' ? ['fitness'] : ['muscle'];
}

/** Liked first, disliked last, excluded never – the order replacements and suggestions use. */
export function preferenceRank(setup: Pick<TrainingSetup, 'likedExercises' | 'dislikedExercises'> | null | undefined, exerciseId: string): number {
  if (setup?.likedExercises?.includes(exerciseId)) return 0;
  if (setup?.dislikedExercises?.includes(exerciseId)) return 2;
  return 1;
}

export const isExcluded = (setup: Pick<TrainingSetup, 'limitations'> | null | undefined, exerciseId: string): boolean => !!setup?.limitations?.excludedExercises.includes(exerciseId);
