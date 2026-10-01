import { describe, expect, it } from 'vitest';
import {
  answersOf,
  back,
  canGoBack,
  flowStateOf,
  initialState,
  jumpTo,
  next,
  sectionProgress,
  sectionState,
  skipSection,
  skipStep,
  stepsFor,
  asksPregnancy,
  type FlowState,
} from './flow';
import { emptyOnboarding } from './migrate';
import type { OnboardingStepId } from './types';

const ids = (steps: { id: OnboardingStepId }[]) => steps.map((s) => s.id);
const at = (step: OnboardingStepId, mode: FlowState['mode'] = 'full', extra: Partial<FlowState> = {}): FlowState => ({ mode, step, skipped: [], ...extra });

describe('onboarding flow – paths', () => {
  it('Schnellstart asks only weight, height, birth year, sex, goal and training days (frame) – one topic per screen', () => {
    expect(ids(stepsFor('quick', { sex: 'male' }))).toEqual(['welcome', 'weight', 'height', 'birthYear', 'sex', 'health', 'goal', 'frame', 'summary']);
  });

  it('the detailed path walks through A, B and C', () => {
    expect(ids(stepsFor('full', { sex: 'male' }))).toEqual([
      'welcome', 'weight', 'height', 'birthYear', 'sex', 'experience', 'activity', 'waist', 'analysis', 'bodyFat', 'health', 'goal',
      'diet', 'allergies', 'preferences', 'routine', 'week', 'pantry',
      'level', 'frame', 'cardio', 'focus', 'plan', 'summary',
    ]);
  });

  it('the health check is for everyone (number-free mode); the pregnancy question inside only for "weiblich" or "keine Angabe", never under 18', () => {
    for (const mode of ['quick', 'full'] as const) {
      for (const sex of ['male', 'female', 'unspecified', undefined] as const) expect(ids(stepsFor(mode, sex ? { sex } : {}))).toContain('health');
    }
    expect(asksPregnancy('female', 30)).toBe(true);
    expect(asksPregnancy('unspecified', 30)).toBe(true);
    expect(asksPregnancy(undefined, undefined)).toBe(true); // while unanswered
    expect(asksPregnancy('male', 30)).toBe(false);
    expect(asksPregnancy('female', 17)).toBe(false); // the rule applies without asking
    // It sits right before the goal (the safety rules apply to the goal).
    const full = ids(stepsFor('full', {}));
    expect(full.indexOf('health')).toBe(full.indexOf('goal') - 1);
  });

  it('next walks the list and reports done after the summary', () => {
    let s = at('welcome', 'quick');
    const seen: OnboardingStepId[] = [s.step];
    for (;;) {
      const r = next(s, { sex: 'female' });
      if (r.done) break;
      s = r.state;
      seen.push(s.step);
    }
    expect(seen).toEqual(['welcome', 'weight', 'height', 'birthYear', 'sex', 'health', 'goal', 'frame', 'summary']);
  });

  it('back goes one visible step back and stops at the welcome screen', () => {
    expect(back(at('experience'), {}).step).toBe('sex');
    expect(back(at('weight'), {}).step).toBe('welcome');
    expect(back(at('welcome'), {}).step).toBe('welcome');
    expect(canGoBack(at('welcome'), {})).toBe(false);
    // From C back into B.
    expect(back(at('level'), {}).step).toBe('pantry');
  });
});

describe('onboarding flow – conditional steps change while answering', () => {
  it('a current step that is not visible (e.g. the mode changed) continues from its place in the catalog', () => {
    const s = at('diet', 'quick'); // B is not part of the Schnellstart
    expect(next(s, {}).state.step).toBe('frame');
    expect(back(s, {}).step).toBe('goal'); // the visible step before its place
  });
});

