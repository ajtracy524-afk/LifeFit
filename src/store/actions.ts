/**
 * All state changes live here. Screens call these functions; the cross-domain
 * rules (plan → log, workout → progress) are enforced in one place.
 */
import { getFood } from '../data/foods';
import { findTemplate } from '../data/exercises';
import { addDays, today, weekStart } from '../domain/dates';
import { calculateTargets, foodMacros, logFromMeal, roundMacros, scaleMicros } from '../domain/nutrition';
import { activeWorkouts, createWorkout, detectRecords, lastSetsFor, workoutExercise, workoutVolume } from '../domain/training';
import { workoutAchievements } from '../domain/adaptive/achievements';
import { TOPIC_RULES } from '../domain/engine/topics';
import { experienceFrom } from '../domain/trainingProfile';
import { ensurePlanBaseline, recordPlanVersion } from '../domain/planVersions';
import { applyWeekChange, closeCompletedDays, dayContextFor, fillWeek, type CascadeResult, type WeekChange } from '../domain/week';
import { recordEvent } from '../domain/learning';
import { productEntry, type EntryContent } from '../domain/foodEntry';
import { dbFoodEntry, dishEntry, validateDish, type DishDraft } from '../domain/dishes';
import { slotRepeat } from '../domain/repeatMeal';
import type { DbFood } from '../data/foodDb';
import { addWater, WATER_REMINDER, waterReminderState } from '../domain/water';
import { effectiveTimeBudget } from '../domain/timeBudget';
import { currentWeight } from '../domain/progress';
import { targetOptionsFor } from '../domain/body';
import { newId } from '../lib/id';
import type {
  AppState,
  FitnessGoal,
  ISODate,
  LogEntry,
  Macros,
  MealSlot,
  NutritionProfile,
  PlannedMeal,
  Product,
  Profile,
  AppliedAdaptation,
  MeasurementEntry,
  Routine,
  SessionCheckIn,
  SetType,
  WorkoutFeedback,
  TemplateExercise,
  TrainingSetup,
  WorkoutExercise,
  WorkoutSet,
  WorkoutTemplate,
  WaterReminderMode,
} from '../domain/types';
import type { EngineAction } from '../domain/engine';
import { commit, getState, update } from './store';

// ---------- Onboarding ----------

export interface OnboardingResult {
  profile: Profile;
  goal: FitnessGoal;
  nutritionProfile: NutritionProfile;
  training: TrainingSetup;
  target: Macros;
  weightKg: number;
  bodyFat?: { value: number; method: 'measured' | 'estimate' };
}

export function completeOnboarding(input: OnboardingResult): void {
  const t = today();
  update((s) => {
    s.profile = input.profile;
    s.goal = input.goal;
    s.nutritionProfile = input.nutritionProfile;
    s.training = input.training;
    recordPlanVersion(s, 'start', t);
    // Existing data (e.g. from an incomplete earlier setup) is kept; for a new user these lists are empty.
    s.targets = [...s.targets.filter((x) => x.validFrom !== t), { id: newId(), validFrom: t, method: 'formula', ...input.target }];
    s.weights = [...s.weights.filter((w) => w.date !== t), { id: newId(), date: t, kg: input.weightKg }];
    if (input.bodyFat) s.measurements = [...(s.measurements ?? []).filter((m) => !(m.kind === 'body_fat' && m.date === t)), { id: newId(), date: t, kind: 'body_fat', value: Math.round(input.bodyFat.value * 10) / 10, method: input.bodyFat.method }];
    // Same central planner as "Woche vorschlagen" and the weekly check-in.
    fillWeek(s, weekStart(t), t);
  });
}

// ---------- Meal planning ----------

/** Fills empty slots from today (or the week start, if later) to Sunday. Returns the number of meals added. */
export function suggestMealsForWeek(start: ISODate): number {
  let added = 0;
  update((d) => {
    added = fillWeek(d, start, today()).length;
  });
  return added;
}

export function addPlannedMeal(date: ISODate, slot: MealSlot, recipeId: string, servings: number): PlannedMeal {
  const id = newId();
  applyChange({ type: 'addMeal', date, slot, recipeId, servings, id });
  return getState().plannedMeals.find((m) => m.id === id)!;
}

/** The user sets servings → the meal is locked against automatic rebalancing. */
export function updateServings(mealId: string, servings: number): void {
  applyChange({ type: 'setServings', mealId, servings });
}

export function swapMeal(mealId: string, recipeId: string, servings: number): void {
  applyChange({ type: 'replaceMeal', mealId, recipeId, servings });
}

export function removePlannedMeal(mealId: string): void {
  applyChange({ type: 'removeMeal', mealId });
}

/** One-tap tracking: the planned meal becomes a log entry with a nutrient snapshot. */
export function markEaten(mealId: string): void {
  update((s) => {
    const meal = s.plannedMeals.find((m) => m.id === mealId);
    if (!meal || meal.status === 'eaten') return;
    meal.status = 'eaten';
    s.logEntries.push(logFromMeal(meal));
    // Actually eating it is the strongest positive signal.
    recordEvent(s, { type: 'meal_eaten', recipeId: meal.recipeId, slot: meal.slot, timeBudget: budgetOn(s, meal.date) }, new Date().toISOString());
  });
}

export function unmarkEaten(mealId: string): void {
  update((s) => {
    const meal = s.plannedMeals.find((m) => m.id === mealId);
    if (meal?.status === 'eaten') {
      recordEvent(s, { type: 'meal_uneaten', recipeId: meal.recipeId, slot: meal.slot, timeBudget: budgetOn(s, meal.date) }, new Date().toISOString());
    }
    if (meal) meal.status = 'planned';
    s.logEntries = s.logEntries.filter((e) => e.plannedMealId !== mealId);
  });
}

/** "Anders gegessen": the plan is kept as skipped, ingredients drop off the shopping list. */
export function skipMeal(mealId: string): void {
  update((s) => {
    const meal = s.plannedMeals.find((m) => m.id === mealId);
    if (meal && meal.status !== 'skipped') {
      recordEvent(s, { type: 'meal_skipped', recipeId: meal.recipeId, slot: meal.slot, timeBudget: budgetOn(s, meal.date) }, new Date().toISOString());
      meal.status = 'skipped';
    }
    s.logEntries = s.logEntries.filter((e) => e.plannedMealId !== mealId);
  });
}

