/**
 * Domain types. Mirrors the LifeFit data model (plan vs. actual kept separate,
 * nutrient snapshots on log entries, canonical units: g, kg, kcal, s).
 */

/** Local calendar date, `YYYY-MM-DD`. */
export type ISODate = string;

export type GoalType = 'muscle_gain' | 'fat_loss' | 'maintain';
export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active';
export type Experience = 'beginner' | 'intermediate';
export type DietType = 'omnivore' | 'vegetarian' | 'vegan';
export type Allergen = 'lactose' | 'gluten' | 'nuts' | 'fish';
export type MealSlot = 'breakfast' | 'snack' | 'lunch' | 'dinner';

export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

// ---------- Catalog ----------

export type ShoppingCategory =
  | 'produce'
  | 'meat_fish'
  | 'dairy'
  | 'bakery_grains'
  | 'canned'
  | 'frozen'
  | 'pantry';

export interface Food {
  id: string;
  name: string;
  category: ShoppingCategory;
  /** Nutrients per 100 g. */
  per100: Macros;
  /** Weight of one piece (egg, slice, wrap) – enables "Stück" display. */
  pieceG?: number;
  pieceLabel?: string;
  /** Typical package size – used to round shopping quantities. */
  packageG?: number;
  vegan: boolean;
  vegetarian: boolean;
  allergens: Allergen[];
  /** Estimated price per kg in EUR – an estimate, never shown as exact. Missing = unknown. */
  estPricePerKg?: number;
  /** Optional micronutrients per 100 g – only what is known (prepared for more). */
  micros?: Partial<Record<MicroNutrient, number>>;
}

/** Micronutrients the app can know about (per 100 g). Only fiber is filled so far. */
export type MicroNutrient = 'fiber';

export interface RecipeIngredient {
  foodId: string;
  /** Grams for one serving. */
  grams: number;
}

export interface Recipe {
  id: string;
  title: string;
  emoji: string;
  slots: MealSlot[];
  prepMin: number;
  tags: string[];
  ingredients: RecipeIngredient[];
  steps: string[];
}

export type Equipment = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight';

export interface Exercise {
  id: string;
  name: string;
  muscle: string;
  equipment: Equipment;
  /** Bodyweight exercises log reps; weight is optional (added load). */
  bodyweight?: boolean;
}

export interface TemplateExercise {
  exerciseId: string;
  sets: number;
  repMin: number;
  repMax: number;
  restSec: number;
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  focus: string;
  exercises: TemplateExercise[];
}

export interface WorkoutProgram {
  id: string;
  name: string;
  description: string;
  templates: WorkoutTemplate[];
}

// ---------- User data ----------

export interface Profile {
  name: string;
  sex: Sex;
  age: number;
  heightCm: number;
  activity: ActivityLevel;
  experience: Experience;
  createdAt: string;
}

export interface FitnessGoal {
  type: GoalType;
  startWeightKg: number;
  targetWeightKg?: number;
  startedAt: ISODate;
}

export interface NutritionProfile {
  diet: DietType;
  excluded: Allergen[];
  slots: MealSlot[];
  /** Explicit "mag ich nicht" – a hard filter right after allergens, stronger than anything learned. */
  dislikedFoods?: string[];
}

/** Versioned: the target valid for a day is the latest with validFrom <= day. */
export interface NutritionTarget extends Macros {
  id: string;
  validFrom: ISODate;
  method: 'formula' | 'manual';
}

export interface TrainingSetup {
  programId: string;
  /** 0 = Monday … 6 = Sunday – the default for every week. */
  weekdays: number[];
  /** F1: training days of single weeks chosen in the weekly check-in (keyed by week start). */
  weekOverrides?: Record<ISODate, number[]>;
}

export type PlannedMealStatus = 'planned' | 'eaten' | 'skipped';

export interface PlannedMeal {
  id: string;
  date: ISODate;
  slot: MealSlot;
  recipeId: string;
  servings: number;
  status: PlannedMealStatus;
  source: 'user' | 'suggest' | 'swap';
  /** Set when the user chose the servings – automatic rebalancing leaves the meal alone. */
  servingsLocked?: boolean;
}

export interface LogEntry {
  id: string;
  date: ISODate;
  slot: MealSlot;
  loggedAt: string;
  name: string;
  plannedMealId?: string;
  recipeId?: string;
  foodId?: string;
  grams?: number;
  servings?: number;
  method: 'plan' | 'food' | 'quick';
  /** Snapshot – history stays correct even if the catalog changes. */
  macros: Macros;
}

