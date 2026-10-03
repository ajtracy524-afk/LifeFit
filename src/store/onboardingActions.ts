import { today, weekStart } from '../domain/dates';
import { nutritionProfileFrom, plannerSettingsFrom } from '../domain/onboarding/food';
import { trainingSetupFrom } from '../domain/onboarding/training';
import { applyTemplateChange, fillWeek, replanForbidden } from '../domain/week';
import { answersOf, flowStateOf, initialState, jumpTo, sectionState, type FlowState } from '../domain/onboarding/flow';
import { currentPlanDraft } from '../domain/onboarding/summary';
import { defaultAnswers, defaultCoreSetup, emptyOnboarding, isSetupComplete } from '../domain/onboarding/migrate';
import type { AnswerGroup, Field, OnboardingMode, OnboardingProfile, OnboardingSection, OnboardingStepId } from '../domain/onboarding/types';
import type { AppState, CardioType, GoalType, Macros, Profile, WorkoutTemplate } from '../domain/types';
import type { PlanDraft } from '../domain/onboarding/types';
import { CARDIO } from '../domain/constants';
import { ensurePlanBaseline, recordPlanVersion } from '../domain/planVersions';
import { completeOnboarding, setTargets } from './actions';
import { getState, update } from './store';

/**
 * Store actions of the new onboarding. Every navigation is saved right away –
 * closing the app mid-way lands on the same step next time (Grundregel
 * "Fortschritt nach jedem Schritt gespeichert").
 */

const profileOf = (s: AppState): OnboardingProfile => s.onboarding ?? emptyOnboarding();

function writeFlow(s: AppState, flow: FlowState, active: boolean) {
  const p = profileOf(s);
  s.onboarding = {
    ...p,
    mode: flow.mode,
    progress: {
      ...p.progress,
      step: flow.step,
      skipped: flow.skipped,
      active,
      ...(flow.scope ? { scope: flow.scope } : {}),
      ...(flow.returnTo ? { returnTo: flow.returnTo } : {}),
    },
  };
  if (!flow.scope) delete s.onboarding.progress.scope;
  if (!flow.returnTo) delete s.onboarding.progress.returnTo;
}

/** Start (or restart) the whole flow in a mode. */
export function startOnboarding(mode: OnboardingMode): void {
  update((s) => writeFlow(s, { ...initialState(mode), step: 'welcome' }, true));
}

/** Save the flow position (after next / back / skip / jump). */
export function saveOnboardingFlow(flow: FlowState): void {
  update((s) => writeFlow(s, flow, true));
}

/** Re-open one section from the profile – existing answers are shown pre-filled. */
export function openOnboardingSection(section: OnboardingSection): void {
  update((s) => {
    const p = profileOf(s);
    // Keep the place of an unfinished main flow (paused with "Später fortsetzen").
    const main = !p.progress.scope && p.progress.step && !p.progress.finishedAt ? { mainStep: p.progress.step, mainMode: p.mode ?? 'full' } : {};
    s.onboarding = { ...p, progress: { ...p.progress, ...main } };
    writeFlow(s, sectionState(section, answersOf(s.onboarding)), true);
  });
}

/** From the Heute card: one step of a section, back to Heute when done (Prompt 9). */
export function openOnboardingStep(section: OnboardingSection, step: OnboardingStepId): void {
  openOnboardingSection(section);
  update((s) => {
    const flow = flowStateOf(s.onboarding);
    writeFlow(s, jumpTo(flow, step, answersOf(s.onboarding)), true);
  });
}

/** "Später" on the Heute card: quiet for the rest days (Prompt 9). */
export function dismissMissingHint(until: string): void {
  update((s) => {
    const p = profileOf(s);
    s.onboarding = { ...p, notices: { ...p.notices, completeCard: { dismissedUntil: until } } };
  });
}

