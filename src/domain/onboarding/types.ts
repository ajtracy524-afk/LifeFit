import type { CardioPlan, ComplaintSeverity, CookingTime, Intolerance, LmivAllergen, SlotPlan, TrainingPlace, Weekday } from '../types';
import type { DayPlan, PlanSession, SplitId } from '../training/recommendPlan';
import type { ActivityLevel, BodyArea, EquipmentItem, Experience, MealSlot, MuscleGroup } from '../types';

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

export type { LmivAllergen } from '../types';

export type { CookingTime, Intolerance } from '../types';
export type { CardioKind, CardioType, ComplaintSeverity, TrainingPlace } from '../types';
export type { SlotPlan, Weekday, WeekTemplate } from '../types';

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
  /** A step opened from the summary returns there (Prompt 9). */
  returnTo?: 'summary';
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
    /** Losing fat: the goal weight follows from it when no target weight is given (goalWeightOf). */
    targetBodyFat?: Field<number>;
  };
  food: {
    diet?: Field<'omnivore' | 'pescatarian' | 'vegetarian' | 'vegan'>;
    allergens?: Field<LmivAllergen[]>;
    /** Allergens for which traces are okay (E15). */
    tracesOk?: Field<LmivAllergen[]>;
    /** "Alkohol aus Fermentation ist für mich okay" (E17). */
    fermentationAlcoholOk?: Field<boolean>;
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
    /** Where the user trains (Prompt 7) – the equipment above follows from it. */
    places?: Field<TrainingPlace[]>;
    /** Pause longer than 6 months (asked when area A says "pausiert") – one level lower (Prompt 7). */
    pausedLong?: Field<boolean>;
    complaints?: Field<{ areas: BodyArea[]; note?: string; severity?: Partial<Record<BodyArea, ComplaintSeverity>> }>;
    cardio?: Field<CardioPlan>;
    focusMuscles?: Field<MuscleGroup[]>;
    plan?: Field<{ programId: string; weekdays: number[] }>;
    /** The plan being edited in "Dein Trainingsplan" (Prompt 8) – kept between visits; `key` = the answers it was made for. */
    planDraft?: Field<PlanDraft>;
  };
  /** The Heute card for missing answers ("Neue Angaben ergänzen" for users of the old onboarding): rest after "Später". */
  notices?: { completeCard?: { dismissedUntil?: string } };
}

/** The groups of answers, as stored in OnboardingProfile. */
export type AnswerGroup = 'body' | 'health' | 'goal' | 'food' | 'training';

/** A generated plan with the user's edits (Prompt 8). */
export interface PlanDraft {
  key: string;
  split: SplitId;
  sessions: PlanSession[];
  week: DayPlan[];
}
