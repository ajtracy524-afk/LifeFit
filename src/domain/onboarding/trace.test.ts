import { describe, expect, it } from 'vitest';
import { navyEstimate } from '../body';
import { hardExclusionsOf, isExcluded } from '../catalogTags';
import { getFood } from '../../data/foods';
import type { NutritionProfile, PlannerSettings, TrainingSetup } from '../types';
import { isNumberFree } from '../numberFree';
import { emptyState } from '../../store/persistence';
import { stepsFor } from './flow';
import { nutritionProfileFrom, plannerSettingsFrom } from './food';
import { defaultCoreSetup, emptyOnboarding } from './migrate';
import { summaryOf } from './summary';
import { trainingSetupFrom } from './training';
import type { AnswerGroup, OnboardingProfile } from './types';

/**
 * Prompt 9 – traceability: every field of the OnboardingProfile changes
 * something the app uses. One case per field (docs/ONBOARDING.md links here);
 * the visible effect is covered by the app, persona and edge case tests.
 */

const TODAY = '2026-10-05';
const AT = '2026-10-05T08:00:00Z';

type Value<G extends AnswerGroup, K extends keyof OnboardingProfile[G]> = OnboardingProfile[G][K] extends { value: infer T } | undefined ? T : never;

/** A profile with the given answers (source 'user'). */
function answers(...set: Array<[AnswerGroup, string, unknown]>): OnboardingProfile {
  const p = emptyOnboarding();
  for (const [group, key, value] of set) (p[group] as Record<string, unknown>)[key] = { value, source: 'user', updatedAt: AT };
  return p;
}
const a = <G extends AnswerGroup, K extends keyof OnboardingProfile[G] & string>(group: G, key: K, value: Value<G, K>): [AnswerGroup, string, unknown] => [group, key, value];

const BODY = [a('body', 'sex', 'male'), a('body', 'birthYear', 1991), a('body', 'weightKg', 80), a('body', 'heightCm', 180)] as const;
const setup = (...set: Array<[AnswerGroup, string, unknown]>) => defaultCoreSetup(answers(...BODY, ...set), TODAY, AT);
const BASE_NP: NutritionProfile = { diet: 'omnivore', excluded: [], slots: ['breakfast', 'lunch', 'dinner'] };
const np = (...set: Array<[AnswerGroup, string, unknown]>) => nutritionProfileFrom(answers(...set).food, BASE_NP);
const BASE_PS = { priority: 'balanced' } as PlannerSettings;
const ps = (...set: Array<[AnswerGroup, string, unknown]>) => plannerSettingsFrom(answers(...set).food, BASE_PS);
const BASE_T: TrainingSetup = { programId: 'full-body', weekdays: [0, 2, 4] };
const ts = (...set: Array<[AnswerGroup, string, unknown]>) => trainingSetupFrom(answers(...set).training, BASE_T);

describe('area A – body', () => {
  it('body.weightKg → weight log and daily target', () => {
    expect(setup().weightKg).toBe(80);
    // Same goal for both (with 100 kg the recommendation would be fat loss).
    const maintain = a('goal', 'type', 'maintain');
    expect(defaultCoreSetup(answers(...BODY.slice(0, 2), a('body', 'weightKg', 100), BODY[3], maintain), TODAY, AT).target.kcal).toBeGreaterThan(setup(maintain).target.kcal);
  });
  it('body.heightCm → profile.heightCm (energy, BMI)', () => {
    expect(setup().profile.heightCm).toBe(180);
  });
  it('body.birthYear → profile.age (energy, safety rules under 18)', () => {
    expect(setup().profile.age).toBe(35);
  });
  it('body.sex → profile.sex (energy formula, pregnancy question)', () => {
    const female = defaultCoreSetup(answers(a('body', 'sex', 'female'), ...BODY.slice(1)), TODAY, AT);
    expect(female.profile.sex).toBe('female');
    expect(female.target.kcal).toBeLessThan(setup().target.kcal);
    expect(stepsFor('full', { sex: 'male' }).map((s) => s.id)).not.toContain('pregnancy');
  });
  it('body.trainingExperience → training level (profile.experience) and goal recommendation', () => {
    expect(setup(a('body', 'trainingExperience', 'never')).profile.experience).toBe('beginner');
    expect(setup(a('body', 'trainingExperience', 'gt5')).profile.experience).toBe('advanced');
  });
  it('body.trainingPaused → goal recommendation (beginner-like), asks for the pause length', () => {
    const goals = (paused: boolean) =>
      [12, 16, 20, 24, 28].map((percent) => setup(a('body', 'trainingExperience', '3to5'), a('body', 'trainingPaused', paused), a('body', 'bodyFat', { method: 'measured', percent, range: [percent - 3, percent + 3] })).goal.type);
    expect(goals(true)).not.toEqual(goals(false));
  });
  it('body.activity → profile.activity and daily target', () => {
    expect(setup(a('body', 'activity', 'active')).profile.activity).toBe('active');
    expect(setup(a('body', 'activity', 'active')).target.kcal).toBeGreaterThan(setup(a('body', 'activity', 'sedentary')).target.kcal);
  });
  it('body.waistCm → WHtR on "Dein Plan" and the goal recommendation', () => {
    const p = answers(...BODY, a('body', 'waistCm', 102));
    expect(summaryCardLines(p, 'body')).toMatch(/WHtR ca\. 0,56–0,58/);
  });
  it('body.neckCm / body.hipCm → Navy body fat estimate (stored as body.bodyFat)', () => {
    const male = navyEstimate('male', { heightCm: 180, waistCm: 90, neckCm: 38 });
    const thicker = navyEstimate('male', { heightCm: 180, waistCm: 90, neckCm: 42 });
    expect(male!.percent).toBeGreaterThan(thicker!.percent);
    const withHip = navyEstimate('female', { heightCm: 168, waistCm: 75, neckCm: 33, hipCm: 100 });
    const widerHip = navyEstimate('female', { heightCm: 168, waistCm: 75, neckCm: 33, hipCm: 110 });
    expect(widerHip!.percent).toBeGreaterThan(withHip!.percent);
  });
  it('body.bodyFat → measurement, energy formula, protein reference, level', () => {
    const lean = setup(a('body', 'bodyFat', { method: 'measured', percent: 12, range: [9, 15] }));
    expect(lean.bodyFat).toEqual({ value: 12, method: 'measured' });
    expect(lean.target.kcal).not.toBe(setup().target.kcal);
  });
});