/** One answer, stored with its source (default 'user'). */
export function setOnboardingAnswer<G extends AnswerGroup, K extends keyof OnboardingProfile[G]>(
  group: G,
  key: K,
  value: OnboardingProfile[G][K] extends Field<infer T> | undefined ? T : never,
  source: Field<unknown>['source'] = 'user',
): void {
  update((s) => {
    const p = profileOf(s);
    const at = new Date().toISOString();
    s.onboarding = { ...p, [group]: { ...p[group], [key]: { value, source, updatedAt: at } } };
  });
}

/** Without a core setup the app cannot run – the answers so far plus defaults (marked 'default') make it usable. */
function ensureCoreSetup(): void {
  const s = getState();
  if (isSetupComplete(s)) return;
  const nowIso = new Date().toISOString();
  const p = profileOf(s);
  const setup = defaultCoreSetup(p, today(), nowIso);
  // Area B before the first week is planned: cooking time, household, budget (Prompt 4).
  update((d) => {
    d.plannerSettings = plannerSettingsFrom(p.food, d.plannerSettings);
  });
  completeOnboarding(setup);
  update((d) => {
    d.onboarding = defaultAnswers(profileOf(d), setup, nowIso);
  });
}

/**
 * "Später fortsetzen": leave the flow, keep the position. A new user can use
 * the app right away (answers so far + defaults); the profile offers
 * "Onboarding fortsetzen".
 */
export function pauseOnboarding(): void {
  ensureCoreSetup();
  update((s) => {
    const p = profileOf(s);
    s.onboarding = { ...p, progress: { ...p.progress, active: false } };
  });
}

/** Leave a re-opened section (back to the profile) – the position of the main flow is not changed. */
export function closeOnboardingSection(section: OnboardingSection): void {
  update((s) => {
    const p = profileOf(s);
    const progress = { ...p.progress, active: false, completed: { ...p.progress.completed, [section]: new Date().toISOString() } };
    delete progress.scope;
    // A finished onboarding stays finished; an unfinished one resumes where the main flow was.
    const mode = progress.mainMode ?? p.mode;
    if (progress.finishedAt || !progress.mainStep) delete progress.step;
    else progress.step = progress.mainStep;
    delete progress.mainStep;
    delete progress.mainMode;
    s.onboarding = { ...p, ...(mode ? { mode } : {}), progress };
  });
}

/** Finish: the core setup exists (defaults where nothing was given), the flow is closed. */
export function finishOnboarding(): void {
  ensureCoreSetup();
  // The training plan of "Dein Trainingsplan" (as edited, or as generated) – unless one was adopted already.
  const s0 = getState();
  if (!s0.onboarding?.training.plan) adoptPlan(currentPlanDraft(s0));
  update((s) => {
    // The first week plan right away – the shopping list follows from it.
    const t = today();
    fillWeek(s, weekStart(t), t);
    const p = profileOf(s);
    const at = new Date().toISOString();
    const progress = { ...p.progress, active: false, finishedAt: at, completed: { A: at, B: at, C: at, ...p.progress.completed } };
    delete progress.step;
    delete progress.scope;
    s.onboarding = { ...p, progress };
  });
}

/** The flow state to show now (resume position or a fresh start). */
export function currentFlow(): FlowState {
  return flowStateOf(getState().onboarding);
}

/**
 * "Als neues Tagesziel übernehmen" (existing users): the chosen goal and its
 * macros become a new target version – only on this explicit confirmation;
 * older versions stay as they are (E10). The pace answer is already stored.
 */
export function applyGoalAsTarget(goal: { type: GoalType; targetWeightKg?: number }, macros: Macros): void {
  update((s) => {
    if (s.goal) {
      s.goal.type = goal.type;
      if (goal.targetWeightKg && goal.type !== 'maintain' && goal.type !== 'recomp') s.goal.targetWeightKg = goal.targetWeightKg;
      else delete s.goal.targetWeightKg;
    }
  });
  setTargets(macros, 'formula');
}

