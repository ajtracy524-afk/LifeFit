import type { OnboardingMode, OnboardingProfile, OnboardingSection, OnboardingStepId } from './types';

/**
 * Flow of the new onboarding – pure, no React. The UI only renders the step
 * returned here; next / back / skip / jump are functions of (state, answers).
 *
 *   welcome → A (Körper & Ziel) → B (Essen & Einkauf) → C (Training) → summary
 *
 * The step list depends on the mode (Schnellstart asks only weight, height,
 * birth year, sex, goal and training days) and on answers (conditional steps,
 * e.g. pregnancy only for "weiblich" or "keine Angabe").
 */

export type FlowSection = 'welcome' | OnboardingSection | 'summary';

export interface StepDef {
  id: OnboardingStepId;
  section: FlowSection;
  title: string;
  /** One line "Warum fragen wir das?". */
  why: string;
  /** Part of the Schnellstart. */
  quick: boolean;
  /** Shown only when this holds for the answers so far. */
  when?: (answers: FlowAnswers) => boolean;
}

/** The answers the flow itself depends on (conditions). */
export interface FlowAnswers {
  sex?: 'male' | 'female' | 'unspecified';
}

export interface FlowState {
  mode: OnboardingMode;
  step: OnboardingStepId;
  skipped: OnboardingStepId[];
  /** Re-opened from the profile: only this section. */
  scope?: OnboardingSection;
}

export const SECTION_LABEL: Record<OnboardingSection, string> = {
  A: 'Körper & Ziel',
  B: 'Essen & Einkauf',
  C: 'Training',
};

export const SECTIONS: OnboardingSection[] = ['A', 'B', 'C'];

export const STEPS: StepDef[] = [
  { id: 'welcome', section: 'welcome', quick: true, title: 'Willkommen bei LifeFit', why: 'Damit dein Plan zu dir passt. Jede Frage ist freiwillig.' },
  // A – Körper & Ziel
  { id: 'weight', section: 'A', quick: true, title: 'Dein Gewicht', why: 'Das Gewicht ist die wichtigste Größe für deinen Energiebedarf.' },
  { id: 'height', section: 'A', quick: true, title: 'Deine Größe', why: 'Mit der Größe berechnen wir BMI, Taillen-Verhältnis und Grundumsatz.' },
  { id: 'birthYear', section: 'A', quick: true, title: 'Dein Geburtsjahr', why: 'Der Grundumsatz sinkt mit dem Alter – das Geburtsjahr hält es aktuell.' },
  { id: 'sex', section: 'A', quick: true, title: 'Dein Geschlecht', why: 'Die Formeln für den Energiebedarf unterscheiden nach biologischem Geschlecht.' },
  { id: 'experience', section: 'A', quick: false, title: 'Kraftsport-Erfahrung', why: 'Einsteiger, Wiedereinsteiger und Erfahrene bauen unterschiedlich schnell auf.' },
  { id: 'activity', section: 'A', quick: false, title: 'Dein Alltag', why: 'Dein Alltag verbraucht oft mehr Energie als dein Training.' },
  { id: 'waist', section: 'A', quick: false, title: 'Taillenumfang', why: 'Der Taillenumfang sagt mehr über Bauchfett aus als das Gewicht allein.' },
  { id: 'analysis', section: 'A', quick: false, title: 'Deine Werte', why: 'So siehst du, was die Zahlen bedeuten – und was nicht.' },
  { id: 'bodyFat', section: 'A', quick: false, title: 'Körperfett', why: 'Mit deinem Körperfettanteil wird die Zielempfehlung genauer.' },
  {
    id: 'pregnancy',
    section: 'A',
    quick: true,
    title: 'Gesundheit',
    why: 'In Schwangerschaft und Stillzeit gelten andere Empfehlungen.',
    when: (a) => a.sex !== 'male',
  },
  { id: 'goal', section: 'A', quick: true, title: 'Dein Ziel', why: 'Dein Ziel bestimmt Kalorien, Makros und den Trainingsfokus.' },
  // B – Essen & Einkauf
  { id: 'diet', section: 'B', quick: false, title: 'Ernährungsform', why: 'Wir schlagen nur vor, was du auch isst.' },
  { id: 'allergies', section: 'B', quick: false, title: 'Allergien & Unverträglichkeiten', why: 'Was du nicht verträgst, taucht nie im Plan auf.' },
  { id: 'preferences', section: 'B', quick: false, title: 'Vorlieben', why: 'Was du magst, kommt öfter vor, was du nicht magst, seltener.' },
  { id: 'routine', section: 'B', quick: false, title: 'Dein Essalltag', why: 'Mahlzeiten, Zeit und Budget bestimmen die Rezepte stärker als der Geschmack.' },
  { id: 'week', section: 'B', quick: false, title: 'Deine typische Woche', why: 'Was du auswärts isst, wird nicht eingekauft.' },
  { id: 'pantry', section: 'B', quick: false, title: 'Was hast du schon zu Hause?', why: 'Was du schon hast, musst du nicht noch einmal kaufen.' },
  // C – Training
  { id: 'level', section: 'C', quick: false, title: 'Deine Erfahrung', why: 'Die Erfahrung bestimmt Umfang und Aufbau deines Trainings.' },
  { id: 'frame', section: 'C', quick: true, title: 'Dein Rahmen', why: 'Trainingstage und Zeit entscheiden, welcher Plan in deinen Alltag passt.' },
  { id: 'cardio', section: 'C', quick: false, title: 'Ausdauer', why: 'Ausdauer unterstützt Herz und Kreislauf – passend zu deinem Ziel.' },
  { id: 'focus', section: 'C', quick: false, title: 'Fokus', why: 'Fokus heißt etwas mehr Training für einzelne Muskeln.' },
  { id: 'plan', section: 'C', quick: false, title: 'Dein Trainingsplan', why: 'Dein Vorschlag zum Anpassen und Bestätigen.' },
  { id: 'summary', section: 'summary', quick: true, title: 'Dein Plan', why: 'Alles auf einen Blick – du kannst jeden Punkt ändern.' },
];

