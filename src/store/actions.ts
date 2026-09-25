/**
 * All state changes live here. Screens call these functions; the cross-domain
 * rules (plan → log, workout → progress) are enforced in one place.
 */
import { getFood } from '../data/foods';
import { findTemplate } from '../data/exercises';
import { addDays, today, weekDays, weekStart } from '../domain/dates';
import { calculateTargets, foodMacros, logFromMeal, roundMacros } from '../domain/nutrition';
import { seededRandom, suggestWeek } from '../domain/planner';
import { activeWorkouts, createWorkout, detectRecords, workoutVolume } from '../domain/training';
import { applyWeekChange, dayContextFor, dayTargetFor, pantryEstimate, type CascadeResult, type WeekChange } from '../domain/week';
import { currentWeight } from '../domain/progress';
import { newId } from '../lib/id';
import type {
  AppState,
  FitnessGoal,
  ISODate,
  Macros,
  MealSlot,
  NutritionProfile,
  PlannedMeal,
  Profile,
  TrainingSetup,
  WorkoutSet,
  WorkoutTemplate,
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
}

export function completeOnboarding(input: OnboardingResult): void {
  const t = today();
  update((s) => {
    s.profile = input.profile;
    s.goal = input.goal;
    s.nutritionProfile = input.nutritionProfile;
    s.training = input.training;
    // Existing data (e.g. from an incomplete earlier setup) is kept; for a new user these lists are empty.
    s.targets = [...s.targets.filter((x) => x.validFrom !== t), { id: newId(), validFrom: t, method: 'formula', ...input.target }];
    s.weights = [...s.weights.filter((w) => w.date !== t), { id: newId(), date: t, kg: input.weightKg }];
    const dates = remainingDays(weekStart(t));
    s.plannedMeals.push(
      ...suggestWeek({
        dates,
        slots: input.nutritionProfile.slots,
        target: input.target,
        targetFor: (d) => dayTargetFor(s, d),
        profile: input.nutritionProfile,
        existing: s.plannedMeals.filter((m) => dates.includes(m.date)),
        pantry: pantryEstimate(s),
        timeBudgetFor: (d) => dayContextFor(s, d).timeBudget,
        random: seededRandom(dates[0] ?? t),
      }),
    );
  });
}

function remainingDays(start: ISODate): ISODate[] {
  const t = today();
  return weekDays(start).filter((d) => d >= t);
}

// ---------- Meal planning ----------

/** Fills empty slots from today (or the week start, if later) to Sunday. Returns the number of meals added. */
export function suggestMealsForWeek(start: ISODate): number {
  const s = getState();
  const dates = remainingDays(start);
  const target = dayTargetFor(s, dates[0] ?? start);
  if (!target || !s.nutritionProfile || dates.length === 0) return 0;
  const added = suggestWeek({
    dates,
    slots: s.nutritionProfile.slots,
    target,
    targetFor: (d) => dayTargetFor(s, d),
    profile: s.nutritionProfile,
    // The whole week counts: earlier days are context for foods, variety and leftovers.
    existing: s.plannedMeals.filter((m) => m.date >= start && m.date <= addDays(start, 6)),
    // Ingredients at home are reused; same week + same plan → same suggestion.
    pantry: pantryEstimate(s),
    timeBudgetFor: (d) => dayContextFor(s, d).timeBudget,
    random: seededRandom(start),
  });
  update((d) => {
    d.plannedMeals.push(...added);
  });
  return added.length;
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
  });
}

export function unmarkEaten(mealId: string): void {
  update((s) => {
    const meal = s.plannedMeals.find((m) => m.id === mealId);
    if (meal) meal.status = 'planned';
    s.logEntries = s.logEntries.filter((e) => e.plannedMealId !== mealId);
  });
}

/** "Anders gegessen": the plan is kept as skipped, ingredients drop off the shopping list. */
export function skipMeal(mealId: string): void {
  update((s) => {
    const meal = s.plannedMeals.find((m) => m.id === mealId);
    if (meal) meal.status = 'skipped';
    s.logEntries = s.logEntries.filter((e) => e.plannedMealId !== mealId);
  });
}

// ---------- Free logging ----------

export function logFood(date: ISODate, slot: MealSlot, foodId: string, grams: number): void {
  const food = getFood(foodId);
  if (!food) return;
  update((s) => {
    s.logEntries.push({
      id: newId(),
      date,
      slot,
      loggedAt: new Date().toISOString(),
      name: food.name,
      foodId,
      grams,
      method: 'food',
      macros: roundMacros(foodMacros(food, grams)),
    });
  });
}

