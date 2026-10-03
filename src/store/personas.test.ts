// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState, MealSlot } from '../domain/types';

/**
 * Prompt 9 – end to end on the domain level: answers → "Los geht's" → targets,
 * week plan, shopping list, training plan. The same store actions the
 * onboarding screens call; checked with the domain functions the app shows.
 */

const MONDAY = '2026-10-05';

async function load() {
  vi.resetModules();
  const store = await import('./store');
  const ob = await import('./onboardingActions');
  const actions = await import('./actions');
  const dates = await import('../domain/dates');
  const week = await import('../domain/week');
  const tags = await import('../domain/catalogTags');
  const recipes = await import('../data/recipes');
  const foods = await import('../data/foods');
  const exercises = await import('../data/exercises');
  const training = await import('../domain/training');
  const profileTraining = await import('../domain/trainingProfile');
  const onbTraining = await import('../domain/onboarding/training');
  const summary = await import('../domain/onboarding/summary');
  const planner = await import('../domain/planner');
  const nutrition = await import('../domain/nutrition');
  return { store, ob, actions, dates, week, tags, recipes, foods, exercises, training, profileTraining, onbTraining, summary, planner, nutrition };
}
type Ctx = Awaited<ReturnType<typeof load>>;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 5, 8, 0)); // Monday 08:00 – the whole week is planned
});
afterEach(() => vi.useRealTimers());

/** All foods of the planned meals this week, after the lactose swap (what is cooked). */
function plannedFoods(c: Ctx, s: AppState): string[] {
  const ex = c.tags.hardExclusionsOf(s.nutritionProfile);
  return c.week.weekMeals(s, MONDAY).flatMap((m) => c.recipes.getRecipe(m.recipeId)!.ingredients.map((i) => c.tags.usableFood(i.foodId, ex) ?? i.foodId));
}

/** The planned week respects every hard exclusion (diet, allergens, intolerances). */
function expectNoExclusions(c: Ctx, s: AppState) {
  const ex = c.tags.hardExclusionsOf(s.nutritionProfile);
  for (const m of c.week.weekMeals(s, MONDAY)) expect(c.tags.recipeAllowedBy(c.recipes.getRecipe(m.recipeId)!, ex), m.recipeId).toBe(true);
  for (const id of plannedFoods(c, s)) expect(c.tags.isExcluded(c.foods.getFood(id)!, ex), id).toBe(false);
}

/** No recipe and no purchase for the meals eaten out (E12). */
function expectNothingPlannedFor(c: Ctx, s: AppState, slot: MealSlot, weekdays: number[]) {
  const days = c.dates.weekDays(MONDAY);
  const meals = c.week.weekMeals(s, MONDAY);
  for (const d of weekdays) expect(meals.filter((m) => m.date === days[d] && m.slot === slot), `${slot} ${days[d]}`).toEqual([]);
}

/** The training plan: on the chosen days, within the minutes, with the equipment, without stressing the complaints. */
function expectTrainingFits(c: Ctx, s: AppState, o: { weekdays: number[]; minutes: number }) {
  const t = s.training!;
  expect(t.programId).toMatch(/^program:plan-/);
  expect([...t.weekdays].sort()).toEqual(o.weekdays);
  const allowed = c.profileTraining.availableEquipment(t);
  const areas = t.limitations?.areas ?? [];
  for (const w of c.training.resolveWorkouts(t, {}, s.workouts, MONDAY)) {
    expect(o.weekdays).toContain(c.dates.weekdayIndex(w.date));
    if (w.template.name === 'Mobilität' || w.template.name === 'Lockeres Cardio') continue;
    expect(c.training.estimateSeconds(w.template), w.template.name).toBeLessThanOrEqual(o.minutes * 60);
    for (const te of w.template.exercises) {
      if (allowed) expect(allowed, te.exerciseId).toContain(c.exercises.getExercise(te.exerciseId)!.equipment);
      expect(c.onbTraining.stressedAreas(te.exerciseId, areas, t.limitations), te.exerciseId).toEqual([]);
    }
  }
}