/**
 * Body data from the profile (Prompt 9): stored in the profile and mirrored into
 * the answers (source 'user' – the Heute card stops asking). With `macros`
 * (the confirmed "Nachher" of the preview) a new target version follows;
 * older versions stay untouched (E10).
 */
export function applyProfileChange(patch: Partial<Pick<Profile, 'name' | 'age' | 'heightCm' | 'activity'>>, macros?: Macros): void {
  update((s) => {
    if (!s.profile) return;
    const before = s.profile;
    s.profile = { ...before, ...patch };
    const p = profileOf(s);
    const at = new Date().toISOString();
    const body = { ...p.body };
    if (patch.heightCm !== undefined && patch.heightCm !== before.heightCm) body.heightCm = { value: patch.heightCm, source: 'user', updatedAt: at };
    if (patch.activity !== undefined && (patch.activity !== before.activity || body.activity?.source !== 'user')) body.activity = { value: patch.activity, source: 'user', updatedAt: at };
    if (patch.age !== undefined && patch.age !== before.age) body.birthYear = { value: Number(today().slice(0, 4)) - patch.age, source: 'user', updatedAt: at };
    s.onboarding = { ...p, body };
  });
  if (macros) setTargets(macros, 'formula');
}

type FoodAnswers = OnboardingProfile['food'];
type FoodValue<K extends keyof FoodAnswers> = NonNullable<FoodAnswers[K]> extends Field<infer T> ? T : never;

/**
 * An area-B answer (Prompt 4): stored with source "user", then written into the
 * nutrition profile and planner settings. Planned meals the stricter filter
 * forbids now are replaced; a changed set of meals is planned at once.
 */
export function setFoodAnswer<K extends keyof FoodAnswers>(key: K, value: FoodValue<K>): void {
  update((s) => {
    const p = profileOf(s);
    const at = new Date().toISOString();
    s.onboarding = { ...p, food: { ...p.food, [key]: { value, source: 'user', updatedAt: at } } };
    applyFoodAnswers(s, key);
  });
}

/** Confirms answers that were migrated from older data (E5, E18) – they become "user" answers. */
export function confirmFoodAnswers(keys: (keyof FoodAnswers)[]): void {
  update((s) => {
    const p = profileOf(s);
    const food = { ...p.food } as Record<string, Field<unknown> | undefined>;
    for (const key of keys) {
      const f = food[key];
      if (f?.source === 'migrated') food[key] = { ...f, source: 'user', confirmedAt: new Date().toISOString() };
    }
    s.onboarding = { ...p, food: food as FoodAnswers };
  });
}

function applyFoodAnswers(s: AppState, key: keyof FoodAnswers): void {
  const food = profileOf(s).food;
  const t = today();
  s.plannerSettings = plannerSettingsFrom(food, s.plannerSettings);
  if (!s.nutritionProfile) return; // a new user: applied with the core setup
  const templateBefore = s.nutritionProfile.weekTemplate;
  s.nutritionProfile = nutritionProfileFrom(food, s.nutritionProfile);
  replanForbidden(s, t);
  // A new typical week: this and next week follow it (deviations of a single week stay).
  if (key === 'weekTemplate') applyTemplateChange(s, templateBefore, t);
  if (key === 'meals') {
    // Meals no longer chosen leave the plan from today on, new ones are filled in.
    const slots = s.nutritionProfile.slots;
    s.plannedMeals = s.plannedMeals.filter((m) => m.date < t || m.status !== 'planned' || slots.includes(m.slot));
    fillWeek(s, weekStart(t), t);
  }
}

type TrainingAnswers = OnboardingProfile['training'];
type TrainingValue<K extends keyof TrainingAnswers> = NonNullable<TrainingAnswers[K]> extends Field<infer T> ? T : never;

/**
 * An area-C answer (Prompt 7): stored with source "user" and written into the
 * training setup (and the level into the profile). The training plan itself
 * follows in Prompt 8; nothing is re-planned here.
 */
