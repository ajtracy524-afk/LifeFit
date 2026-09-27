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
  /** Estimated price per kg in CHF (Swiss shops) – an estimate, never shown as exact. Missing = unknown. */
  estPricePerKg?: number;
  /** Optional micronutrients per 100 g – only what is known (prepared for more). */
  micros?: Partial<Record<MicroNutrient, number>>;
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
  /** "Würde ich gern häufiger essen" (taste ids, see data/tastes.ts) – a starting point, learning can outweigh it. */
  favorites?: string[];
  /** "Eher selten oder gar nicht" – a strong soft rule, always stronger than anything learned. */
  avoided?: string[];
  /** Kind of meals that suit the user's daily target – the planner still sizes every portion. */
  mealStyle?: MealStyle;
  /** Personal daily water tracking value in ml – set by the user, never a medical target. */
  waterGoalMl?: number;
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
  source: 'openfoodfacts';
  fetchedAt: string;
  /** Catalog food the user said this product is – enables pantry, shopping and learning. */
  foodId?: string;
  /** What the user really paid (CHF) for `amount` (in `unit`) – optional, always preferred over estimates. */
  price?: { chf: number; amount: number; at: string };
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
/** Where the day's dinner happens. Time is a separate dimension (TimeBudget). */
export type DayMode = 'normal' | 'eating_out';

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
  /** Weekly food budget in CHF (estimated costs are compared against it). */
  weeklyBudgetChf?: number;
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
  /** Products looked up by barcode, keyed by barcode – a local cache, never synced. */
  products: Record<string, Product>;
  /** Water drunk per day in ml. A new day simply has no entry yet. */
  water: Record<ISODate, number>;
  /** The user's own saved dishes ("Meine Gerichte"), keyed by id. */
  customDishes: Record<string, CustomDish>;
}

/** One ingredient of an own dish, with the nutrient values it had when it was added. */
export interface DishIngredient {
  id: string;
  name: string;
  /** Amount in g (ml for drinks – weighed like grams). */
  grams: number;
  /** Where the values come from: curated catalog, extended database (FoodData Central) or a scanned product. */
  source: 'catalog' | 'database' | 'product';
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
  ingredients: DishIngredient[];
  createdAt: string;
  updatedAt: string;
}