describe('area A – health and goal', () => {
  it('health.pregnancy → goal locked to "Halten", no deficit', () => {
    const p = defaultCoreSetup(answers(a('body', 'sex', 'female'), ...BODY.slice(1), a('health', 'pregnancy', 'pregnant'), a('goal', 'type', 'fat_loss')), TODAY, AT);
    expect(p.goal.type).toBe('maintain');
  });
  it('health.numberFree → portions instead of numbers ("Dein Plan", Heute, Ernährung)', () => {
    const p = answers(...BODY, a('health', 'numberFree', true));
    expect(summaryCardLines(p, 'energy')).not.toContain('kcal');
    expect(isNumberFree({ onboarding: p })).toBe(true);
  });
  it('goal.type → goal and target', () => {
    expect(setup(a('goal', 'type', 'fat_loss')).goal.type).toBe('fat_loss');
    expect(setup(a('goal', 'type', 'fat_loss')).target.kcal).toBeLessThan(setup(a('goal', 'type', 'muscle_gain')).target.kcal);
  });
  it('goal.pace → size of the deficit / surplus', () => {
    expect(setup(a('goal', 'type', 'fat_loss'), a('goal', 'pace', 'brisk')).target.kcal).toBeLessThan(setup(a('goal', 'type', 'fat_loss'), a('goal', 'pace', 'gentle')).target.kcal);
  });
  it('goal.targetWeightKg → goal.targetWeightKg (Fortschritt, forecast)', () => {
    expect(setup(a('goal', 'type', 'fat_loss'), a('goal', 'targetWeightKg', 74)).goal.targetWeightKg).toBe(74);
  });
  it('goal.targetBodyFat → the goal weight when no target weight is given', () => {
    const s = setup(a('goal', 'type', 'fat_loss'), a('body', 'bodyFat', { method: 'measured', percent: 25, range: [22, 28] }), a('goal', 'targetBodyFat', 15));
    expect(s.goal.targetWeightKg).toBe(70.5); // 60 kg fat-free mass / 0.85
  });
});