describe('persona 1: beginner, 28, 30 % body fat, vegetarian, nut allergy, lunch out Mo–Fr, 3 days at home with dumbbells, knee', () => {
  it('goal and macros, a week without exclusions, nothing bought for lunch, pantry deducted, a knee-friendly home plan', async () => {
    const c = await load();
    const { ob } = c;
    ob.startOnboarding('full');
    ob.setOnboardingAnswer('body', 'sex', 'female');
    ob.setOnboardingAnswer('body', 'birthYear', 1998);
    ob.setOnboardingAnswer('body', 'weightKg', 68);
    ob.setOnboardingAnswer('body', 'heightCm', 166);
    ob.setOnboardingAnswer('body', 'trainingExperience', 'never');
    ob.setOnboardingAnswer('body', 'activity', 'light');
    ob.setOnboardingAnswer('body', 'bodyFat', { method: 'visual', percent: 30, range: [25, 35] }, 'estimated');
    ob.setFoodAnswer('diet', 'vegetarian');
    ob.setFoodAnswer('allergens', ['peanuts', 'tree_nuts']);
    const out = { kind: 'out' } as const;
    ob.setFoodAnswer('weekTemplate', { 0: { lunch: out }, 1: { lunch: out }, 2: { lunch: out }, 3: { lunch: out }, 4: { lunch: out } });
    ob.setTrainingAnswer('weekdays', [0, 2, 4]);
    ob.setTrainingAnswer('sessionMinutes', 45);
    ob.setTrainingAnswer('places', ['home_dumbbells']);
    ob.setTrainingAnswer('complaints', { areas: ['knee'], severity: { knee: 'clear' } });
    // What is at home (area B, pantry checklist).
    c.actions.applyChange({ type: 'setPantry', foodId: 'oats', quantityG: 500 });
    c.actions.applyChange({ type: 'setPantry', foodId: 'rice', quantityG: 1000 });
    ob.finishOnboarding();
    const s = c.store.getState();

    // Goal and macros: fat loss for a beginner with 30 % (or recomposition), plausible numbers.
    expect(['fat_loss', 'recomp']).toContain(s.goal!.type);
    const target = c.nutrition.targetForDate(s.targets, MONDAY)!;
    expect(target.kcal).toBeGreaterThanOrEqual(c.nutrition.calorieFloor(s.profile!, 68));
    expect(target.kcal).toBeLessThan(2300);
    expect(target.protein / 68).toBeGreaterThanOrEqual(1.2);
    expect(target.protein / 68).toBeLessThanOrEqual(2.2);
    expect(s.profile).toMatchObject({ sex: 'female', age: 28, heightCm: 166, experience: 'beginner' });

    // Week plan: vegetarian, no peanuts / tree nuts, lunch Mo–Fr eaten out.
    expect(c.week.weekMeals(s, MONDAY).length).toBeGreaterThan(10);
    expectNoExclusions(c, s);
    for (const id of plannedFoods(c, s)) expect(c.foods.getFood(id)!.tags?.kinds ?? [], id).not.toContain('meat');
    expectNothingPlannedFor(c, s, 'lunch', [0, 1, 2, 3, 4]);
    expect(c.week.weekMeals(s, MONDAY).some((m) => m.slot === 'lunch')).toBe(true); // the weekend is cooked

    // Shopping: what is at home is deducted.
    const list = c.week.weekShopping(s, MONDAY, MONDAY);
    const atHome = list.filter((i) => i.foodId === 'oats' || i.foodId === 'rice');
    expect(atHome.length).toBeGreaterThan(0);
    for (const i of atHome) expect(i.remainingG, i.foodId).toBeLessThan(i.neededG);
    // Without the pantry the same need is bought in full.
    for (const i of c.week.weekShopping({ ...s, pantry: {} }, MONDAY, MONDAY).filter((x) => x.foodId === 'oats' || x.foodId === 'rice')) expect(i.remainingG, i.foodId).toBe(i.neededG);

    // Training: Mo / Mi / Fr, 45 minutes, dumbbells only, nothing that stresses the knee.
    expectTrainingFits(c, s, { weekdays: [0, 2, 4], minutes: 45 });
  });
});