const budgetOn = (s: AppState, date: ISODate) => effectiveTimeBudget(dayContextFor(s, date));

// ---------- Free logging ----------

export interface LogOptions {
  /**
   * Id chosen when the confirm screen opened: a second tap (or a re-sent
   * scan) with the same id is ignored – one confirmation, one entry.
   */
  id?: string;
  /** false = eaten, but not taken from the pantry. */
  fromPantry?: boolean;
}

/**
 * The one path for food eaten outside the plan (catalog, barcode, manual).
 * Real consumption goes into the log – it never books anything INTO the
 * pantry; taking from the pantry is derived from the entry (see pantry.ts).
 * An entry with a known catalog food is a (slow) taste signal.
 * Returns false if nothing was added (duplicate id).
 */
export function logEntry(date: ISODate, slot: MealSlot, content: EntryContent, opts: LogOptions = {}): boolean {
  const id = opts.id ?? newId();
  if (getState().logEntries.some((e) => e.id === id)) return false;
  update((s) => {
    const loggedAt = new Date().toISOString();
    const entry: LogEntry = { id, date, slot, loggedAt, ...content, ...(opts.fromPantry === false ? { fromPantry: false } : {}) };
    s.logEntries.push(entry);
    if (entry.foodId && getFood(entry.foodId)) recordEvent(s, { type: 'food_logged', foodId: entry.foodId }, loggedAt);
  });
  return true;
}

export function logFood(date: ISODate, slot: MealSlot, foodId: string, grams: number, opts: LogOptions = {}): boolean {
  const food = getFood(foodId);
  if (!food) return false;
  return logEntry(
    date,
    slot,
    { name: food.name, foodId, grams, method: 'food', macros: roundMacros(foodMacros(food, grams)), micros: scaleMicros(food.micros, grams / 100) },
    opts,
  );
}

export type ProductOptions = LogOptions & {
  /** null = explicitly no catalog link. */
  foodId?: string | null;
  /** A price the user just entered: CHF paid for `amount` (in the product's unit). */
  price?: { chf: number; amount: number };
};

/** The product with the user's choices from the confirm screen (catalog link, entered price). */
function withChoice(input: Product, opts: ProductOptions): { product: Product; foodId: string | undefined } {
  const foodId = opts.foodId === null ? undefined : (opts.foodId ?? input.foodId);
  const price = opts.price ? { ...opts.price, at: new Date().toISOString() } : input.price;
  return { product: { ...input, ...(price ? { price } : {}) }, foodId };
}

/**
 * Logs `amount` of a scanned product. The product (with the user's catalog
 * link and price) is kept in the local cache so it can be found again offline.
 */
export function logProduct(date: ISODate, slot: MealSlot, input: Product, amount: number, opts: ProductOptions = {}): boolean {
  const { product, foodId } = withChoice(input, opts);
  const content = productEntry(product, amount, foodId);
  if (!content) return false;
  const id = opts.id ?? newId();
  if (getState().logEntries.some((e) => e.id === id)) return false;
  saveProduct({ ...product, foodId, lastAmount: amount });
  return logEntry(date, slot, content, { ...opts, id });
}

/**
 * "Ersetzen" with something that is not a recipe (barcode product, manual
 * entry, a remembered replacement): in ONE state change the planned meal
 * becomes skipped, its own log entry (if it was eaten) is removed and the new
 * entry is logged with `replacedMealId`. So the day balance counts only the
 * replacement – never both. Returns false if nothing changed.
 */
export function replaceWithEntry(mealId: string, content: EntryContent, opts: LogOptions = {}): boolean {
  const s = getState();
  const meal = s.plannedMeals.find((m) => m.id === mealId);
  const id = opts.id ?? newId();
  if (!meal || meal.status === 'skipped' || s.logEntries.some((e) => e.id === id)) return false;
  update((d) => {
    const m = d.plannedMeals.find((x) => x.id === mealId)!;
    const nowIso = new Date().toISOString();
    const timeBudget = budgetOn(d, m.date);
    if (m.status === 'eaten') recordEvent(d, { type: 'meal_uneaten', recipeId: m.recipeId, slot: m.slot, timeBudget }, nowIso);
    recordEvent(d, { type: 'meal_skipped', recipeId: m.recipeId, slot: m.slot, timeBudget }, nowIso);
    m.status = 'skipped';
    d.logEntries = d.logEntries.filter((e) => e.plannedMealId !== mealId);
    const entry: LogEntry = { id, date: m.date, slot: m.slot, loggedAt: nowIso, ...content, replacedMealId: mealId, ...(opts.fromPantry === false ? { fromPantry: false } : {}) };
    d.logEntries.push(entry);
    if (entry.foodId && getFood(entry.foodId)) recordEvent(d, { type: 'food_logged', foodId: entry.foodId }, nowIso);
  });
  return true;
}

export function replaceWithProduct(mealId: string, input: Product, amount: number, opts: ProductOptions = {}): boolean {
  const { product, foodId } = withChoice(input, opts);
  const content = productEntry(product, amount, foodId);
  if (!content) return false;
  const done = replaceWithEntry(mealId, content, opts);
  if (done) saveProduct({ ...product, foodId, lastAmount: amount });
  return done;
}

/**
 * "Ersetzen" with a recipe: the planned meal is exchanged through the cascade
 * (learned as a swap, remembered as replacement). `eat`: it was/is eaten now –
 * marked eaten; an already eaten meal keeps ONE log entry (synced).
 */
export function replaceWithRecipe(mealId: string, recipeId: string, servings: number, eat: boolean): boolean {
  const meal = getState().plannedMeals.find((m) => m.id === mealId);
  if (!meal || meal.status === 'skipped') return false;
  // Already done (e.g. a second tap before the sheet closed): nothing changes, no second toast.
  if (meal.recipeId === recipeId && (!eat || meal.status === 'eaten')) return false;
  if (!applyChange({ type: 'replaceMeal', mealId, recipeId, servings }).ok) return false;
  if (eat) markEaten(mealId);
  return true;
}

/** Remembers a looked-up product locally (no network next time). Keeps an existing catalog link unless one is given. */
export function saveProduct(product: Product): void {
  update((s) => {
    s.products ??= {};
    const known = s.products[product.barcode];
    s.products[product.barcode] = { ...product, foodId: 'foodId' in product ? product.foodId : known?.foodId };
  });
}

