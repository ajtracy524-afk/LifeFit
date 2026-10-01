import type { OnboardingProfile } from './onboarding/types';
/**
 * Domain types. Mirrors the LifeFit data model (plan vs. actual kept separate,
 * nutrient snapshots on log entries, canonical units: g, kg, kcal, s).
 */

/** Local calendar date, `YYYY-MM-DD`. */
export type ISODate = string;

/** The ENERGY goal – drives calories and protein. The training focus is separate (TrainingSetup.focus). */
export type GoalType = 'muscle_gain' | 'fat_loss' | 'maintain' | 'recomp';
/** 'unspecified' = keine Angabe: energy formulas use the mean of the sex constants (docs/ONBOARDING_PLAN.md E2). */
export type Sex = 'male' | 'female' | 'unspecified';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active';
export type Experience = 'beginner' | 'intermediate' | 'advanced';
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
  /** Estimated price per kg in CHF (Swiss shops) – an estimate, never shown as exact. Missing = unknown. */
  estPricePerKg?: number;
  /** Optional micronutrients per 100 g – only what is known (prepared for more). */
  micros?: Partial<Record<MicroNutrient, number>>;
  /** Own foods only: vegan / vegetarian is not known (the flags above are then not a statement). */
  dietUnknown?: { vegan?: true; vegetarian?: true };
}

/**
 * Optional nutrients the app can know about (details in data/nutrients.ts).
 * The catalog knows fiber; sugar and salt come from packaged products or the
 * user; vitamins and minerals only from products that declare them. Never
 * estimated – an unknown value is absent, not 0.
 */
export type BasicNutrient = 'fiber' | 'sugar' | 'salt';
export type MicroNutrient =
  | BasicNutrient
  | 'vitaminA'
  | 'vitaminC'
  | 'vitaminD'
  | 'vitaminE'
  | 'vitaminK'
  | 'vitaminB1'
  | 'vitaminB2'
  | 'vitaminB3'
  | 'vitaminB6'
  | 'vitaminB9'
  | 'vitaminB12'
  | 'calcium'
  | 'magnesium'
  | 'iron'
  | 'potassium'
  | 'zinc'
  | 'phosphorus'
  | 'sodium';
export type Micros = Partial<Record<MicroNutrient, number>>;
export type MacroKey = 'protein' | 'carbs' | 'fat';
/** Unit an amount was entered in. `g`/`ml` are measured, `portion`/`piece` are counted. */
export type FoodUnit = 'g' | 'ml' | 'portion' | 'piece';

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
  /** An own dish offered to the planner (see domain/personal.ts) – not part of the curated catalog. */
  personal?: true;
}

export type Equipment = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight' | 'kettlebell' | 'band' | 'cardio_machine';

/** Muscle groups of the library (filter + body map). "Beine" in the filter = quads + hamstrings. */
export type MuscleGroup = 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps' | 'forearms' | 'quads' | 'hamstrings' | 'glutes' | 'calves' | 'core' | 'cardio';
export type Difficulty = 'beginner' | 'intermediate' | 'advanced';
/** strength = sets × reps × kg, cardio = minutes (optionally km), mobility = minutes / reps without load. */
export type ExerciseType = 'strength' | 'cardio' | 'mobility';

export interface Exercise {
  id: string;
  name: string;
  /** Short muscle label for lists ("Brust", "Beinbeuger & Po"). */
  muscle: string;
  equipment: Equipment;
  /** Bodyweight exercises log reps; weight is optional (added load). */
  bodyweight?: boolean;
  primary: MuscleGroup;
  secondary: MuscleGroup[];
  difficulty: Difficulty;
  type: ExerciseType;
  /** Compound (several joints) or isolation – strength only. */
  mechanics?: 'compound' | 'isolation';
  /** One sentence: what the movement is. */
  description: string;
  /** Short steps – how to do it. */
  steps: string[];
  /** Common mistakes / hints. */
  tips: string[];
  /** Exercises that train the same thing (ids, most similar first). */
  alternatives: string[];
}

export interface TemplateExercise {
  exerciseId: string;
  sets: number;
  repMin: number;
  repMax: number;
  restSec: number;
  /** Cardio / mobility: planned minutes per set (block). */
  durationMin?: number;
  /** Exercises with the same group run back to back as a superset (rest after the last one). */
  supersetGroup?: string;
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  focus: string;
  exercises: TemplateExercise[];
}