describe('area B – food', () => {
  const excludes = (p: NutritionProfile, foodId: string) => isExcluded(getFood(foodId)!, hardExclusionsOf(p));
  it('food.diet → nutritionProfile.diet (hard filter)', () => {
    expect(excludes(np(a('food', 'diet', 'vegetarian')), 'chicken')).toBe(true);
  });
  it('food.allergens → hard filter', () => {
    expect(excludes(np(a('food', 'allergens', ['peanuts'])), 'peanut-butter')).toBe(true);
  });
  it('food.tracesOk → traces of a declared allergen are allowed', () => {
    expect(np(a('food', 'allergens', ['tree_nuts']), a('food', 'tracesOk', ['tree_nuts'])).tracesOk).toEqual(['tree_nuts']);
    expect(np(a('food', 'tracesOk', ['tree_nuts'])).tracesOk).toBeUndefined(); // only for declared allergens
  });
  it('food.fermentationAlcoholOk → soy sauce / vinegar stay with "kein Alkohol"', () => {
    const strict = np(a('food', 'exclusions', ['alcohol']));
    const ok = np(a('food', 'exclusions', ['alcohol']), a('food', 'fermentationAlcoholOk', true));
    expect(excludes(strict, 'soy-sauce')).toBe(true);
    expect(excludes(ok, 'soy-sauce')).toBe(false);
  });
  it('food.intolerances → hard filter (lactose with the lactose-free swap)', () => {
    expect(np(a('food', 'intolerances', ['lactose'])).intolerances).toEqual(['lactose']);
  });
  it('food.exclusions → no pork / no alcohol', () => {
    expect(np(a('food', 'exclusions', ['pork', 'alcohol']))).toMatchObject({ noPork: true, noAlcohol: true });
  });
  it('food.customExclusions → catalog foods excluded, the rest kept as text for products', () => {
    const p = np(a('food', 'customExclusions', ['Avocado', 'Koriander']));
    expect(p.excludedFoods).toEqual(['avocado']);
    expect(p.excludedText).toEqual(['Koriander']);
    expect(excludes(p, 'avocado')).toBe(true);
  });
  it('food.preferences → liked foods preferred, disliked ones avoided by the planner', () => {
    expect(np(a('food', 'preferences', { chicken: 'like', tuna: 'dislike' }))).toMatchObject({ likedFoods: ['chicken'], dislikedFoods: ['tuna'] });
  });
  it('food.meals → the planned meals of the day', () => {
    expect(np(a('food', 'meals', ['dinner', 'breakfast', 'snack'])).slots).toEqual(['breakfast', 'snack', 'dinner']);
  });
  it('food.cookingTime → maximum cooking time per day', () => {
    expect(ps(a('food', 'cookingTime', { weekday: '15', weekend: 'any' })).cookingTime).toEqual({ weekday: '15', weekend: 'any' });
  });
  it('food.mealPrep → meal-prep bundling in the planner', async () => {
    const { mealPrepEnabled } = await import('../week');
    expect(mealPrepEnabled({ onboarding: answers(a('food', 'mealPrep', true)) })).toBe(true);
    expect(mealPrepEnabled({ onboarding: answers(a('food', 'mealPrep', false)) })).toBe(false);
  });
  it('food.householdSize → shopping quantities', () => {
    expect(ps(a('food', 'householdSize', 3)).householdSize).toBe(3);
  });
  it('food.budget → the save priority of the planner', () => {
    expect(ps(a('food', 'budget', 'low')).priority).toBe('save');
  });
  it('food.weekTemplate → home / to go / out / skip per meal', () => {
    expect(np(a('food', 'weekTemplate', { 0: { lunch: { kind: 'out' } } })).weekTemplate).toEqual({ 0: { lunch: { kind: 'out' } } });
  });
});

describe('area C – training', () => {
  it('training.level → profile.experience (plan, volume, progression)', () => {
    expect(setup(a('training', 'level', 'advanced')).profile.experience).toBe('advanced');
  });
  it('training.workingWeights → start weights of the first session', () => {
    expect(ts(a('training', 'workingWeights', { 'bench-press': { kg: 60, reps: 8 } })).workingWeights).toEqual({ 'bench-press': { kg: 60, reps: 8 } });
  });
  it('training.weekdays → training days (rotation, training surcharge)', () => {
    expect(ts(a('training', 'weekdays', [4, 0, 2, 5])).weekdays).toEqual([0, 2, 4, 5]);
    expect(setup(a('training', 'weekdays', [0, 1, 2, 3, 4])).target.kcal).toBeGreaterThan(setup(a('training', 'weekdays', [0, 3])).target.kcal);
  });
  it('training.sessionMinutes → session length (plan, surcharge)', () => {
    expect(ts(a('training', 'sessionMinutes', 45)).sessionMinutes).toBe(45);
  });
  it('training.places → equipment', () => {
    expect(ts(a('training', 'places', ['bodyweight'])).equipmentItems).not.toContain('barbell');
    expect(ts(a('training', 'places', ['gym'])).equipmentItems).toContain('barbell');
  });
  it('training.equipment (migrated) → equipment when no place is answered', () => {
    expect(ts(a('training', 'equipment', ['dumbbells', 'bench'])).equipmentItems).toEqual(['dumbbells', 'bench']);
  });
  it('training.pausedLong → one level lower', () => {
    expect(setup(a('body', 'trainingExperience', 'gt5'), a('training', 'pausedLong', true)).profile.experience).toBe('intermediate');
  });
  it('training.complaints → limitations (exercise choice by joint load)', () => {
    expect(ts(a('training', 'complaints', { areas: ['knee'], severity: { knee: 'mild' } })).limitations).toMatchObject({ areas: ['knee'], severity: { knee: 'mild' } });
  });
  it('training.cardio → cardio plan (cardio days, surcharge)', () => {
    expect(ts(a('training', 'cardio', { kind: 'zone2', types: ['cycling'] })).cardio).toEqual({ kind: 'zone2', types: ['cycling'] });
    expect(setup(a('training', 'cardio', { kind: 'zone2', types: ['cycling'] })).target.kcal).toBeGreaterThan(setup().target.kcal);
  });
  it('training.focusMuscles → muscle priorities (more volume)', () => {
    expect(ts(a('training', 'focusMuscles', ['shoulders', 'glutes', 'back'])).musclePriorities).toEqual(['shoulders', 'glutes']);
  });
  // training.plan and training.planDraft: src/store/planAdopt.test.ts, src/store/personas.test.ts (adopted on "Los geht's").
});

// notices.completeCard (the Heute card rests 14 days): summary.test.ts.

function summaryCardLines(p: OnboardingProfile, id: 'body' | 'energy'): string {
  return summaryOf({ ...emptyState(), onboarding: p }, TODAY)
    .find((c) => c.id === id)!
    .lines.join(' ');
}