/** A generic food from the extended database (FoodData Central). */
export function logDbFood(date: ISODate, slot: MealSlot, food: DbFood, grams: number, opts: LogOptions = {}): boolean {
  if (!(grams > 0)) return false;
  return logEntry(date, slot, dbFoodEntry(food, grams), opts);
}

// ---------- Own dishes ("Meine Gerichte") ----------

/**
 * Creates or updates an own dish. Already logged entries are snapshots and
 * stay exactly as they were. Returns the dish id, or undefined if invalid.
 */
export function saveDish(draft: DishDraft, id?: string): string | undefined {
  if (Object.keys(validateDish(draft)).length) return undefined;
  const dishId = id ?? newId();
  update((s) => {
    s.customDishes ??= {};
    const now = new Date().toISOString();
    const before = s.customDishes[dishId];
    s.customDishes[dishId] = {
      id: dishId,
      name: draft.name.trim(),
      portions: draft.portions,
      ingredients: draft.ingredients.map((i) => ({ ...i })),
      ...(draft.slots?.length ? { slots: [...draft.slots] } : {}),
      ...(draft.prepMin ? { prepMin: draft.prepMin } : {}),
      createdAt: before?.createdAt ?? now,
      updatedAt: now,
    };
  });
  return dishId;
}

/**
 * Removes the dish – logged entries keep their own values. If meals still
 * refer to it (planned via the planner), it is archived instead: past days keep
 * their plan, open future meals of it are removed, it is never suggested again.
 */
export function deleteDish(id: string): boolean {
  if (!getState().customDishes?.[id]) return false;
  const recipeId = `dish:${id}`;
  const t = today();
  update((s) => {
    s.plannedMeals = s.plannedMeals.filter((m) => !(m.recipeId === recipeId && m.status === 'planned' && m.date >= t));
    if (s.plannedMeals.some((m) => m.recipeId === recipeId)) s.customDishes[id] = { ...s.customDishes[id]!, archived: true };
    else delete s.customDishes[id];
  });
  return true;
}

/** Logs `portions` of an own dish as ONE entry (snapshot of the dish now). */
export function logDish(date: ISODate, slot: MealSlot, dishId: string, portions: number, opts: LogOptions = {}): boolean {
  const dish = getState().customDishes?.[dishId];
  if (!dish || !(portions > 0)) return false;
  return logEntry(date, slot, dishEntry(dish, portions), opts);
}

// ---------- Own products ("Meine Produkte") ----------

export interface ProductPatch {
  name?: string;
  brand?: string;
  /** Pack size in the product's unit (g/ml); null removes it. */
  packageSize?: number | null;
  /** CHF for the whole pack (packageSize) – null removes the price. */
  packPriceChf?: number | null;
  /** Corrected values per 100 g/ml – a missing key means unknown (never 0). Marks the product as corrected. */
  per100?: Product['per100'];
  micros100?: Product['micros100'];
  allergens?: Product['allergens'];
  diet?: Product['diet'];
}

/**
 * Edits the user's data of a product: name, brand, pack size, price in CHF,
 * and – as a correction – nutrients, allergens and diet. The origin stays in
 * `source`; a nutrient correction sets `nutrientsEdited`. Own dishes with
 * this product follow the correction; log entries are snapshots and do not change.
 */
export function updateProduct(barcode: string, patch: ProductPatch): boolean {
  const p = getState().products?.[barcode];
  if (!p) return false;
  update((s) => {
    const d = { ...s.products[barcode]! };
    if (patch.name !== undefined && patch.name.trim()) d.name = patch.name.trim();
    if (patch.brand !== undefined) {
      if (patch.brand.trim()) d.brand = patch.brand.trim();
      else delete d.brand;
    }
    if (patch.packageSize === null) delete d.packageSize;
    else if (patch.packageSize !== undefined && patch.packageSize > 0) d.packageSize = patch.packageSize;
    if (patch.packPriceChf === null) delete d.price;
    else if (patch.packPriceChf !== undefined && patch.packPriceChf > 0 && d.packageSize) d.price = { chf: Math.round(patch.packPriceChf * 100) / 100, amount: d.packageSize, at: new Date().toISOString() };
    if (patch.allergens) {
      if (patch.allergens.length) d.allergens = [...patch.allergens];
      else delete d.allergens;
    }
    if (patch.diet) {
      if (Object.keys(patch.diet).length) d.diet = { ...patch.diet };
      else delete d.diet;
    }
    const nutrientsChanged = (patch.per100 && JSON.stringify(patch.per100) !== JSON.stringify(d.per100)) || (patch.micros100 && JSON.stringify(patch.micros100) !== JSON.stringify(d.micros100));
    if (nutrientsChanged) {
      if (patch.per100) d.per100 = { ...patch.per100 };
      if (patch.micros100) d.micros100 = { ...patch.micros100 };
      d.nutrientsEdited = new Date().toISOString();
      // Own dishes use the corrected product from now on (logged entries keep their snapshot).
      for (const dish of Object.values(s.customDishes ?? {}))
        for (const ing of dish.ingredients)
          if (ing.source === 'product' && ing.ref === barcode) {
            ing.per100 = { ...d.per100 };
            ing.micros100 = { ...d.micros100 };
          }
    }
    s.products[barcode] = d;
  });
  return true;
}

/** Removes a product from "Meine Produkte" – eaten entries and own dishes keep their values. */
export function deleteProduct(barcode: string): boolean {
  if (!getState().products?.[barcode]) return false;
  update((s) => {
    delete s.products[barcode];
  });
  return true;
}

/** A product the user creates by hand (no barcode): values per 100 g/ml from the pack. Returns its key. */
export function createProduct(input: Omit<Product, 'barcode' | 'source' | 'fetchedAt'>): string {
  const key = `manual-${newId()}`;
  update((s) => {
    s.products ??= {};
    s.products[key] = { ...input, barcode: key, source: 'manual', fetchedAt: new Date().toISOString() };
  });
  return key;
}

export function removeLogEntry(id: string): void {
  update((s) => {
    const entry = s.logEntries.find((e) => e.id === id);
    if (entry?.plannedMealId) {
      const meal = s.plannedMeals.find((m) => m.id === entry.plannedMealId);
      if (meal) meal.status = 'planned';
    }
    // Deleting takes the taste evidence back (planned meals: see unmarkEaten).
    if (entry && !entry.plannedMealId && entry.foodId && getFood(entry.foodId)) {
      recordEvent(s, { type: 'food_unlogged', foodId: entry.foodId }, new Date().toISOString());
    }
    s.logEntries = s.logEntries.filter((e) => e.id !== id);
  });
}

