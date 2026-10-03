import { goalWeightOf, recommendGoal } from '../goal';
import { estimateTrainingLevel, trainingSetupFrom } from './training';
import { ffmi } from '../body';
import { nutritionProfileFrom } from './food';
import { calculateTargets } from '../nutrition';
import { slotsFor } from '../planner';
import { recommendProgram } from '../programs';
import { currentWeight } from '../progress';
import type { Allergen, AppState, FitnessGoal, Macros, NutritionProfile, Profile, TrainingSetup } from '../types';
import { DEFAULT_SETUP, MEASURED_ACCURACY, ONBOARDING_VERSION, VISUAL_ACCURACY } from '../constants';
import type { Field, FieldSource, Intolerance, LmivAllergen, OnboardingProfile } from './types';

/**
 * The OnboardingProfile is the record of answers; the core data (profile,
 * goal, nutritionProfile, training …) stays the one source the app computes
 * with. Older states – and everything the still active old onboarding writes
 * – are taken over here. Pure and idempotent: a second run changes nothing
 * and returns the same object (docs/ONBOARDING_PLAN.md, c / E5 / E8).
 */

/** Profile, goal, nutrition profile, training and a target exist – the regular app can run. */
export function isSetupComplete(state: Pick<AppState, 'profile' | 'goal' | 'nutritionProfile' | 'training' | 'targets'>): boolean {
  return !!(state.profile && state.goal && state.nutritionProfile && state.training && state.targets?.length > 0);
}

export function emptyOnboarding(): OnboardingProfile {
  return { version: ONBOARDING_VERSION, progress: { completed: {}, skipped: [] }, body: {}, health: {}, goal: {}, food: {}, training: {} };
}

/** A stored profile we can trust; anything else is re-derived from the core data (never fails the load). */
function isValid(p: unknown): p is OnboardingProfile {
  if (!p || typeof p !== 'object') return false;
  const o = p as Partial<OnboardingProfile>;
  return (
    o.version === ONBOARDING_VERSION &&
    !!o.progress &&
    typeof o.progress === 'object' &&
    Array.isArray(o.progress.skipped) &&
    typeof o.progress.completed === 'object' &&
    ['body', 'health', 'goal', 'food', 'training'].every((k) => !!(o as Record<string, unknown>)[k] && typeof (o as Record<string, unknown>)[k] === 'object')
  );
}

const field = <T>(value: T, source: FieldSource, at: string): Field<T> => ({ value, source, updatedAt: at });

/**
 * E5 – old exclusions, always the stricter reading:
 *   nuts    → peanuts + tree nuts (re-interpreted → 'migrated', confirmed once)
 *   lactose → lactose intolerance (same meaning → 'user')
 *   gluten, fish → the LMIV allergen (same meaning → 'user')
 */
export function migrateExclusions(excluded: Allergen[], at: string): { allergens?: Field<LmivAllergen[]>; intolerances?: Field<Intolerance[]> } {
  const allergens = new Set<LmivAllergen>();
  let reinterpreted = false;
  for (const a of excluded) {
    if (a === 'gluten') allergens.add('gluten');
    if (a === 'fish') allergens.add('fish');
    if (a === 'nuts') {
      allergens.add('peanuts');
      allergens.add('tree_nuts');
      reinterpreted = true;
    }
  }
  const intolerances: Intolerance[] = excluded.includes('lactose') ? ['lactose'] : [];
  return {
    ...(allergens.size ? { allergens: field([...allergens], reinterpreted ? 'migrated' : 'user', at) } : {}),
    ...(intolerances.length ? { intolerances: field(intolerances, 'user', at) } : {}),
  };
}

const experienceBucket = (years: number): NonNullable<OnboardingProfile['body']['trainingExperience']>['value'] =>
  years <= 0 ? 'lt1' : years <= 2 ? '1to2' : years <= 5 ? '3to5' : 'gt5';