describe('persona 2: experienced, 35, 13 % body fat, eats everything, dislikes fish, meal prep, lunch to go, 5 days gym, focus shoulders', () => {
  it('goal and macros, no fish, portable lunches, meal prep on, a 5-day gym plan with more shoulder volume', async () => {
    const c = await load();
    const { ob } = c;
    const fish = c.foods.FOODS.filter((f) => f.tags?.kinds?.includes('fish')).map((f) => f.id);
    expect(fish.length).toBeGreaterThan(0);
    ob.startOnboarding('full');
    ob.setOnboardingAnswer('body', 'sex', 'male');
    ob.setOnboardingAnswer('body', 'birthYear', 1991);
    ob.setOnboardingAnswer('body', 'weightKg', 82);
    ob.setOnboardingAnswer('body', 'heightCm', 181);
    ob.setOnboardingAnswer('body', 'trainingExperience', '3to5');
    ob.setOnboardingAnswer('body', 'activity', 'moderate');
    ob.setOnboardingAnswer('body', 'bodyFat', { method: 'measured', percent: 13, range: [10, 16] });
    ob.setFoodAnswer('diet', 'omnivore');
    ob.setFoodAnswer('preferences', { ...Object.fromEntries(fish.map((id) => [id, 'dislike' as const])), chicken: 'like' });
    ob.setFoodAnswer('mealPrep', true);
    const togo = { kind: 'togo' } as const;
    ob.setFoodAnswer('weekTemplate', { 0: { lunch: togo }, 1: { lunch: togo }, 2: { lunch: togo }, 3: { lunch: togo }, 4: { lunch: togo } });
    ob.setTrainingAnswer('weekdays', [0, 1, 2, 3, 4]);
    ob.setTrainingAnswer('sessionMinutes', 75);
    ob.setTrainingAnswer('places', ['gym']);
    ob.setTrainingAnswer('focusMuscles', ['shoulders']);
    ob.finishOnboarding();
    const s = c.store.getState();

    // 13 % trained → building muscle; a moderate surplus.
    expect(s.goal!.type).toBe('muscle_gain');
    expect(s.profile!.experience).not.toBe('beginner');
    const target = c.nutrition.targetForDate(s.targets, MONDAY)!;
    expect(target.kcal).toBeGreaterThan(2400);
    expect(target.kcal).toBeLessThan(3800);
    expect(target.protein / 82).toBeGreaterThanOrEqual(1.6);
    expect(target.protein / 82).toBeLessThanOrEqual(2.2);

    // Week plan: no exclusions, the disliked fish is not planned, the liked chicken is.
    expectNoExclusions(c, s);
    const used = plannedFoods(c, s);
    for (const id of fish) expect(used, id).not.toContain(id);
    expect(used).toContain('chicken');
    // Lunch to go on workdays: portable recipes only; meal prep reaches the planner.
    const days = c.dates.weekDays(MONDAY);
    const lunches = c.week.weekMeals(s, MONDAY).filter((m) => m.slot === 'lunch' && days.indexOf(m.date) < 5);
    expect(lunches.length).toBeGreaterThan(0);
    for (const m of lunches) expect(c.planner.isPortable(c.recipes.getRecipe(m.recipeId)!), m.recipeId).toBe(true);
    expect(c.week.mealPrepEnabled(s)).toBe(true);

    // Training: 5 strength days in the gym, shoulders above the plan without focus.
    expectTrainingFits(c, s, { weekdays: [0, 1, 2, 3, 4], minutes: 75 });
    const draft = s.onboarding!.training.planDraft?.value ?? c.summary.currentPlanDraft(s);
    expect(draft.week.filter((d) => d.kind === 'strength')).toHaveLength(5);
    const { recommendPlan } = await import('../domain/training/recommendPlan');
    const input = c.summary.planInputOf(s);
    const { focus: _focus, ...withoutFocus } = input;
    expect(recommendPlan(input).volume.shoulders!).toBeGreaterThanOrEqual(recommendPlan(withoutFocus).volume.shoulders!);
    expect(input.focus).toEqual(['shoulders']);
  });
});