/**
 * A planner suggestion was eaten. If the slot had a planned meal, it is
 * exchanged (a real swap – learned like one) and marked eaten; otherwise the
 * suggestion is added as eaten. Both go through the cascade.
 */
export function eatSuggestion(date: ISODate, slot: MealSlot, recipeId: string, servings: number, replaceMealId?: string, id?: string): boolean {
  if (replaceMealId) return replaceWithRecipe(replaceMealId, recipeId, servings, true);
  // A fixed id per sheet: a second tap is refused by the cascade (no second meal, no double kcal).
  return applyChange({ type: 'addMeal', date, slot, recipeId, servings, eaten: true, ...(id ? { id } : {}) }).ok;
}

/**
 * "Wie gestern": logs again what was eaten in `slot` on `fromDate`. If today's
 * slot still has a planned meal, the first item takes its place (the plan
 * meal is replaced, never counted twice); the rest is logged alongside.
 * Returns false if there was nothing to repeat. Callers wrap it in ONE undo.
 */
export function repeatSlot(fromDate: ISODate, toDate: ISODate, slot: MealSlot): boolean {
  const { items } = slotRepeat(getState(), fromDate, slot);
  if (!items.length) return false;
  let planned = getState().plannedMeals.find((m) => m.date === toDate && m.slot === slot && m.status === 'planned');
  for (const item of items) {
    if (item.kind === 'recipe') eatSuggestion(toDate, slot, item.recipeId, item.servings, planned?.id);
    else if (planned) replaceWithEntry(planned.id, item.content);
    else logEntry(toDate, slot, item.content);
    planned = undefined;
  }
  return true;
}

// ---------- Water ----------

export function addWaterMl(date: ISODate, ml: number): void {
  update((s) => {
    addWater(s, date, ml);
    // A drink today pauses the reminders for a while (see WATER_REMINDER).
    if (ml > 0 && date === today()) s.coach.water = { ...waterReminderState(s, date), lastDrinkAt: new Date().toISOString() };
  });
}

/** "Später": no water reminder for WATER_REMINDER.gapMin minutes. */
export function snoozeWaterReminder(now: Date = new Date()): void {
  update((s) => {
    s.coach.water = { ...waterReminderState(s, today()), snoozedUntil: new Date(now.getTime() + WATER_REMINDER.gapMin * 60000).toISOString() };
  });
}

/** A reminder was delivered (notification) – spacing, daily limit and wording follow from it. */
export function markWaterReminderSent(now: Date = new Date()): void {
  update((s) => {
    const w = waterReminderState(s, today());
    s.coach.water = { ...w, sent: [...(w.sent ?? []), now.toISOString()] };
  });
}

export function setWaterReminders(mode: WaterReminderMode): void {
  update((s) => {
    if (s.nutritionProfile) s.nutritionProfile = { ...s.nutritionProfile, waterReminders: mode };
  });
}

/** Personal tracking value; undefined removes it. */
export function setWaterGoal(ml: number | undefined): void {
  update((s) => {
    if (s.nutritionProfile) s.nutritionProfile = { ...s.nutritionProfile, waterGoalMl: ml };
  });
}

// ---------- Training ----------

export function startWorkout(templateId: string, date: ISODate = today()): string | undefined {
  const template = findTemplate(templateId);
  return template ? startWorkoutFrom(template, date) : undefined;
}

/**
 * Starts a (possibly adapted, e.g. shortened) template. The check-in and the
 * adaptations the user accepted before starting are kept with the workout.
 */
export function startWorkoutFrom(template: WorkoutTemplate, date: ISODate = today(), opts: { checkIn?: SessionCheckIn; adaptations?: AppliedAdaptation[] } = {}): string {
  const s = getState();
  const running = s.workouts.find((w) => w.status === 'in_progress');
  if (running) return running.id;
  const checkIn = opts.checkIn && (opts.checkIn.minutes || opts.checkIn.energy || opts.checkIn.discomfort?.length) ? { checkIn: opts.checkIn } : {};
  const adaptations = opts.adaptations?.length ? { adaptations: opts.adaptations.map(({ kind, title, reason }) => ({ kind, title, reason })) } : {};
  const workout = { ...createWorkout(template, s.workouts, date), plannedId: plannedSessionFor(s, template.id, date), ...checkIn, ...adaptations };
  update((d) => {
    d.workouts.push(workout);
  });
  return workout.id;
}

/**
 * Which planned session a new workout fulfils: the open session of that day
 * (even if the user trains a different template), otherwise an earlier missed
 * session of the same template this week (catching up).
 */
function plannedSessionFor(s: AppState, templateId: string, date: ISODate): string | undefined {
  const open = activeWorkouts(s.training, s.workoutOverrides, s.workouts, weekStart(date), s.dayContexts).filter((p) => !p.completedWorkoutId);
  return (open.find((p) => p.date === date) ?? open.find((p) => p.date < date && p.template.id === templateId))?.id;
}

export function updateSet(workoutId: string, exerciseEntryId: string, setId: string, patch: Partial<WorkoutSet>): void {
  update((s) => {
    const ex = s.workouts.find((w) => w.id === workoutId)?.exercises.find((e) => e.id === exerciseEntryId);
    const set = ex?.sets.find((x) => x.id === setId);
    if (!set) return;
    Object.assign(set, patch);
    // Changing a prefilled value is a decision too: the suggestion was edited.
    if (ex?.prescription && !ex.prescription.decision && !set.done && ('weightKg' in patch || 'reps' in patch || 'durationMin' in patch)) ex.prescription.decision = 'edited';
  });
}

/** Marks a set done and carries its values into following sets that are still empty. */
export function completeSet(workoutId: string, exerciseEntryId: string, setId: string, done: boolean): void {
  update((s) => {
    const ex = s.workouts.find((w) => w.id === workoutId)?.exercises.find((e) => e.id === exerciseEntryId);
    const index = ex?.sets.findIndex((x) => x.id === setId) ?? -1;
    const set = ex?.sets[index];
    if (!ex || !set) return;
    set.done = done;
    if (!done) return;
    delete set.skipped;
    if (set.reps === null && set.durationMin === undefined) set.reps = ex.repMax;
    for (const next of ex.sets.slice(index + 1)) {
      if (next.done) continue;
      if (next.weightKg === null) next.weightKg = set.weightKg;
      if (next.reps === null) next.reps = set.reps;
      if (next.durationMin == null && set.durationMin != null) next.durationMin = set.durationMin;
    }
  });
}