/** Fills only what is missing – existing answers are never overwritten. */
function fillMissing(p: OnboardingProfile, state: AppState, at: string, year: number): OnboardingProfile {
  const { profile, goal, nutritionProfile, training } = state;
  const body = { ...p.body };
  const goalAnswers = { ...p.goal };
  const food = { ...p.food };
  const train = { ...p.training };
  let changed = false;
  const set = <G extends object, K extends keyof G>(group: G, key: K, value: G[K] | undefined) => {
    if (value === undefined || group[key] !== undefined) return;
    group[key] = value;
    changed = true;
  };

  const weight = currentWeight(state.weights ?? []) ?? goal?.startWeightKg;
  if (weight) set(body, 'weightKg', field(Math.round(weight * 10) / 10, 'user', at));
  if (profile) {
    set(body, 'heightCm', field(profile.heightCm, 'user', at));
    // Only the age is stored today – the birth year is derived (and therefore "geschätzt").
    set(body, 'birthYear', field(year - profile.age, 'estimated', at));
    set(body, 'sex', field(profile.sex, 'user', at));
    set(body, 'activity', field(profile.activity, 'user', at));
    set(train, 'level', field(profile.experience, 'user', at));
  }
  const fat = [...(state.measurements ?? [])].filter((m) => m.kind === 'body_fat').sort((a, b) => b.date.localeCompare(a.date))[0];
  if (fat) {
    const method = fat.method === 'measured' ? 'measured' : 'visual';
    const d = method === 'measured' ? MEASURED_ACCURACY : VISUAL_ACCURACY;
    set(body, 'bodyFat', field({ method, percent: fat.value, range: [Math.max(2, fat.value - d), fat.value + d] as [number, number] }, 'user', at));
  }
  if (goal) {
    set(goalAnswers, 'type', field(goal.type, 'user', at));
    if (goal.targetWeightKg) set(goalAnswers, 'targetWeightKg', field(goal.targetWeightKg, 'user', at));
  }
  if (nutritionProfile) {
    set(food, 'diet', field(nutritionProfile.diet, 'user', at));
    const exclusions = migrateExclusions(nutritionProfile.excluded ?? [], at);
    set(food, 'allergens', exclusions.allergens);
    set(food, 'intolerances', exclusions.intolerances);
    set(food, 'meals', field([...nutritionProfile.slots], 'user', at));
    if (nutritionProfile.dislikedFoods?.length) set(food, 'preferences', field(Object.fromEntries(nutritionProfile.dislikedFoods.map((id) => [id, 'dislike' as const])), 'user', at));
  }
  if (training) {
    set(train, 'weekdays', field([...training.weekdays], 'user', at));
    set(train, 'plan', field({ programId: training.programId, weekdays: [...training.weekdays] }, 'user', at));
    if (training.sessionMinutes) set(train, 'sessionMinutes', field(training.sessionMinutes, 'user', at));
    if (training.equipmentItems) set(train, 'equipment', field([...training.equipmentItems], 'user', at));
    if (training.limitations?.areas.length) set(train, 'complaints', field({ areas: [...training.limitations.areas] }, 'user', at));
    if (training.musclePriorities?.length) set(train, 'focusMuscles', field(training.musclePriorities.slice(0, 2), 'user', at));
    if (training.trainingYears !== undefined) set(body, 'trainingExperience', field(experienceBucket(training.trainingYears), training.trainingYears <= 0 ? 'estimated' : 'user', at));
  }

  // Finished with the old onboarding: no new run, only the "Neue Angaben ergänzen" card later (E8).
  // A paused new onboarding (it has a step) is not "finished" – it resumes from the profile.
  let progress = p.progress;
  if (isSetupComplete(state) && !progress.finishedAt && !progress.active && !progress.step) {
    const done = profile!.createdAt;
    progress = { ...progress, finishedAt: done, legacy: true, completed: { A: done, B: done, C: done, ...progress.completed } };
    changed = true;
  }
  // E18: existing users know the leftover logic – "Ich koche gern vor" stays on, confirmed once.
  // New users answer it in the onboarding (default no).
  if (progress.legacy) set(food, 'mealPrep', field(true, 'migrated', at));
  return changed ? { ...p, progress, body, goal: goalAnswers, food, training: train } : p;
}

/**
 * Brings `state.onboarding` up to date with the core data. Idempotent; the
 * same state object comes back when nothing changes. A damaged onboarding
 * record is replaced (the core data is never touched).
 */
export function migrateOnboarding(state: AppState, now: Date = new Date()): AppState {
  const current = isValid(state.onboarding) ? state.onboarding : undefined;
  const base = current ?? emptyOnboarding();
  const next = fillMissing(base, state, now.toISOString(), now.getFullYear());
  if (current && next === current) return state;
  return { ...state, onboarding: next };
}

/** Training level from the experience answer until Prompt 7 estimates it (years, break, FFMI). */
/** The level estimate of area C (Prompt 7): years, a long pause and – with known body fat – the normalised FFMI. */
export function levelOf(p: OnboardingProfile): Profile['experience'] {
  const b = p.body;
  const fat = b.bodyFat?.value;
  const ffmiNormalized = fat && b.weightKg && b.heightCm ? ffmi(b.weightKg.value, b.heightCm.value, fat.percent).normalized : undefined;
  return estimateTrainingLevel({
    sex: b.sex?.value ?? 'unspecified',
    ...(b.trainingExperience ? { years: b.trainingExperience.value } : {}),
    ...(p.training.pausedLong?.value ? { pausedLong: true } : {}),
    ...(ffmiNormalized !== undefined ? { ffmiNormalized } : {}),
  }).level;
}

export interface CoreSetup {
  profile: Profile;
  goal: FitnessGoal;
  nutritionProfile: NutritionProfile;
  training: TrainingSetup;
  target: Macros;
  weightKg: number;
  /** The body fat answer as a measurement (an estimate stays marked as such). */
  bodyFat?: { value: number; method: 'measured' | 'estimate' };
}

/**
 * The core setup for an app used without finishing the onboarding: the
 * answers given so far, sensible defaults for the rest (DEFAULT_SETUP). The
 * defaults are written back as source 'default' (see `defaultAnswers`), so
 * they are asked for again later – never presented as the user's data.
 */