export function logQuick(date: ISODate, slot: MealSlot, name: string, macros: Macros): void {
  update((s) => {
    s.logEntries.push({
      id: newId(),
      date,
      slot,
      loggedAt: new Date().toISOString(),
      name: name.trim() || 'Schnelleintrag',
      method: 'quick',
      macros: roundMacros(macros),
    });
  });
}

export function removeLogEntry(id: string): void {
  update((s) => {
    const entry = s.logEntries.find((e) => e.id === id);
    if (entry?.plannedMealId) {
      const meal = s.plannedMeals.find((m) => m.id === entry.plannedMealId);
      if (meal) meal.status = 'planned';
    }
    s.logEntries = s.logEntries.filter((e) => e.id !== id);
  });
}

// ---------- Training ----------

export function startWorkout(templateId: string, date: ISODate = today()): string | undefined {
  const template = findTemplate(templateId);
  return template ? startWorkoutFrom(template, date) : undefined;
}

/** Starts a (possibly adapted, e.g. shortened) template. */
export function startWorkoutFrom(template: WorkoutTemplate, date: ISODate = today()): string {
  const s = getState();
  const running = s.workouts.find((w) => w.status === 'in_progress');
  if (running) return running.id;
  const workout = { ...createWorkout(template, s.workouts, date), plannedId: plannedSessionFor(s, template.id, date) };
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
    const set = s.workouts
      .find((w) => w.id === workoutId)
      ?.exercises.find((e) => e.id === exerciseEntryId)
      ?.sets.find((x) => x.id === setId);
    if (set) Object.assign(set, patch);
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
    if (set.reps === null) set.reps = ex.repMax;
    for (const next of ex.sets.slice(index + 1)) {
      if (next.done) continue;
      if (next.weightKg === null) next.weightKg = set.weightKg;
      if (next.reps === null) next.reps = set.reps;
    }
  });
}

export function addSet(workoutId: string, exerciseEntryId: string): void {
  update((s) => {
    const ex = s.workouts.find((w) => w.id === workoutId)?.exercises.find((e) => e.id === exerciseEntryId);
    if (!ex) return;
    const last = ex.sets[ex.sets.length - 1];
    ex.sets.push({ id: newId(), weightKg: last?.weightKg ?? null, reps: last?.reps ?? null, done: false, type: 'working' });
  });
}

export function removeLastSet(workoutId: string, exerciseEntryId: string): void {
  update((s) => {
    const ex = s.workouts.find((w) => w.id === workoutId)?.exercises.find((e) => e.id === exerciseEntryId);
    if (ex && ex.sets.length > 1) ex.sets.pop();
  });
}

/** Completing a workout updates volume and personal records – progress updates automatically. */
export function finishWorkout(workoutId: string): void {
  update((s) => {
    const w = s.workouts.find((x) => x.id === workoutId);
    if (!w) return;
    // Keep history clean: only sets that were actually done.
    w.exercises = w.exercises
      .map((ex) => ({ ...ex, sets: ex.sets.filter((set) => set.done) }))
      .filter((ex) => ex.sets.length > 0);
    w.status = 'completed';
    w.endedAt = new Date().toISOString();
    w.volumeKg = Math.round(workoutVolume(w));
    w.records = detectRecords(w, s.workouts);
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
  const calc = calculateTargets(s.profile, s.goal.type, weight, s.training.weekdays.length);
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

export function updateTraining(setup: TrainingSetup): void {
  update((s) => {
    s.training = setup;
  });
}

/** Clears upcoming, not yet eaten meals – e.g. after the diet changed. */
export function removeFuturePlannedMeals(from: ISODate = today()): void {
  update((s) => {
    s.plannedMeals = s.plannedMeals.filter((m) => m.date < from || m.status !== 'planned');
  });
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
    case 'swap_meal':
      swapMeal(action.mealId, action.recipeId, action.servings);
      return true;
    case 'start_workout':
      startWorkoutFrom(action.template);
      return true;
    case 'set_targets':
      setTargets(action.macros, 'manual');
      return true;
    case 'open':
      return false;
  }
}

export function dismissRecommendation(id: string): void {
  const t = today();
  update((s) => {
    // Ids contain their date – old dismissals can be dropped.
    const keepFrom = addDays(t, -14);
    s.coach.dismissed = Object.fromEntries(Object.entries(s.coach.dismissed).filter(([, d]) => d >= keepFrom));
    s.coach.dismissed[id] = t;
  });
}

export function exportData(): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), app: 'LifeFit', data: getState() }, null, 2);
}