export function addSet(workoutId: string, exerciseEntryId: string): void {
  update((s) => {
    const ex = s.workouts.find((w) => w.id === workoutId)?.exercises.find((e) => e.id === exerciseEntryId);
    if (!ex) return;
    const last = ex.sets[ex.sets.length - 1];
    ex.sets.push({
      id: newId(),
      weightKg: last?.weightKg ?? null,
      reps: last?.reps ?? null,
      done: false,
      type: 'working',
      ...(last?.durationMin !== undefined ? { durationMin: last.durationMin, distanceKm: null } : {}),
    });
    // A set more than planned is simply one more set – the plan snapshot stays as it was.
    ex.skipped = false;
  });
}

function sessionExercise(s: AppState, workoutId: string, exerciseEntryId: string): WorkoutExercise | undefined {
  return s.workouts.find((w) => w.id === workoutId && w.status === 'in_progress')?.exercises.find((e) => e.id === exerciseEntryId);
}

/** Normal / warm-up / drop / failure / AMRAP – only the label of the set changes, its values stay. */
export function setSetType(workoutId: string, exerciseEntryId: string, setId: string, type: SetType): void {
  update((s) => {
    const set = sessionExercise(s, workoutId, exerciseEntryId)?.sets.find((x) => x.id === setId);
    if (set) set.type = type;
  });
}

/** Leave a set out on purpose (or take it back). A skipped set is never "done". */
export function skipSet(workoutId: string, exerciseEntryId: string, setId: string, skipped: boolean): void {
  update((s) => {
    const set = sessionExercise(s, workoutId, exerciseEntryId)?.sets.find((x) => x.id === setId);
    if (!set) return;
    set.skipped = skipped || undefined;
    if (skipped) set.done = false;
  });
}

/** Removes one set that is not done (the plan snapshot keeps the planned count). */
export function removeSet(workoutId: string, exerciseEntryId: string, setId: string): void {
  update((s) => {
    const ex = sessionExercise(s, workoutId, exerciseEntryId);
    if (!ex || ex.sets.length <= 1) return;
    ex.sets = ex.sets.filter((x) => x.id !== setId || x.done);
  });
}

/** Skip a whole exercise (or take it back): its open sets are marked skipped, done sets stay. */
export function skipExercise(workoutId: string, exerciseEntryId: string, skipped: boolean): void {
  update((s) => {
    const ex = sessionExercise(s, workoutId, exerciseEntryId);
    if (!ex) return;
    ex.skipped = skipped || undefined;
    for (const set of ex.sets) if (!set.done) set.skipped = skipped || undefined;
  });
}

/**
 * Swap an exercise in the running session. The plan snapshot keeps the
 * planned exercise; the new one gets fresh sets (same count and range),
 * prefilled from ITS OWN history. Done sets of the old exercise are kept as
 * their own (extra) entry, so nothing that happened is lost.
 */
export function replaceExercise(workoutId: string, exerciseEntryId: string, newExerciseId: string): void {
  update((s) => {
    const w = s.workouts.find((x) => x.id === workoutId && x.status === 'in_progress');
    const index = w?.exercises.findIndex((e) => e.id === exerciseEntryId) ?? -1;
    const old = w?.exercises[index];
    if (!w || !old || old.exerciseId === newExerciseId) return;
    const te: TemplateExercise = {
      exerciseId: newExerciseId,
      sets: Math.max(1, old.sets.filter((x) => !x.done).length || old.planned?.sets || old.sets.length),
      repMin: old.repMin,
      repMax: old.repMax,
      restSec: old.restSec,
      ...(old.planned?.durationMin ? { durationMin: old.planned.durationMin } : {}),
    };
    const fresh = workoutExercise(te, s.workouts, { date: w.date });
    const next: WorkoutExercise = {
      ...fresh,
      ...(old.planned ? { planned: old.planned } : { extra: true }),
      replacedFrom: old.replacedFrom ?? old.exerciseId,
      ...(old.supersetGroup ? { supersetGroup: old.supersetGroup } : {}),
    };
    delete (next as Partial<WorkoutExercise>).skipped;
    const doneSets = old.sets.filter((x) => x.done);
    const kept: WorkoutExercise[] = doneSets.length ? [{ ...old, planned: undefined, extra: true, sets: doneSets }] : [];
    w.exercises.splice(index, 1, ...kept, next);
  });
}

/** An exercise that was not planned – added at the end of the session. */
export function addExerciseToWorkout(workoutId: string, exerciseId: string, template?: Partial<TemplateExercise>): void {
  update((s) => {
    const w = s.workouts.find((x) => x.id === workoutId && x.status === 'in_progress');
    if (!w) return;
    const te: TemplateExercise = { exerciseId, sets: 3, repMin: 8, repMax: 12, restSec: 90, ...template };
    w.exercises.push(workoutExercise(te, s.workouts, { extra: true, date: w.date }));
  });
}

export function removeLastSet(workoutId: string, exerciseEntryId: string): void {
  update((s) => {
    const ex = s.workouts.find((w) => w.id === workoutId)?.exercises.find((e) => e.id === exerciseEntryId);
    if (ex && ex.sets.length > 1) ex.sets.pop();
  });
}

/**
 * The user's answer to a suggestion: "Übernehmen" keeps the prefilled values,
 * "Wie letztes Mal" puts last session's values into the open sets (the
 * suggestion is declined – the next suggestion learns from it). Editing a
 * value marks it as "edited".
 */
export function decidePrescription(workoutId: string, exerciseEntryId: string, decision: 'accepted' | 'declined'): void {
  update((s) => {
    const ex = sessionExercise(s, workoutId, exerciseEntryId);
    if (!ex?.prescription) return;
    ex.prescription.decision = decision;
    if (decision !== 'declined') return;
    const last = lastSetsFor(s.workouts, ex.exerciseId, workoutId);
    ex.sets.forEach((set, i) => {
      if (set.done || set.skipped) return;
      const prev = last?.[Math.min(i, last.length - 1)];
      if (!prev) return;
      set.weightKg = prev.weightKg;
      set.reps = prev.reps;
      if (prev.durationMin !== undefined) set.durationMin = prev.durationMin;
    });
  });
}