export function defaultCoreSetup(p: OnboardingProfile, today: string, nowIso: string): CoreSetup {
  const D = DEFAULT_SETUP;
  const year = Number(today.slice(0, 4));
  const weightKg = p.body.weightKg?.value ?? D.weightKg;
  const sex = p.body.sex?.value ?? D.sex;
  const profile: Profile = {
    name: '',
    sex,
    age: p.body.birthYear ? year - p.body.birthYear.value : D.age,
    heightCm: p.body.heightCm?.value ?? D.heightCm,
    activity: p.body.activity?.value ?? D.activity,
    experience: p.training.level?.value ?? levelOf(p),
    createdAt: nowIso,
  };
  // Pregnancy / breastfeeding: only "Halten & Gesundheit" (E4). Without a chosen goal: the recommendation, not a fixed default.
  const pregnant = !!p.health.pregnancy && p.health.pregnancy.value !== 'no';
  const fat = p.body.bodyFat?.value;
  const rec = recommendGoal({
    sex,
    age: profile.age,
    ...(p.health.pregnancy ? { pregnancy: p.health.pregnancy.value } : {}),
    ...(fat ? { bodyFat: { percent: fat.percent, method: fat.method } } : {}),
    ...(p.body.weightKg ? { weightKg: p.body.weightKg.value } : {}),
    ...(p.body.heightCm ? { heightCm: p.body.heightCm.value } : {}),
    ...(p.body.waistCm ? { waistCm: p.body.waistCm.value } : {}),
    ...(p.body.trainingExperience ? { experience: p.body.trainingExperience.value } : {}),
    ...(p.body.trainingPaused ? { paused: p.body.trainingPaused.value } : {}),
  });
  const chosen = p.goal.type?.value;
  const goalType = rec.locked ? 'maintain' : chosen && !rec.blocked.some((b) => b.goal === chosen) ? chosen : rec.recommended;
  const targetWeightKg = goalWeightOf({ goal: goalType, weightKg, targetWeightKg: p.goal.targetWeightKg?.value, targetBodyFat: p.goal.targetBodyFat?.value, bodyFatPct: fat?.percent });
  const weekdays = [...(p.training.weekdays?.value ?? D.weekdays)].sort((a, b) => a - b);
  const diet = p.food.diet?.value ?? 'omnivore';
  const calc = calculateTargets(profile, goalType, weightKg, weekdays.length, {
    ...(fat ? { bodyFat: { method: fat.method, percent: fat.percent, range: fat.range } } : {}),
    ...(p.training.sessionMinutes ? { sessionMinutes: p.training.sessionMinutes.value } : {}),
    ...(p.goal.pace ? { pace: p.goal.pace.value } : {}),
    ...(targetWeightKg ? { targetWeightKg } : {}),
    ...(p.training.cardio && p.training.cardio.value.kind !== 'none' ? { cardio: p.training.cardio.value } : {}),
    experience: profile.experience,
    pregnant,
  });
  return {
    profile,
    goal: { type: goalType, startWeightKg: weightKg, startedAt: today, ...(targetWeightKg && goalType !== 'maintain' && goalType !== 'recomp' ? { targetWeightKg } : {}) },
    nutritionProfile: nutritionProfileFrom(p.food, { diet, excluded: [], slots: p.food.meals?.value ?? slotsFor(4) }),
    // Area C answers (Prompt 7): days, length, equipment, complaints, focus, working weights, cardio.
    training: trainingSetupFrom(p.training, {
      programId: recommendProgram({ days: weekdays.length, experience: profile.experience, goal: goalType }),
      weekdays,
      startedAt: today,
    }),
    target: { kcal: calc.kcal, protein: calc.protein, carbs: calc.carbs, fat: calc.fat },
    weightKg,
    ...(fat ? { bodyFat: { value: fat.percent, method: fat.method === 'measured' ? ('measured' as const) : ('estimate' as const) } } : {}),
  };
}

/** The defaults used by `defaultCoreSetup`, recorded as answers with source 'default' where nothing was given. */
export function defaultAnswers(p: OnboardingProfile, setup: CoreSetup, nowIso: string): OnboardingProfile {
  const d = <T>(value: T) => field(value, 'default', nowIso);
  return {
    ...p,
    body: {
      ...p.body,
      weightKg: p.body.weightKg ?? d(setup.weightKg),
      heightCm: p.body.heightCm ?? d(setup.profile.heightCm),
      birthYear: p.body.birthYear ?? d(Number(nowIso.slice(0, 4)) - setup.profile.age),
      sex: p.body.sex ?? d(setup.profile.sex),
      activity: p.body.activity ?? d(setup.profile.activity),
    },
    goal: { ...p.goal, type: p.goal.type ?? d(setup.goal.type) },
    food: { ...p.food, diet: p.food.diet ?? d(setup.nutritionProfile.diet), meals: p.food.meals ?? d(setup.nutritionProfile.slots) },
    training: { ...p.training, weekdays: p.training.weekdays ?? d(setup.training.weekdays), level: p.training.level ?? d(setup.profile.experience) },
  };
}