describe('onboarding flow – skipping and jumping', () => {
  it('Überspringen remembers the step as skipped and moves on; welcome and summary are never "skipped"', () => {
    const r = skipStep(at('waist'), {});
    expect(r.state).toMatchObject({ step: 'analysis', skipped: ['waist'] });
    expect(skipStep(at('welcome'), {}).state.skipped).toEqual([]);
    expect(skipStep(at('summary'), {})).toMatchObject({ done: true, state: { skipped: [] } });
    // Skipping twice does not duplicate.
    expect(skipStep({ ...at('waist'), skipped: ['waist'] }, {}).state.skipped).toEqual(['waist']);
  });

  it('Bereich überspringen marks the rest of the section and starts the next section', () => {
    const r = skipSection(at('activity'), { sex: 'female' });
    expect(r.state.step).toBe('diet');
    expect(r.state.skipped).toEqual(['activity', 'waist', 'analysis', 'bodyFat', 'health', 'goal']);
    // In the Schnellstart B has no steps – skipping A goes straight to training.
    expect(skipSection(at('weight', 'quick'), { sex: 'male' }).state.step).toBe('frame');
    // On the last section the summary follows.
    expect(skipSection(at('cardio'), {}).state.step).toBe('summary');
  });

  it('jumpTo goes to a visible step (e.g. "Ändern" in the summary) and ignores hidden ones', () => {
    expect(jumpTo(at('summary'), 'diet', {}).step).toBe('diet');
    expect(jumpTo(at('summary', 'quick'), 'experience', {}).step).toBe('summary'); // hidden in the Schnellstart
    expect(jumpTo(at('summary', 'quick'), 'diet', {}).step).toBe('summary'); // not part of the Schnellstart
  });
});

describe('onboarding flow – progress per section', () => {
  it('steps before the current one count as done; Schnellstart has no B steps', () => {
    const p = sectionProgress(at('diet'), { sex: 'male' });
    expect(p.map((x) => [x.section, x.done, x.total, x.current])).toEqual([
      ['A', 11, 11, false],
      ['B', 0, 6, true],
      ['C', 0, 5, false],
    ]);
    const quick = sectionProgress(at('frame', 'quick'), { sex: 'male' });
    expect(quick.map((x) => [x.section, x.done, x.total])).toEqual([
      ['A', 6, 6],
      ['B', 0, 0],
      ['C', 0, 1],
    ]);
    // At the summary everything is behind.
    expect(sectionProgress(at('summary'), {}).every((x) => x.done === x.total)).toBe(true);
    expect(sectionProgress({ ...at('diet'), skipped: ['waist'] }, {})[0]!.skipped).toBe(1);
  });
});

describe('onboarding flow – re-open a section, resume', () => {
  it('a section from the profile starts at its first step and is done after its last one', () => {
    const s = sectionState('B', {});
    expect(s).toMatchObject({ step: 'diet', scope: 'B', mode: 'full' });
    expect(next({ ...s, step: 'pantry' }, {}).done).toBe(true);
    expect(back(s, {}).step).toBe('diet'); // no way out of the section backwards
    expect(skipSection(s, {}).done).toBe(true);
    expect(jumpTo(s, 'level', {}).step).toBe('diet'); // other sections are not reachable
  });

  it('resume: the stored step comes back; a missing or unknown step starts fresh', () => {
    const p = emptyOnboarding();
    expect(flowStateOf(undefined)).toEqual(initialState('full'));
    expect(flowStateOf(p)).toEqual(initialState('full'));
    const paused = { ...p, mode: 'quick' as const, progress: { ...p.progress, step: 'goal' as const, skipped: ['height' as const] } };
    expect(flowStateOf(paused)).toEqual({ mode: 'quick', step: 'goal', skipped: ['height'] });
    // Saved by Prompt 1 (one "body" screen) → continues at the first of its four screens.
    const legacy = { ...p, progress: { ...p.progress, step: 'body' as OnboardingStepId, skipped: ['body' as OnboardingStepId] } };
    expect(flowStateOf(legacy)).toMatchObject({ step: 'weight', skipped: ['weight'] });
    const broken = { ...p, progress: { ...p.progress, step: 'nope' as OnboardingStepId } };
    expect(flowStateOf(broken).step).toBe('welcome');
    const scoped = { ...p, progress: { ...p.progress, step: 'diet' as const, scope: 'B' as const } };
    expect(flowStateOf(scoped).scope).toBe('B');
  });

  it('answersOf reads the sex for the conditions', () => {
    const p = emptyOnboarding();
    expect(answersOf(p)).toEqual({});
    expect(answersOf({ ...p, body: { sex: { value: 'female', source: 'user', updatedAt: '2026-10-01T08:00:00Z' } } })).toEqual({ sex: 'female' });
  });
});