/** RPE 6–10 for a set (null removes it) – only what the user enters. */
export function setSetRpe(workoutId: string, exerciseEntryId: string, setId: string, rpe: number | null): void {
  update((s) => {
    const set = sessionExercise(s, workoutId, exerciseEntryId)?.sets.find((x) => x.id === setId);
    if (!set) return;
    if (rpe === null) delete set.rpe;
    else set.rpe = Math.min(10, Math.max(6, Math.round(rpe * 2) / 2));
  });
}

/** Completing a workout updates volume, personal records and data-based achievements – progress updates automatically. */
export function finishWorkout(workoutId: string, feedback?: WorkoutFeedback): void {
  update((s) => {
    const w = s.workouts.find((x) => x.id === workoutId);
    if (!w) return;
    if (feedback && (feedback.effort || feedback.discomfort?.length)) w.feedback = feedback;
    // Keep history clean: only sets that were actually done. A planned exercise
    // without a done set stays as "ausgelassen" (its plan snapshot is kept) –
    // plan and reality both remain readable. Unplanned extras without a set go.
    w.exercises = w.exercises
      .map((ex) => {
        const sets = ex.sets.filter((set) => set.done && !set.skipped);
        return sets.length ? { ...ex, sets, skipped: undefined } : { ...ex, sets, skipped: true };
      })
      .filter((ex) => ex.sets.length > 0 || !!ex.planned);
    w.status = 'completed';
    w.endedAt = new Date().toISOString();
    recordEvent(s, { type: 'workout_completed', date: w.date, hour: new Date(w.startedAt).getHours() }, w.endedAt);
    w.volumeKg = Math.round(workoutVolume(w));
    w.records = detectRecords(w, s.workouts);
    w.achievements = workoutAchievements(w, s);
  });
}

export function discardWorkout(workoutId: string): void {
  update((s) => {
    s.workouts = s.workouts.filter((w) => w.id !== workoutId);
  });
}

// ---------- Shopping ----------

function shoppingWeek(s: AppState, week: ISODate) {
  s.shopping[week] ??= { purchased: {}, manual: [] };
  return s.shopping[week]!;
}

/**
 * Ticking off in the store = buying whole packages → credited to the pantry.
 * "Hab ich schon" = the pantry covers the week's need. Unticking reverts it.
 */
export function setShoppingStatus(week: ISODate, foodId: string, status: 'checked' | 'have' | null): void {
  if (status === 'checked') applyChange({ type: 'purchase', week, foodId });
  else if (status === 'have') applyChange({ type: 'haveAtHome', week, foodId });
  else if (getState().shopping[week]?.purchased[foodId]) applyChange({ type: 'undoPurchase', week, foodId });
  else applyChange({ type: 'notAtHome', week, foodId });
}

export function addManualItem(week: ISODate, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  update((s) => {
    shoppingWeek(s, week).manual.push({ id: newId(), name: trimmed, checked: false });
  });
}

export function toggleManualItem(week: ISODate, id: string): void {
  update((s) => {
    const item = shoppingWeek(s, week).manual.find((m) => m.id === id);
    if (item) item.checked = !item.checked;
  });
}

export function removeManualItem(week: ISODate, id: string): void {
  update((s) => {
    const w = shoppingWeek(s, week);
    w.manual = w.manual.filter((m) => m.id !== id);
  });
}

export function clearCheckedItems(week: ISODate): void {
  update((s) => {
    const w = shoppingWeek(s, week);
    w.manual = w.manual.filter((m) => !m.checked);
  });
}

// ---------- Body & goals ----------

export function addWeight(date: ISODate, kg: number): void {
  update((s) => {
    s.weights = s.weights.filter((w) => w.date !== date);
    s.weights.push({ id: newId(), date, kg: Math.round(kg * 10) / 10 });
  });
}

export function removeWeight(id: string): void {
  update((s) => {
    s.weights = s.weights.filter((w) => w.id !== id);
  });
}

/** Targets are versioned: a change applies from today, history keeps its old targets. */
export function setTargets(macros: Macros, method: 'formula' | 'manual'): void {
  const t = today();
  update((s) => {
    s.targets = s.targets.filter((x) => x.validFrom !== t);
    s.targets.push({ id: newId(), validFrom: t, method, ...macros });
  });
}

export function recalculateTargets(): Macros | undefined {
  const s = getState();
  if (!s.profile || !s.goal || !s.training) return undefined;
  const weight = currentWeight(s.weights) ?? s.goal.startWeightKg;
  const calc = calculateTargets(s.profile, s.goal.type, weight, s.training.weekdays.length, targetOptionsFor(s));
  const macros = { kcal: calc.kcal, protein: calc.protein, carbs: calc.carbs, fat: calc.fat };
  setTargets(macros, 'formula');
  return macros;
}

export function updateGoal(patch: Partial<FitnessGoal>): void {
  update((s) => {
    if (s.goal) Object.assign(s.goal, patch);
  });
}

export function updateProfile(patch: Partial<Profile>): void {
  update((s) => {
    if (s.profile) Object.assign(s.profile, patch);
  });
}

export function updateNutritionProfile(patch: Partial<NutritionProfile>): void {
  update((s) => {
    if (s.nutritionProfile) Object.assign(s.nutritionProfile, patch);
  });
}

/** Program / days / equipment (as before: the setup is replaced). A new program starts its "Woche 1" today. */
export function updateTraining(setup: TrainingSetup, change?: { reason: 'coach'; why?: string }): void {
  update((s) => {
    ensurePlanBaseline(s);
    const prev = s.training;
    const changedProgram = !prev || prev.programId !== setup.programId;
    // The training profile (equipment, limitations, preferences …) stays; week overrides of the check-in are reset as before.
    const { weekOverrides: _overrides, ...kept } = prev ?? ({} as Partial<TrainingSetup>);
    s.training = {
      ...kept,
      ...setup,
      startedAt: setup.startedAt ?? (changedProgram ? today() : (prev?.startedAt ?? today())),
    } as TrainingSetup;
    // A new plan version only when program, days or sessions really changed.
    recordPlanVersion(s, change?.reason ?? (changedProgram ? 'program' : 'days'), today(), change?.why);
  });
}

