import type { ActivityLevel, BodyArea, EquipmentItem, Experience, Macros, MealSlot, MuscleGroup } from '../types';

/**
 * The new onboarding (docs/ONBOARDING_PLAN.md, section c): every answer knows
 * where it came from. The values the app computes with stay in the existing
 * structures (profile, goal, nutritionProfile, training, targets …) – this
 * profile only keeps the answers and the progress of the flow.
 */

/** user = entered, estimated = derived, default = assumed, migrated = re-interpreted from older data (to be confirmed once). */
export type FieldSource = 'user' | 'estimated' | 'default' | 'migrated';

export interface Field<T> {
  value: T;
  source: FieldSource;
  /** ISO time of the last change. */
  updatedAt: string;
  /** For migrated values: when the user confirmed them (then the source becomes 'user'). */
  confirmedAt?: string;
}

export type OnboardingSection = 'A' | 'B' | 'C';
export type OnboardingMode = 'quick' | 'full';

export type OnboardingStepId =
  | 'welcome'
  // A – Körper & Ziel (one topic per screen)
  | 'weight'
  | 'height'
  | 'birthYear'
  | 'sex'
  | 'experience'
  | 'activity'
  | 'waist'
  | 'analysis'
  | 'bodyFat'
  | 'health'
  | 'goal'
  // B – Essen & Einkauf
  | 'diet'
  | 'allergies'
  | 'preferences'
  | 'routine'
  | 'week'
  | 'pantry'
  // C – Training
  | 'level'
  | 'frame'
  | 'cardio'
  | 'focus'
  | 'plan'
  | 'summary';

/** The 14 main allergens of the EU food information regulation (LMIV, Annex II). */
export type LmivAllergen =
  | 'gluten'
  | 'crustaceans'
  | 'eggs'
  | 'fish'
  | 'peanuts'
  | 'soy'
  | 'milk'
  | 'tree_nuts'
  | 'celery'
  | 'mustard'
  | 'sesame'
  | 'sulphites'
  | 'lupin'
  | 'molluscs';

export type Intolerance = 'lactose' | 'fructose' | 'celiac';
export type CookingTime = '15' | '30' | '45' | 'any';
export type CardioType = 'walking' | 'cycling' | 'running' | 'rowing' | 'swimming' | 'crosstrainer';
/** 0 = Monday … 6 = Sunday (as everywhere in the app). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type SlotPlan =
  | { kind: 'home' }
  | { kind: 'togo' }
  | { kind: 'out'; place?: 'canteen' | 'restaurant' | 'friends'; size?: 'small' | 'normal' | 'large' }
  /** Planned skip (e.g. intermittent fasting) – its share goes to the other meals (E12). */
  | { kind: 'skip' };

export interface OnboardingProgress {
  /** Step to resume at. */
  step?: OnboardingStepId;
  /** While the flow is open: the next app start lands here again. */
  active?: boolean;
  /** Re-opened from the profile: only this section is shown. */
  scope?: OnboardingSection;
  /** Position of the unfinished main flow while a section is re-opened – restored when it closes. */
  mainStep?: OnboardingStepId;
  mainMode?: OnboardingMode;
  completed: Partial<Record<OnboardingSection, string>>;
  skipped: OnboardingStepId[];
  finishedAt?: string;
  /** Finished with the old onboarding – no new run, only the "Neue Angaben ergänzen" card (E8). */
  legacy?: true;
}

export interface OnboardingProfile {
  version: 1;
  mode?: OnboardingMode;
  progress: OnboardingProgress;
  body: {
    weightKg?: Field<number>;
    heightCm?: Field<number>;
    birthYear?: Field<number>;
    sex?: Field<'male' | 'female' | 'unspecified'>;
    trainingExperience?: Field<'never' | 'lt1' | '1to2' | '3to5' | 'gt5'>;
    trainingPaused?: Field<boolean>;
    activity?: Field<ActivityLevel>;
    waistCm?: Field<number>;
    neckCm?: Field<number>;
    hipCm?: Field<number>;
    bodyFat?: Field<{ method: 'measured' | 'navy' | 'rfm' | 'visual'; percent: number; range: [number, number] }>;
  };
  health: {
    pregnancy?: Field<'no' | 'pregnant' | 'breastfeeding'>;
    numberFree?: Field<boolean>;
  };
  goal: {
    type?: Field<'fat_loss' | 'recomp' | 'muscle_gain' | 'maintain'>;
    pace?: Field<'gentle' | 'normal' | 'brisk'>;
    targetWeightKg?: Field<number>;
    targetBodyFat?: Field<number>;
    overrides?: Field<Partial<Macros>>;
  };
  food: {
    diet?: Field<'omnivore' | 'pescatarian' | 'vegetarian' | 'vegan'>;
    allergens?: Field<LmivAllergen[]>;
    intolerances?: Field<Intolerance[]>;
    exclusions?: Field<Array<'pork' | 'alcohol'>>;
    customExclusions?: Field<string[]>;
    preferences?: Field<Record<string, 'like' | 'dislike'>>;
    meals?: Field<MealSlot[]>;
    cookingTime?: Field<{ weekday: CookingTime; weekend: CookingTime }>;
    mealPrep?: Field<boolean>;
    householdSize?: Field<number>;
    budget?: Field<'low' | 'medium' | 'any'>;
    weekTemplate?: Field<Partial<Record<Weekday, Partial<Record<MealSlot, SlotPlan>>>>>;
  };
  training: {
    level?: Field<Experience>;
    workingWeights?: Field<Record<string, { kg: number; reps: number }>>;
    weekdays?: Field<number[]>;
    sessionMinutes?: Field<number>;
    equipment?: Field<EquipmentItem[]>;
    complaints?: Field<{ areas: BodyArea[]; note?: string }>;
    cardio?: Field<{ kind: 'none' | 'steps' | 'zone2' | 'hiit' | 'mix'; types: CardioType[] }>;
    focusMuscles?: Field<MuscleGroup[]>;
    plan?: Field<{ programId: string; weekdays: number[] }>;
  };
  /** One-time hints: confirmation of migrated values, the "Neue Angaben ergänzen" card. */
  notices?: { confirmMigratedAt?: string; completeCard?: { dismissedUntil?: string } };
}

/** The groups of answers, as stored in OnboardingProfile. */
export type AnswerGroup = 'body' | 'health' | 'goal' | 'food' | 'training';