/** A reusable workout of the user ("Meine Routinen") – a template with a history of its own. */
export interface Routine extends WorkoutTemplate {
  createdAt: string;
  updatedAt: string;
  /** Built-in template it was copied from. */
  copiedFrom?: string;
}

export interface WorkoutProgram {
  id: string;
  name: string;
  description: string;
  templates: WorkoutTemplate[];
  /** Planned duration – a block, not an end: afterwards it simply continues. */
  weeks?: number;
  /** For whom it fits – used by recommendProgram. */
  level?: Experience;
  days?: number[];
  equipment?: TrainingEquipment;
  goal?: GoalType;
}

/** An own program: routines (own or built-in template ids) that rotate like a built-in program. */
export interface CustomProgram {
  id: string;
  name: string;
  routineIds: string[];
  weeks?: number;
  createdAt: string;
}

/** What the user can train with – filters the recommendation and replacement suggestions. */
export type TrainingEquipment = 'gym' | 'home' | 'bodyweight';

/** Single pieces of equipment – finer than the profile above (a home gym with a rack, a bench …). */
export type EquipmentItem = 'barbell' | 'rack' | 'bench' | 'dumbbells' | 'kettlebell' | 'cable' | 'machines' | 'pullup_bar' | 'bands' | 'cardio';

/** What the training is for – several at once = a combination. */
export type TrainingFocus = 'muscle' | 'strength' | 'fitness';

/** Confidence with free weights (barbell / dumbbell technique). */
export type FreeWeightSkill = 'none' | 'some' | 'confident';

/**
 * Lasting limitations (not today's discomfort): body areas to protect and
 * exercises that are not possible at all. No diagnosis – only what the user says.
 */
export interface TrainingLimitations {
  areas: BodyArea[];
  excludedExercises: string[];
  note?: string;
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
  /** "Würde ich gern häufiger essen" (taste ids, see data/tastes.ts) – a starting point, learning can outweigh it. */
  favorites?: string[];
  /** "Eher selten oder gar nicht" – a strong soft rule, always stronger than anything learned. */
  avoided?: string[];
  /** Kind of meals that suit the user's daily target – the planner still sizes every portion. */
  mealStyle?: MealStyle;
  /** Personal daily water tracking value in ml – set by the user, never a medical target. */
  waterGoalMl?: number;
  /** Water reminders: off, only as a hint in the app (default), or also as a system notification. */
  waterReminders?: WaterReminderMode;
}

export type WaterReminderMode = 'off' | 'app' | 'notify';

/** Today's water reminder memory – reset by a new day (see domain/water.ts). */
export interface WaterReminderState {
  date: ISODate;
  /** Last time water was added today (ISO). */
  lastDrinkAt?: string;
  /** "Später" – no reminder before this time (ISO). */
  snoozedUntil?: string;
  /** Reminders delivered today (ISO times) – spacing, daily limit, varying text. */
  sent?: string[];
}

export type MealStyle = 'light' | 'balanced' | 'hearty';

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
  /** What the user can train with (default: gym). */
  equipment?: TrainingEquipment;
  /** Day the current program started – "Woche 3 von 12". */
  startedAt?: ISODate;
  // ---- Extended training profile (all optional – older data stays valid) ----
  /** Years of regular strength training (0 = less than a year). */
  trainingYears?: number;
  freeWeights?: FreeWeightSkill;
  /** Usual time per session in minutes. */
  sessionMinutes?: number;
  /** Single pieces of equipment; missing = derived from `equipment`. */
  equipmentItems?: EquipmentItem[];
  limitations?: TrainingLimitations;
  likedExercises?: string[];
  dislikedExercises?: string[];
  focus?: TrainingFocus[];
  /** Muscle groups to develop especially (library groups, e.g. 'shoulders'). */
  musclePriorities?: MuscleGroup[];
}