describe('persona 3: Schnellstart with the required minimum only', () => {
  it('a usable app with marked defaults, a week plan, shopping and a training plan; Heute asks for body fat first', async () => {
    const c = await load();
    const { ob } = c;
    ob.startOnboarding('quick');
    ob.setOnboardingAnswer('body', 'weightKg', 70);
    ob.setOnboardingAnswer('body', 'heightCm', 172);
    ob.setOnboardingAnswer('body', 'birthYear', 1994);
    ob.setOnboardingAnswer('body', 'sex', 'female');
    ob.finishOnboarding();
    const s = c.store.getState();

    expect(s.profile).toMatchObject({ age: 32, heightCm: 172, sex: 'female' });
    const target = c.nutrition.targetForDate(s.targets, MONDAY)!;
    expect(target.kcal).toBeGreaterThanOrEqual(c.nutrition.calorieFloor(s.profile!, 70));
    expect(target.kcal).toBeLessThan(2800);
    // Defaults are marked as such – never presented as the user's data.
    expect(s.onboarding!.body.activity!.source).toBe('default');
    expect(s.onboarding!.training.weekdays!.source).toBe('default');
    expect(s.onboarding!.food.diet!.source).toBe('default');
    expectNoExclusions(c, s);
    expect(c.week.weekMeals(s, MONDAY).length).toBeGreaterThan(10);
    expect(c.week.weekShopping(s, MONDAY, MONDAY).length).toBeGreaterThan(0);
    expectTrainingFits(c, s, { weekdays: s.training!.weekdays, minutes: 75 });
    expect(c.summary.missingHint(s, MONDAY)).toBe('bodyFat');
  });
});

describe('after the onboarding: answers of a re-opened step reach the core data', () => {
  it('body fat from the Heute card → measurement (and the target options); the target changes only on confirmation (E10)', async () => {
    const c = await load();
    c.ob.startOnboarding('quick');
    c.ob.setOnboardingAnswer('body', 'weightKg', 80);
    c.ob.setOnboardingAnswer('body', 'heightCm', 180);
    c.ob.setOnboardingAnswer('body', 'birthYear', 1991);
    c.ob.setOnboardingAnswer('body', 'sex', 'male');
    c.ob.finishOnboarding();
    const targets = structuredClone(c.store.getState().targets);
    expect(c.summary.missingHint(c.store.getState(), MONDAY)).toBe('bodyFat');

    c.ob.openOnboardingStep('A', 'bodyFat');
    expect(c.store.getState().onboarding!.progress).toMatchObject({ step: 'bodyFat', active: true });
    c.ob.setOnboardingAnswer('body', 'bodyFat', { method: 'measured', percent: 14, range: [11, 17] });
    c.ob.setOnboardingAnswer('body', 'activity', 'active');
    c.ob.setOnboardingAnswer('body', 'weightKg', 81);
    const s = c.store.getState();
    expect(s.measurements!.at(-1)).toMatchObject({ kind: 'body_fat', value: 14, method: 'measured', date: MONDAY });
    expect(s.profile!.activity).toBe('active');
    expect(s.weights.at(-1)).toMatchObject({ date: MONDAY, kg: 81 });
    expect(s.targets).toEqual(targets); // nothing without confirmation
    const { targetOptionsFor } = await import('../domain/body');
    expect(targetOptionsFor(s).bodyFat).toMatchObject({ percent: 14 });
  });
});