const BY_ID = new Map(STEPS.map((s) => [s.id, s]));

/** Step ids of earlier versions (Prompt 1 had one "body" screen) → where they continue now. */
const RENAMED: Record<string, OnboardingStepId> = { body: 'weight' };

export function stepDef(id: OnboardingStepId): StepDef {
  return BY_ID.get(id)!;
}

/** The visible steps for a mode and the answers so far (and, re-opened from the profile, for one section only). */
export function stepsFor(mode: OnboardingMode, answers: FlowAnswers, scope?: OnboardingSection): StepDef[] {
  return STEPS.filter((s) => (scope ? s.section === scope : true) && (mode === 'full' || s.quick) && (!s.when || s.when(answers)));
}

export function initialState(mode: OnboardingMode = 'full'): FlowState {
  return { mode, step: 'welcome', skipped: [] };
}

/** Re-open one section from the profile: starts at its first step, ends with it. */
export function sectionState(section: OnboardingSection, answers: FlowAnswers): FlowState {
  const first = stepsFor('full', answers, section)[0]!;
  return { mode: 'full', step: first.id, skipped: [], scope: section };
}

/** Index in the visible list – a step that became hidden (an answer changed) falls back to its place in the catalog. */
function position(steps: StepDef[], id: OnboardingStepId): number {
  const i = steps.findIndex((s) => s.id === id);
  if (i >= 0) return i;
  const catalog = STEPS.findIndex((s) => s.id === id);
  // The first visible step after the hidden one, minus one → "next" continues from there.
  return steps.findIndex((s) => STEPS.indexOf(s) > catalog) - 1;
}

export interface FlowResult {
  state: FlowState;
  /** The flow (or the re-opened section) is through. */
  done: boolean;
}