/** A body measurement over time – body fat now, circumferences later, one log for all. */
export type MeasurementKind = 'body_fat';
export interface MeasurementEntry {
  id: string;
  date: ISODate;
  kind: MeasurementKind;
  value: number;
  /** 'estimate' is shown as a range, never as an exact number. */
  method: 'measured' | 'estimate';
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
  /** The recipe the user replaced with this one ("Pasta → Chicken Bowl") – feeds quick replacement suggestions. */
  replacedRecipeId?: string;
  /** Skipped because the day's dinner is eaten out – "Zuhause" brings exactly these back (not an own "Anders gegessen"). */
  skippedFor?: 'eating_out';
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
  /**
   * plan = eaten planned meal · food = catalog food · barcode = scanned product ·
   * manual = entered by hand · quick = older calorie-only entries (still read).
   */
  method: 'plan' | 'food' | 'quick' | 'manual' | 'barcode' | 'dish';
  /** Snapshot – history stays correct even if the catalog changes. */
  macros: Macros;
  /** Optional nutrients – only those actually known, never estimated. */
  micros?: Micros;
  /** Macros the source did not provide: 0 in `macros` (so sums work), shown as unknown. */
  unknown?: MacroKey[];
  /** Amount as the user entered it (manual / barcode). `grams` stays the weight for the pantry. */
  amount?: number;
  unit?: FoodUnit;
  /** Scanned product (key into AppState.products). */
  barcode?: string;
  brand?: string;
  /** false = eaten, but not taken from the pantry (the estimate stays untouched). */
  fromPantry?: false;
  /** Eaten instead of this planned meal (which is then skipped) – shown in its place, remembered as a replacement. */
  replacedMealId?: string;
  /** Real cost of the eaten amount in CHF (from a product price the user entered) – snapshot like the macros. */
  costChf?: number;
  /** Own dish this entry was logged from (the entry keeps its own snapshot). */
  dishId?: string;
  /** Catalog ingredients of an own dish (for the price estimate) – foodId '' = no catalog food. */
  ingredients?: { foodId: string; grams: number }[];
  /** FoodData Central id of a database food. */
  fdc?: number;
}

/**
 * A packaged product found by barcode – cached locally so logging it again
 * needs no network. Nutrients come from the product source; prices never do.
 */
export interface Product {
  barcode: string;
  name: string;
  /** The amount (in `unit`) the user logged last time – offered again next time, always editable. */
  lastAmount?: number;
  brand?: string;
  /** Per 100 g (or 100 ml, see `unit`) – only values the source provided. */
  per100: Partial<Macros>;
  micros100: Micros;
  unit: 'g' | 'ml';
  /** One serving in `unit`, if the source states it. */
  servingSize?: number;
  servingLabel?: string;
  /** Whole package in `unit`, if the source states it. */
  packageSize?: number;
  imageUrl?: string;
  /** Declared allergens (Open Food Facts `allergens_tags`, or set by the user) – known present. */
  allergens?: Allergen[];
  /** Known diet facts: true/false only when the source (or the user) states it – missing = unknown. */
  diet?: { vegan?: boolean; vegetarian?: boolean };
  /** Set when the user corrected the nutrients (the source stays in `source`): ISO time of the last correction. */
  nutrientsEdited?: string;
  /** openfoodfacts = found by barcode; manual = created by the user in "Meine Produkte". */
  source: 'openfoodfacts' | 'manual';
  fetchedAt: string;
  /** Catalog food the user said this product is – enables pantry, shopping and learning. */
  foodId?: string;
  /** What the user really paid (CHF) for `amount` (in `unit`) – optional, always preferred over estimates. */
  price?: { chf: number; amount: number; at: string };
}

/** 'working' = a normal set. Every type except warmup counts for volume and records. */
export type SetType = 'warmup' | 'working' | 'drop' | 'failure' | 'amrap';

export interface WorkoutSet {
  id: string;
  weightKg: number | null;
  reps: number | null;
  done: boolean;
  type: SetType;
  /** Cardio / mobility: minutes and (optional) distance. */
  durationMin?: number | null;
  distanceKm?: number | null;
  /** What was planned for this set when the session started – the actual values stay separate. */
  target?: { weightKg: number | null; reps: number | null };
  /** Deliberately left out in the session (not the same as "not ticked yet"). */
  skipped?: boolean;
  /** Rate of perceived exertion 6–10, only when the user entered it. */
  rpe?: number;
}

/** How the next session of an exercise was derived (see domain/adaptive/progression.ts). */
export type PrescriptionChange = 'first' | 'increase' | 'reps' | 'hold' | 'reduce' | 'same';