export type SetType = 'warmup' | 'working';

export interface WorkoutSet {
  id: string;
  weightKg: number | null;
  reps: number | null;
  done: boolean;
  type: SetType;
}

export interface WorkoutExercise {
  id: string;
  exerciseId: string;
  repMin: number;
  repMax: number;
  restSec: number;
  sets: WorkoutSet[];
}

export interface PersonalRecord {
  exerciseId: string;
  kind: 'est_1rm' | 'max_reps';
  value: number;
  weightKg: number | null;
  reps: number;
}

export interface Workout {
  id: string;
  date: ISODate;
  templateId: string;
  name: string;
  startedAt: string;
  endedAt?: string;
  status: 'in_progress' | 'completed';
  exercises: WorkoutExercise[];
  /** Filled on completion. */
  volumeKg?: number;
  records?: PersonalRecord[];
  /** The planned session this workout fulfils (see PlanSlotId). Missing on older workouts. */
  plannedId?: PlanSlotId;
}

export interface WeightEntry {
  id: string;
  date: ISODate;
  kg: number;
}

export interface ShoppingWeekState {
  /** foodId -> grams bought this week (credited to the pantry when ticked off). */
  purchased: Record<string, number>;
  /** F8: basics the user does not want to restock this week. */
  restockSkipped?: string[];
  manual: { id: string; name: string; checked: boolean }[];
}

// ---------- Week plan: context, overrides, pantry ----------

export type TimeBudget = 'low' | 'normal' | 'high';
export type DayMode = 'normal' | 'eating_out' | 'travel' | 'busy';

export interface DayContext {
  timeBudget: TimeBudget;
  mode: DayMode;
}

/**
 * Stable id of a planned training session: `${weekStart}#${k}` = the k-th
 * training day of that week according to the training setup.
 */
export type PlanSlotId = string;

/** Deviation from the rotation for one concrete session. */
export interface WorkoutOverride {
  slotId: PlanSlotId;
  status: 'moved' | 'skipped';
  /** Target day when moved (same week). */
  date?: ISODate;
}

/**
 * Pantry entry – deliberately an estimate. `quantityG` is the amount at
 * `updatedAt`; consumption logged afterwards is subtracted when reading.
 */
export interface PantryItem {
  foodId: string;
  quantityG: number;
  updatedAt: string;
}

/** Adaptive-engine settings. Recommendation ids contain the date, so dismissals expire naturally. */
export interface CoachState {
  dismissed: Record<string, ISODate>;
}

/** Evidence behind one learned preference (see domain/learning.ts). */
export interface PreferenceStat {
  pos: number;
  neg: number;
  updatedAt: string;
}

export type PlanPriority = 'save' | 'balanced' | 'protein' | 'health';

/** How the user wants the week planned – budget, priority, daily rhythm. */
export interface PlannerSettings {
  priority: PlanPriority;
  /** Weekly food budget in EUR (estimated costs are compared against it). */
  weeklyBudgetEur?: number;
  /** Preferred times "HH:MM" per meal slot. */
  mealTimes: Record<MealSlot, string>;
  /** Usual training time "HH:MM" – falls back to what LifeFit learned. */
  trainingTime?: string;
}

export interface AppState {
  schemaVersion: 2;
  profile: Profile | null;
  goal: FitnessGoal | null;
  nutritionProfile: NutritionProfile | null;
  targets: NutritionTarget[];
  training: TrainingSetup | null;
  plannedMeals: PlannedMeal[];
  logEntries: LogEntry[];
  workouts: Workout[];
  weights: WeightEntry[];
  /** keyed by week start (Monday) */
  shopping: Record<ISODate, ShoppingWeekState>;
  coach: CoachState;
  /** Only days that differ from the default context are stored. */
  dayContexts: Record<ISODate, DayContext>;
  workoutOverrides: Record<PlanSlotId, WorkoutOverride>;
  /** Across weeks, keyed by foodId. */
  pantry: Record<string, PantryItem>;
  /**
   * Calorie target of each completed (past) day, frozen when the day closed.
   * Only kcal: protein and fat come from the versioned targets and never change
   * for past days, carbs follow from kcal. The lived week is never rewritten.
   */
  closedDayTargets: Record<ISODate, number>;
  /** Personalization layer – learned from real behaviour, stored locally only. */
  learning: { preferences: Record<string, PreferenceStat> };
  plannerSettings: PlannerSettings;
}