/** Fields of the extended training profile – merged into the setup; the level follows from training age and skill. */
export type TrainingProfilePatch = Partial<Pick<TrainingSetup, 'trainingYears' | 'freeWeights' | 'sessionMinutes' | 'equipment' | 'equipmentItems' | 'limitations' | 'likedExercises' | 'dislikedExercises' | 'focus' | 'musclePriorities'>>;

export function updateTrainingProfile(patch: TrainingProfilePatch): void {
  update((s) => {
    if (!s.training) return;
    s.training = { ...s.training, ...patch };
    if (s.profile && ('trainingYears' in patch || 'freeWeights' in patch)) s.profile.experience = experienceFrom(s.training.trainingYears, s.training.freeWeights);
  });
}

/** "Mag ich" / "lieber nicht" / "nicht möglich" for an exercise – one state per exercise, null clears it. */
export function setExercisePreference(exerciseId: string, pref: 'like' | 'dislike' | 'exclude' | null): void {
  update((s) => {
    if (!s.training) return;
    const without = (list?: string[]) => (list ?? []).filter((id) => id !== exerciseId);
    const limitations = s.training.limitations ?? { areas: [], excludedExercises: [] };
    s.training.likedExercises = pref === 'like' ? [...without(s.training.likedExercises), exerciseId] : without(s.training.likedExercises);
    s.training.dislikedExercises = pref === 'dislike' ? [...without(s.training.dislikedExercises), exerciseId] : without(s.training.dislikedExercises);
    s.training.limitations = { ...limitations, excludedExercises: pref === 'exclude' ? [...without(limitations.excludedExercises), exerciseId] : without(limitations.excludedExercises) };
  });
}

/** A body measurement (body fat now). An estimate is stored as such and shown as a range. */
export function addMeasurement(entry: Omit<MeasurementEntry, 'id'>): void {
  if (!(entry.value > 0) || (entry.kind === 'body_fat' && (entry.value < 3 || entry.value > 60))) return;
  update((s) => {
    s.measurements ??= [];
    s.measurements = s.measurements.filter((m) => !(m.kind === entry.kind && m.date === entry.date));
    s.measurements.push({ ...entry, id: newId(), value: Math.round(entry.value * 10) / 10 });
  });
}

// ---------- Routines & own programs ----------

export interface RoutineDraft {
  name: string;
  focus?: string;
  exercises: TemplateExercise[];
}

/** A routine needs a name and at least one exercise; the values are clamped to sensible ranges. */
export function validRoutine(d: RoutineDraft): string | undefined {
  if (!d.name.trim()) return 'Bitte gib der Routine einen Namen.';
  if (!d.exercises.length) return 'Füge mindestens eine Übung hinzu.';
  return undefined;
}

const clampInt = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n || 0)));

/** Creates or updates an own routine. Returns its id (undefined if invalid). */
export function saveRoutine(draft: RoutineDraft, id?: string): string | undefined {
  if (validRoutine(draft)) return undefined;
  const now = new Date().toISOString();
  const routineId = id ?? `routine:${newId()}`;
  update((s) => {
    ensurePlanBaseline(s);
    const prev = s.routines[routineId];
    const exercises = draft.exercises.map((e) => {
      const repMin = clampInt(e.repMin, 0, 100);
      return {
        ...e,
        sets: clampInt(e.sets, 1, 10),
        repMin,
        repMax: Math.max(repMin, clampInt(e.repMax, 0, 100)),
        restSec: clampInt(e.restSec, 0, 600),
        ...(e.durationMin ? { durationMin: clampInt(e.durationMin, 1, 240) } : {}),
      };
    });
    s.routines[routineId] = {
      ...(prev ?? { createdAt: now }),
      id: routineId,
      name: draft.name.trim(),
      focus: draft.focus?.trim() || focusOf(exercises),
      exercises,
      updatedAt: now,
    } as Routine;
    // Only counts when the routine belongs to the active program.
    recordPlanVersion(s, 'sessions');
  });
  return routineId;
}

/** "5 Übungen · Brust, Schultern" – derived when the user gives no focus. */
function focusOf(exercises: TemplateExercise[]): string {
  return `${exercises.length} ${exercises.length === 1 ? 'Übung' : 'Übungen'}`;
}

/** Copies an own routine or a built-in session into a new own routine ("… (Kopie)"). */
export function duplicateRoutine(sourceId: string): string | undefined {
  const source = getState().routines[sourceId] ?? findTemplate(sourceId);
  if (!source) return undefined;
  const id = saveRoutine({ name: `${source.name} (Kopie)`, focus: source.focus, exercises: source.exercises.map((e) => ({ ...e })) });
  if (id && !sourceId.startsWith('routine:')) {
    update((s) => {
      s.routines[id]!.copiedFrom = sourceId;
    });
  }
  return id;
}

/**
 * Deletes an own routine. Workouts done with it keep their history (they
 * store their own copy); own programs simply no longer rotate it.
 */
export function deleteRoutine(id: string): boolean {
  if (!getState().routines[id]) return false;
  update((s) => {
    ensurePlanBaseline(s);
    delete s.routines[id];
    for (const p of Object.values(s.customPrograms)) p.routineIds = p.routineIds.filter((r) => r !== id);
    recordPlanVersion(s, 'sessions');
  });
  return true;
}

/** Own program: routines (own or built-in) that rotate on the training days. */
export function saveProgram(draft: { name: string; routineIds: string[]; weeks?: number }, id?: string): string | undefined {
  if (!draft.name.trim() || !draft.routineIds.length) return undefined;
  const programId = id ?? `program:${newId()}`;
  update((s) => {
    ensurePlanBaseline(s);
    s.customPrograms[programId] = {
      createdAt: s.customPrograms[programId]?.createdAt ?? new Date().toISOString(),
      id: programId,
      name: draft.name.trim(),
      routineIds: [...draft.routineIds],
      ...(draft.weeks ? { weeks: clampInt(draft.weeks, 1, 52) } : {}),
    };
    recordPlanVersion(s, 'sessions');
  });
  return programId;
}

/** The active program cannot be deleted (the week plan depends on it) – choose another one first. */
export function deleteProgram(id: string): boolean {
  const s = getState();
  if (!s.customPrograms[id] || s.training?.programId === id) return false;
  update((d) => {
    delete d.customPrograms[id];
  });
  return true;
}

/** Clears upcoming, not yet eaten meals – e.g. after the diet changed. */
export function removeFuturePlannedMeals(from: ISODate = today()): void {
  update((s) => {
    s.plannedMeals = s.plannedMeals.filter((m) => m.date < from || m.status !== 'planned');
  });
}