export interface Prescription {
  change: PrescriptionChange;
  /** One sentence why – "Letztes Training 3 × 8 @ 80 kg geschafft". */
  reason: string;
  weightKg: number | null;
  reps: number | null;
  durationMin?: number | null;
  /** +2,5 kg / −5 kg / +1 Wdh. / +5 min – for the label. */
  delta?: { kg?: number; reps?: number; min?: number };
  /** What the user did with it – the learning signal for the next suggestion. */
  decision?: 'accepted' | 'declined' | 'edited';
}

/** Body areas for "Beschwerden" – used to offer alternatives, never to diagnose. */
export type BodyArea = 'shoulder' | 'elbow' | 'wrist' | 'lower_back' | 'hip' | 'knee';
export type Effort = 'easy' | 'ok' | 'hard' | 'too_hard';
export type Energy = 'low' | 'normal' | 'high';

/** What the user said before the session ("Heute nur 35 min", "Schulter zwickt"). */
export interface SessionCheckIn {
  minutes?: number;
  discomfort?: BodyArea[];
  energy?: Energy;
}

/** A change to the plan the user accepted before starting – kept with its reason. */
export interface AppliedAdaptation {
  kind: 'shorten' | 'swap' | 'drop' | 'fewer_sets' | 'extra_set';
  title: string;
  reason: string;
}

/** After the session: how it felt. */
export interface WorkoutFeedback {
  effort?: Effort;
  discomfort?: BodyArea[];
}

export type AchievementKind = 'streak' | 'weight_up' | 'volume_up' | 'faster' | 'week_complete';

export interface Achievement {
  kind: AchievementKind;
  icon: string;
  title: string;
  detail: string;
}

/** The plan of one exercise, frozen at the start – "Geplant 3 × 8–10 @ 80 kg". */
export interface PlannedExercise {
  exerciseId: string;
  sets: number;
  repMin: number;
  repMax: number;
  weightKg?: number | null;
  durationMin?: number;
}

export interface WorkoutExercise {
  id: string;
  exerciseId: string;
  repMin: number;
  repMax: number;
  restSec: number;
  sets: WorkoutSet[];
  /** Plan snapshot; missing for exercises added in the session (extra) and on older workouts. */
  planned?: PlannedExercise;
  /** Swapped in the session – the planned exercise stays in `planned`. */
  replacedFrom?: string;
  skipped?: boolean;
  extra?: boolean;
  supersetGroup?: string;
  /** The suggestion the sets were prefilled with, and the user's decision. */
  prescription?: Prescription;
}

/** est_1rm / max_reps: the best set · max_weight: heaviest ever · rep: more reps at a weight · volume: most kg × reps in one session. */
export type RecordKind = 'est_1rm' | 'max_reps' | 'max_weight' | 'rep' | 'volume';