export function next(state: FlowState, answers: FlowAnswers): FlowResult {
  const steps = stepsFor(state.mode, answers, state.scope);
  const i = position(steps, state.step);
  const following = steps[i + 1];
  if (!following) return { state, done: true };
  return { state: { ...state, step: following.id }, done: false };
}

export function back(state: FlowState, answers: FlowAnswers): FlowState {
  const steps = stepsFor(state.mode, answers, state.scope);
  const i = steps.findIndex((s) => s.id === state.step);
  const before = i > 0 ? steps[i - 1] : i < 0 ? steps[Math.max(0, position(steps, state.step))] : undefined;
  return before ? { ...state, step: before.id } : state;
}

export function canGoBack(state: FlowState, answers: FlowAnswers): boolean {
  return back(state, answers).step !== state.step;
}

const withSkipped = (skipped: OnboardingStepId[], ids: OnboardingStepId[]) => [...new Set([...skipped, ...ids])];

/** "Überspringen": the step stays unanswered (defaults apply) and is remembered as skipped. */
export function skipStep(state: FlowState, answers: FlowAnswers): FlowResult {
  const skipped = state.step === 'welcome' || state.step === 'summary' ? state.skipped : withSkipped(state.skipped, [state.step]);
  return next({ ...state, skipped }, answers);
}

/** Skip the rest of the current section and continue with the first step of the next one. */
export function skipSection(state: FlowState, answers: FlowAnswers): FlowResult {
  const steps = stepsFor(state.mode, answers, state.scope);
  const section = stepDef(state.step).section;
  if (section === 'welcome' || section === 'summary') return skipStep(state, answers);
  const i = position(steps, state.step);
  const rest = steps.slice(Math.max(0, i)).filter((s) => s.section === section);
  const skipped = withSkipped(state.skipped, rest.map((s) => s.id));
  const after = steps.slice(Math.max(0, i)).find((s) => s.section !== section);
  if (!after) return { state: { ...state, skipped, step: rest[rest.length - 1]?.id ?? state.step }, done: true };
  return { state: { ...state, skipped, step: after.id }, done: false };
}

/** Jump directly to a visible step (e.g. "Ändern" in the summary). Unknown or hidden steps are ignored. */
export function jumpTo(state: FlowState, id: OnboardingStepId, answers: FlowAnswers): FlowState {
  return stepsFor(state.mode, answers, state.scope).some((s) => s.id === id) ? { ...state, step: id } : state;
}

export interface SectionProgress {
  section: OnboardingSection;
  /** Steps behind the current one (answered or skipped). */
  done: number;
  total: number;
  skipped: number;
  current: boolean;
}

/** Progress per section A/B/C – steps before the current one count as done. Sections without steps in the mode have total 0. */
export function sectionProgress(state: FlowState, answers: FlowAnswers): SectionProgress[] {
  const steps = stepsFor(state.mode, answers);
  const i = position(steps, state.step);
  const currentSection = stepDef(state.step).section;
  return SECTIONS.map((section) => {
    const inSection = steps.map((s, index) => ({ s, index })).filter((x) => x.s.section === section);
    return {
      section,
      total: inSection.length,
      done: inSection.filter((x) => x.index < i).length,
      skipped: inSection.filter((x) => state.skipped.includes(x.s.id)).length,
      current: currentSection === section,
    };
  });
}

/** The flow answers taken from the stored profile. */
export function answersOf(profile: OnboardingProfile | undefined): FlowAnswers {
  return { ...(profile?.body.sex ? { sex: profile.body.sex.value } : {}) };
}

/** The flow state stored in the profile (or a fresh one). */
export function flowStateOf(profile: OnboardingProfile | undefined): FlowState {
  const p = profile?.progress;
  const step = p?.step ? (RENAMED[p.step] ?? p.step) : undefined;
  if (!profile || !p || !step || !BY_ID.has(step)) return initialState(profile?.mode ?? 'full');
  return { mode: profile.mode ?? 'full', step, skipped: (p.skipped ?? []).map((id) => RENAMED[id] ?? id), ...(p.scope ? { scope: p.scope } : {}) };
}
