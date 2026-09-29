import type { MuscleGroup } from '../domain/types';

/**
 * Muscle model – how much an exercise loads each muscle (0 … 1: 1 = prime
 * mover, ~0.5 = strong helper, ~0.25 = stabilises / assists). Finer than the
 * library groups, so volume can later be attributed per muscle ("seitliche
 * Schulter bekommt weniger als die vordere"). Deliberately small: 16 muscles,
 * weights in quarter steps – extendable without changing the idea.
 *
 * Everything coarser is DERIVED from here: the library groups (filter, body
 * figure) must agree with it (tested), and the engine's six regions are the
 * maximum of their muscles.
 */
export type Muscle =
  | 'chest'
  | 'chest_upper'
  | 'front_delt'
  | 'side_delt'
  | 'rear_delt'
  | 'lats'
  | 'upper_back'
  | 'lower_back'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'abs';

export const MUSCLE_NAME: Record<Muscle, string> = {
  chest: 'Brust',
  chest_upper: 'Obere Brust',
  front_delt: 'Vordere Schulter',
  side_delt: 'Seitliche Schulter',
  rear_delt: 'Hintere Schulter',
  lats: 'Latissimus',
  upper_back: 'Oberer Rücken',
  lower_back: 'Unterer Rücken',
  biceps: 'Bizeps',
  triceps: 'Trizeps',
  forearms: 'Unterarme',
  quads: 'Oberschenkel vorne',
  hamstrings: 'Beinbeuger',
  glutes: 'Gesäß',
  calves: 'Waden',
  abs: 'Bauch',
};

/** Each muscle belongs to one library group. */
export const MUSCLE_GROUP_OF: Record<Muscle, MuscleGroup> = {
  chest: 'chest',
  chest_upper: 'chest',
  front_delt: 'shoulders',
  side_delt: 'shoulders',
  rear_delt: 'shoulders',
  lats: 'back',
  upper_back: 'back',
  lower_back: 'back',
  biceps: 'biceps',
  triceps: 'triceps',
  forearms: 'forearms',
  quads: 'quads',
  hamstrings: 'hamstrings',
  glutes: 'glutes',
  calves: 'calves',
  abs: 'core',
};

export type MuscleWeights = Partial<Record<Muscle, number>>;

/** Strength exercises of the library. Cardio and mobility load no muscle volume. */
export const EXERCISE_MUSCLES: Record<string, MuscleWeights> = {
  // Chest
  'bench-press': { chest: 1, chest_upper: 0.5, front_delt: 0.5, triceps: 0.5 },
  'db-bench-press': { chest: 1, chest_upper: 0.5, front_delt: 0.5, triceps: 0.5 },
  'incline-db-press': { chest_upper: 1, chest: 0.5, front_delt: 0.75, triceps: 0.5 },
  'chest-press': { chest: 1, chest_upper: 0.25, front_delt: 0.5, triceps: 0.5 },
  'push-up': { chest: 1, front_delt: 0.5, triceps: 0.5, abs: 0.25 },
  'cable-fly': { chest: 1, chest_upper: 0.25, front_delt: 0.25 },
  dips: { chest: 1, triceps: 0.5, front_delt: 0.5 },
  // Shoulders
  'overhead-press': { front_delt: 1, side_delt: 0.5, triceps: 0.5 },
  'machine-shoulder-press': { front_delt: 1, side_delt: 0.5, triceps: 0.5 },
  'lateral-raise': { side_delt: 1 },
  'face-pull': { rear_delt: 1, upper_back: 0.5 },
  'rear-delt-fly': { rear_delt: 1, upper_back: 0.5 },
  // Triceps
  'triceps-pushdown': { triceps: 1 },
  'overhead-triceps-extension': { triceps: 1 },
  'close-grip-bench': { triceps: 1, chest: 0.5, front_delt: 0.5 },
  // Back
  'barbell-row': { upper_back: 1, lats: 0.75, biceps: 0.5, rear_delt: 0.25, lower_back: 0.25 },
  'db-row': { lats: 1, upper_back: 0.5, biceps: 0.5 },
  'lat-pulldown': { lats: 1, upper_back: 0.5, biceps: 0.5 },
  'pull-up': { lats: 1, upper_back: 0.5, biceps: 0.5, abs: 0.25 },
  'assisted-pull-up': { lats: 1, upper_back: 0.5, biceps: 0.5 },
  'cable-row': { upper_back: 1, lats: 0.5, biceps: 0.5, rear_delt: 0.25 },
  'inverted-row': { upper_back: 1, lats: 0.5, biceps: 0.5, abs: 0.25 },
  'band-row': { upper_back: 1, lats: 0.5, biceps: 0.5, rear_delt: 0.25 },
  // Biceps
  'biceps-curl': { biceps: 1, forearms: 0.25 },
  'hammer-curl': { biceps: 1, forearms: 0.5 },
  'cable-curl': { biceps: 1, forearms: 0.25 },
  'band-curl': { biceps: 1 },
  // Legs
  squat: { quads: 1, glutes: 0.5, hamstrings: 0.25, abs: 0.25 },
  'goblet-squat': { quads: 1, glutes: 0.5, abs: 0.5 },
  'bodyweight-squat': { quads: 1, glutes: 0.5 },
  'leg-press': { quads: 1, glutes: 0.5 },
  'leg-extension': { quads: 1 },
  'split-squat': { quads: 1, glutes: 0.75, hamstrings: 0.25 },
  lunges: { quads: 1, glutes: 0.75, hamstrings: 0.25 },
  deadlift: { hamstrings: 1, glutes: 0.75, lower_back: 0.5, upper_back: 0.25, forearms: 0.25 },
  'romanian-deadlift': { hamstrings: 1, glutes: 0.75, lower_back: 0.25 },
  'db-romanian-deadlift': { hamstrings: 1, glutes: 0.75, lower_back: 0.25 },
  'leg-curl': { hamstrings: 1, calves: 0.25 },
  'hip-thrust': { glutes: 1, hamstrings: 0.5 },
  'glute-bridge': { glutes: 1, hamstrings: 0.5, abs: 0.25 },
  'kb-swing': { glutes: 1, hamstrings: 0.75, abs: 0.25, lower_back: 0.25 },
  'calf-raise': { calves: 1 },
  'standing-calf-raise': { calves: 1 },
  // Core
  'hanging-leg-raise': { abs: 1, forearms: 0.25 },
  plank: { abs: 1, front_delt: 0.25 },
  'dead-bug': { abs: 1 },
  'cable-crunch': { abs: 1 },
};