export interface PersonalRecord {
  exerciseId: string;
  kind: RecordKind;
  value: number;
  weightKg: number | null;
  reps: number;
  /** The best before – for "+5 kg" / "10 statt 8". */
  previous?: number;
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
  checkIn?: SessionCheckIn;
  adaptations?: AppliedAdaptation[];
  feedback?: WorkoutFeedback;
  /** Filled on completion – only what the data shows (streak, weight, volume, time). */
  achievements?: Achievement[];
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
/** Where the day's dinner happens. Time is a separate dimension (TimeBudget). */
export type DayMode = 'normal' | 'eating_out';

export interface DayContext {
  timeBudget: TimeBudget;
  mode: DayMode;
  /**
   * Meals the user removed from this day ("Mahlzeit entfernen"): the slot is
   * closed – no open task, no suggestion, no re-planning – until the user
   * plans something there again.
   */
  removedSlots?: MealSlot[];
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
  /**
   * Memory of recurring tips (keyed by topic, without date): when shown, how
   * often, and whether the pattern behind it resolved – so a tip is not
   * repeated for weeks and progress can be acknowledged once.
   */
  topics?: Record<string, CoachTopic>;
  /** Day reviews ("Dein gestriger Tag") the user has read, by reviewed date. */
  reviewSeen?: Record<ISODate, true>;
  /** Water reminders of today (pacing across the in-app hint and notifications). */
  water?: WaterReminderState;
}

export interface CoachTopic {
  firstShown: ISODate;
  lastShown: ISODate;
  /** Distinct days it was on screen. */
  shownDays: number;
  status: 'active' | 'resolved' | 'paused';
  /** When it resolved (the pattern no longer holds) or was paused (shown long, no change). */
  since?: ISODate;
  /** Strategy variant – after a pause the tip comes back with another approach. */
  variant?: number;
  /** How often the user hid it ("Ausblenden") – a clear signal: longer pause, other strategy. */
  dismissed?: number;
}

/**
 * Activity of a day beyond the planned training – entered by the user (or,
 * later, from a health data source). Kept apart from the targets: active
 * calories are shown and analysed, never automatically "eaten back".
 */
export interface DayActivity {
  activeKcal?: number;
  steps?: number;
  source: 'manual' | 'health';
  updatedAt: string;
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
  /** Weekly food budget in CHF (estimated costs are compared against it). */
  weeklyBudgetChf?: number;
  /** Preferred times "HH:MM" per meal slot. */
  mealTimes: Record<MealSlot, string>;
  /** Usual training time "HH:MM" – falls back to what LifeFit learned. */
  trainingTime?: string;
}

export interface AppState {
  schemaVersion: 3;
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
  /** Products looked up by barcode, keyed by barcode – a local cache, never synced. */
  products: Record<string, Product>;
  /** Water drunk per day in ml. A new day simply has no entry yet. */
  water: Record<ISODate, number>;
  /** The user's own saved dishes ("Meine Gerichte"), keyed by id. */
  customDishes: Record<string, CustomDish>;
  /** The user's own reusable workouts ("Meine Routinen"), keyed by id. */
  routines: Record<string, Routine>;
  /** The user's own programs (rotation of routines), keyed by id. */
  customPrograms: Record<string, CustomProgram>;
  /** Activity per day (active kcal, steps) – only days with data. */
  activity: Record<ISODate, DayActivity>;
  /** Body measurements over time (body fat …). */
  measurements: MeasurementEntry[];
  /** History of the training plan (see domain/planVersions.ts). Missing in older data – a v1 is derived. */
  planVersions?: PlanVersion[];
  /** Answers and progress of the new onboarding (domain/onboarding). Derived from the core data for older states. */
  onboarding?: OnboardingProfile;
}

/** Why a plan version was created. */
export type PlanChangeReason = 'start' | 'program' | 'days' | 'sessions' | 'coach';

/**
 * One version of the training plan – a frozen copy of what was planned from
 * `validFrom` on (until the next version starts). Only for looking back
 * ("Was hat sich geändert / Warum"); scheduling keeps using the live setup.
 */
export interface PlanVersion {
  id: string;
  validFrom: ISODate;
  programId: string;
  programName: string;
  weekdays: number[];
  sessions: WorkoutTemplate[];
  reason: PlanChangeReason;
  /** Short free text why (e.g. the coach's reason) – optional. */
  why?: string;
}

/** One ingredient of an own dish, with the nutrient values it had when it was added. */
export interface DishIngredient {
  id: string;
  name: string;
  /** Amount in g (ml for drinks – weighed like grams). */
  grams: number;
  /** Where the values come from: curated catalog, extended database (FoodData Central) or a scanned product. */
  source: 'catalog' | 'database' | 'product' | 'manual';
  /** foodId, database id or barcode. */
  ref: string;
  /** Snapshot per 100 g – the dish stays computable offline and does not change when a source changes. */
  per100: Partial<Macros>;
  micros100?: Micros;
  /** Catalog food behind it (for prices and the pantry link), if any. */
  foodId?: string;
}

/**
 * An own dish ("Melon Sandwich"). Its nutrients are always computed from the
 * ingredients (domain/dishes.ts). Logging it stores a snapshot, so editing
 * the dish later never changes what was already eaten.
 */
export interface CustomDish {
  id: string;
  name: string;
  /** How many portions the ingredients make. */
  portions: number;
  /** Meal slots the planner may suggest it for – none = only logged by hand, never planned. */
  slots?: MealSlot[];
  /** Preparation time in minutes (for the time budget of a day), when planned. */
  prepMin?: number;
  /** Deleted, but still referenced by planned/eaten meals: kept for history, never suggested or listed. */
  archived?: true;
  ingredients: DishIngredient[];
  createdAt: string;
  updatedAt: string;
}
