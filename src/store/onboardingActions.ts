import { today } from '../domain/dates';
import { answersOf, flowStateOf, initialState, sectionState, type FlowState } from '../domain/onboarding/flow';
import { defaultAnswers, defaultCoreSetup, emptyOnboarding, isSetupComplete } from '../domain/onboarding/migrate';
import type { AnswerGroup, Field, OnboardingMode, OnboardingProfile, OnboardingSection } from '../domain/onboarding/types';
import type { AppState } from '../domain/types';
import { completeOnboarding } from './actions';
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
    },
  };
  if (!flow.scope) delete s.onboarding.progress.scope;
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
  update((s) => {
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