// ---------- Planner settings & personalization ----------

export function updatePlannerSettings(patch: Partial<AppState['plannerSettings']>): void {
  update((s) => {
    s.plannerSettings = { ...s.plannerSettings, ...patch };
  });
}

/** Forget everything learned (the user decides – transparency means control). */
export function resetLearning(): void {
  update((s) => {
    s.learning = { preferences: {} };
  });
}

// ---------- Day close ----------

/**
 * Freezes the targets of completed days. Called from an effect (app start,
 * returning to the app, midnight) – never while rendering. Idempotent.
 */
export function closeDays(): void {
  const s = getState();
  const next = closeCompletedDays(s, today());
  if (next !== s) commit(next);
}

// ---------- Week plan (cascade) ----------

/**
 * The single write path for changes to the week: the cascade updates the
 * sources of truth and recomputes dependent values (day targets, servings,
 * shopping). Callers keep a snapshot for undo (see lib/undo applyWithUndo).
 */
export function applyChange(change: WeekChange): CascadeResult {
  const result = applyWeekChange(getState(), change, new Date());
  if (result.ok) commit(result.state);
  return result;
}

// ---------- Adaptive engine ----------

/**
 * Executes an action the user accepted from a recommendation. Navigation
 * actions are handled by the UI. Returns false if nothing was changed.
 */
export function applyEngineAction(action: EngineAction): boolean {
  switch (action.type) {
    case 'add_meal':
      addPlannedMeal(action.date, action.slot, action.recipeId, action.servings);
      return true;
    case 'log_food':
      logFood(action.date, action.slot, action.foodId, action.grams);
      return true;
    case 'log_dish':
      return logDish(action.date, action.slot, action.dishId, action.portions);
    case 'swap_meal':
      // Accepting a suggestion is not a taste signal against the old meal.
      applyChange({ type: 'replaceMeal', mealId: action.mealId, recipeId: action.recipeId, servings: action.servings, learn: false });
      return true;
    case 'start_workout':
      startWorkoutFrom(action.template);
      return true;
    case 'set_targets':
      setTargets(action.macros, 'manual');
      return true;
    case 'set_program': {
      const setup = getState().training;
      if (!setup) return false;
      updateTraining({ ...setup, programId: action.programId, weekdays: action.weekdays, startedAt: undefined }, { reason: 'coach' });
      if (action.experience) {
        update((d) => {
          if (d.profile) d.profile.experience = action.experience!;
        });
      }
      return true;
    }
    case 'add_water':
      addWaterMl(action.date, action.ml);
      return true;
    case 'snooze_water':
      snoozeWaterReminder();
      return true;
    case 'open':
      return false;
  }
}

/**
 * The coach's memory: tips that were on screen today (once per topic and day)
 * and topics whose pattern resolved (their "gut umgesetzt" note was shown).
 * Shown on TOPIC_RULES.pauseAfterDays days while the pattern still holds → the topic pauses and
 * comes back later with another strategy.
 */
export function recordTopics(date: ISODate, shown: string[], resolved: string[]): void {
  const s = getState();
  const topics = s.coach.topics ?? {};
  const changes = shown.some((t) => topics[t]?.lastShown !== date || topics[t]?.status !== 'active') || resolved.some((t) => topics[t]?.status !== 'resolved');
  if (!changes) return;
  update((d) => {
    const all = (d.coach.topics ??= {});
    for (const t of shown) {
      const prev = all[t];
      const restart = !prev || prev.status !== 'active';
      const days = restart ? 1 : prev.lastShown === date ? prev.shownDays : prev.shownDays + 1;
      const kept = { ...(prev?.dismissed ? { dismissed: prev.dismissed } : {}) };
      all[t] =
        days >= TOPIC_RULES.pauseAfterDays
          ? { firstShown: prev?.firstShown ?? date, lastShown: date, shownDays: days, status: 'paused', since: date, variant: (prev?.variant ?? 0) + 1, ...kept }
          : { firstShown: restart ? date : prev.firstShown, lastShown: date, shownDays: days, status: 'active', ...(prev?.variant ? { variant: prev.variant } : {}), ...kept };
    }
    for (const t of resolved) {
      const prev = all[t];
      if (prev) all[t] = { ...prev, status: 'resolved', since: date };
    }
  });
}

/** "Dein gestriger Tag" read – it does not come back for that date. */
export function markReviewSeen(date: ISODate): void {
  update((s) => {
    s.coach.reviewSeen = { ...(s.coach.reviewSeen ?? {}), [date]: true };
  });
}

/** Active calories / steps of a day, entered by the user. Empty values remove the day. */
export function setActivity(date: ISODate, value: { activeKcal?: number; steps?: number }): void {
  update((s) => {
    s.activity ??= {};
    const activeKcal = value.activeKcal && value.activeKcal > 0 ? Math.min(5000, Math.round(value.activeKcal)) : undefined;
    const steps = value.steps && value.steps > 0 ? Math.min(100000, Math.round(value.steps)) : undefined;
    if (activeKcal === undefined && steps === undefined) delete s.activity[date];
    else s.activity[date] = { ...(activeKcal !== undefined ? { activeKcal } : {}), ...(steps !== undefined ? { steps } : {}), source: 'manual', updatedAt: new Date().toISOString() };
  });
}

/**
 * "Ausblenden": gone for today – and for a recurring tip (topic) a signal:
 * the topic pauses, comes back later with another strategy, and after being
 * hidden twice it rests for a month.
 */
export function dismissRecommendation(id: string, topic?: string): void {
  const t = today();
  update((s) => {
    if (topic) {
      const all = (s.coach.topics ??= {});
      const prev = all[topic];
      all[topic] = { firstShown: prev?.firstShown ?? t, lastShown: t, shownDays: prev?.shownDays ?? 1, status: 'paused', since: t, variant: (prev?.variant ?? 0) + 1, dismissed: (prev?.dismissed ?? 0) + 1 };
    }
    // Ids contain their date – old dismissals can be dropped.
    const keepFrom = addDays(t, -14);
    s.coach.dismissed = Object.fromEntries(Object.entries(s.coach.dismissed).filter(([, d]) => d >= keepFrom));
    s.coach.dismissed[id] = t;
  });
}

export function exportData(): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), app: 'LifeFit', data: getState() }, null, 2);
}