export function setTrainingAnswer<K extends keyof TrainingAnswers>(key: K, value: TrainingValue<K>): void {
  update((s) => {
    const p = profileOf(s);
    const at = new Date().toISOString();
    s.onboarding = { ...p, training: { ...p.training, [key]: { value, source: 'user', updatedAt: at } } };
    if (s.training) s.training = trainingSetupFrom(s.onboarding.training, s.training);
    if (key === 'level' && s.profile) s.profile = { ...s.profile, experience: value as Profile['experience'] };
  });
}

/** Rotation template of a cardio / mobility day of the plan. */
function extraTemplate(kind: 'cardio' | 'mobility', types: CardioType[] = []): WorkoutTemplate {
  if (kind === 'mobility') {
    return { id: '', name: 'Mobilität', focus: 'Beweglichkeit & Erholung', exercises: [{ exerciseId: 'mobility-flow', sets: 1, repMin: 1, repMax: 1, restSec: 0, durationMin: 15 }, { exerciseId: 'hip-mobility', sets: 1, repMin: 1, repMax: 1, restSec: 0, durationMin: 10 }] };
  }
  const exerciseId = types.includes('cycling') ? 'zone2-bike' : types.includes('running') ? 'zone2-run' : types.includes('rowing') ? 'rowing' : 'brisk-walk';
  return { id: '', name: 'Lockeres Cardio', focus: 'Ausdauer (Zone 2)', exercises: [{ exerciseId, sets: 1, repMin: 1, repMax: 1, restSec: 0, durationMin: CARDIO.zone2.minutes }] };
}

/**
 * "Plan übernehmen" (Prompt 8): the plan becomes the active program of the
 * existing rotation – one own routine per training day (strength, plus cardio /
 * mobility days), one own program, the weekdays in order, a plan version. The
 * start weights of Prompt 7 are already in the setup (workingWeights). No
 * second scheduler; Heute and the training surcharge read the rotation.
 */
export function adoptPlan(plan: Pick<PlanDraft, 'sessions' | 'week'>): string | undefined {
  ensureCoreSetup();
  let programId: string | undefined;
  update((s) => {
    if (!s.training) return;
    const now = new Date().toISOString();
    const t = today();
    const stamp = Date.now().toString(36);
    const days = plan.week.filter((d) => d.kind === 'strength' || d.kind === 'extra').sort((a, b) => a.weekday - b.weekday);
    if (!days.length) return;
    const routineIds = days.map((d, i) => {
      const template = d.kind === 'strength' ? plan.sessions[d.session]!.template : extraTemplate(d.kind === 'extra' ? d.extra : 'cardio', s.training?.cardio?.types);
      const id = `routine:plan-${stamp}-${i + 1}`;
      s.routines[id] = { ...structuredClone(template), id, createdAt: now, updatedAt: now };
      return id;
    });
    programId = `program:plan-${stamp}`;
    s.customPrograms[programId] = { id: programId, name: 'Mein Plan', routineIds, createdAt: now };
    const cardioDays = plan.week.flatMap((d) =>
      d.kind === 'rest' && d.cardio ? [{ weekday: d.weekday, kind: d.cardio }] : d.kind === 'strength' && d.cardioAfter ? [{ weekday: d.weekday, kind: d.cardioAfter, afterStrength: true as const }] : [],
    );
    ensurePlanBaseline(s);
    s.training = { ...s.training, programId, weekdays: days.map((d) => d.weekday), startedAt: t, ...(cardioDays.length ? { cardioDays } : {}) };
    if (!cardioDays.length) delete s.training.cardioDays;
    recordPlanVersion(s, 'program', t, 'Aus dem Onboarding');
    const p = profileOf(s);
    s.onboarding = { ...p, training: { ...p.training, plan: { value: { programId, weekdays: days.map((d) => d.weekday) }, source: 'user', updatedAt: now } } };
  });
  return programId;
}
