// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prompt 9 – edge cases of the onboarding, end to end on the domain level:
 * everything skipped, extreme values, sex "keine Angabe", 17 and 70+,
 * pregnancy, BMI below 18.5. Always a usable app, never an unsafe target.
 */

const MONDAY = '2026-10-05';

async function load() {
  vi.resetModules();
  const store = await import('./store');
  const ob = await import('./onboardingActions');
  const nutrition = await import('../domain/nutrition');
  const week = await import('../domain/week');
  const flow = await import('../domain/onboarding/flow');
  const summary = await import('../domain/onboarding/summary');
  const migrate = await import('../domain/onboarding/migrate');
  const constants = await import('../domain/constants');
  return { store, ob, nutrition, week, flow, summary, migrate, constants };
}
type Ctx = Awaited<ReturnType<typeof load>>;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 5, 8, 0));
});
afterEach(() => vi.useRealTimers());

function body(c: Ctx, a: { sex?: 'male' | 'female' | 'unspecified'; birthYear?: number; weightKg?: number; heightCm?: number }) {
  c.ob.startOnboarding('full');
  if (a.sex) c.ob.setOnboardingAnswer('body', 'sex', a.sex);
  if (a.birthYear) c.ob.setOnboardingAnswer('body', 'birthYear', a.birthYear);
  if (a.weightKg) c.ob.setOnboardingAnswer('body', 'weightKg', a.weightKg);
  if (a.heightCm) c.ob.setOnboardingAnswer('body', 'heightCm', a.heightCm);
}

const targetOf = (c: Ctx) => c.nutrition.targetForDate(c.store.getState().targets, MONDAY)!;

/** Every finished onboarding: a complete setup, a week plan and a shopping list, a target above the floor. */
function expectUsable(c: Ctx) {
  const s = c.store.getState();
  expect(c.migrate.isSetupComplete(s)).toBe(true);
  expect(c.week.weekMeals(s, MONDAY).length).toBeGreaterThan(0);
  expect(c.week.weekShopping(s, MONDAY, MONDAY).length).toBeGreaterThan(0);
  expect(s.training!.programId).toMatch(/^program:plan-/);
  const weight = s.weights.at(-1)!.kg;
  expect(targetOf(c).kcal).toBeGreaterThanOrEqual(c.nutrition.calorieFloor(s.profile!, weight));
}

describe('edge cases', () => {
  it('everything skipped: defaults, all marked as defaults, the app works and Heute asks for the most effective answer', async () => {
    const c = await load();
    c.ob.startOnboarding('full');
    c.ob.finishOnboarding();
    expectUsable(c);
    const o = c.store.getState().onboarding!;
    for (const f of [o.body.weightKg, o.body.heightCm, o.body.birthYear, o.body.sex, o.body.activity, o.goal.type, o.food.diet, o.training.weekdays]) expect(f!.source).toBe('default');
    const cards = c.summary.summaryOf(c.store.getState(), MONDAY);
    expect(cards.find((x) => x.id === 'body')!.estimated).toEqual(['Gewicht', 'Größe', 'Alter', 'Körperfett']);
    expect(c.summary.missingHint(c.store.getState(), MONDAY)).toBe('bodyFat');
  });

  it('extreme values: 250 kg – the deficit is capped, protein from a reference weight, not 2 g per kg of 250', async () => {
    const c = await load();
    body(c, { sex: 'male', birthYear: 1980, weightKg: 250, heightCm: 175 });
    c.ob.setOnboardingAnswer('goal', 'type', 'fat_loss');
    c.ob.finishOnboarding();
    expectUsable(c);
    const s = c.store.getState();
    const calc = c.nutrition.calculateTargets(s.profile!, 'maintain', 250, s.training!.weekdays.length);
    const t = targetOf(c);
    expect(t.kcal).toBeLessThan(calc.tdee);
    expect(calc.tdee - t.kcal).toBeLessThanOrEqual(Math.round(calc.tdee * c.constants.MAX_DEFICIT_SHARE) + 1);
    expect(t.protein).toBeLessThan(250 * 1.2);
  });

  it('extreme values: 200 cm and 45 kg (BMI 11) – no fat loss, never below the floor', async () => {
    const c = await load();
    body(c, { sex: 'male', birthYear: 1996, weightKg: 45, heightCm: 200 });
    c.ob.setOnboardingAnswer('goal', 'type', 'fat_loss');
    c.ob.finishOnboarding();
    expectUsable(c);
    expect(c.store.getState().goal!.type).not.toBe('fat_loss');
  });

  it('sex "keine Angabe": the pregnancy question stays (it may apply), energy between the male and the female formula', async () => {
    const c = await load();
    expect(c.flow.asksPregnancy('unspecified', 30)).toBe(true);
    expect(c.flow.asksPregnancy('male', 30)).toBe(false);
    body(c, { sex: 'unspecified', birthYear: 1996, weightKg: 70, heightCm: 172 });
    c.ob.finishOnboarding();
    expectUsable(c);
    const s = c.store.getState();
    const p = s.profile!;
    expect(p.sex).toBe('unspecified');
    const tdee = (sex: 'male' | 'female' | 'unspecified') => c.nutrition.calculateTargets({ ...p, sex }, 'maintain', 70, 3).tdee;
    expect(tdee('unspecified')).toBeLessThan(tdee('male'));
    expect(tdee('unspecified')).toBeGreaterThan(tdee('female'));
  });

  it('age 17: only "Halten & Gesundheit", no deficit – even when fat loss was chosen', async () => {
    const c = await load();
    body(c, { sex: 'female', birthYear: 2009, weightKg: 70, heightCm: 165 });
    c.ob.setOnboardingAnswer('goal', 'type', 'fat_loss');
    c.ob.finishOnboarding();
    expectUsable(c);
    const s = c.store.getState();
    expect(s.profile!.age).toBe(17);
    expect(s.goal!.type).toBe('maintain');
    const calc = c.nutrition.calculateTargets(s.profile!, 'maintain', 70, s.training!.weekdays.length);
    expect(targetOf(c).kcal).toBeGreaterThanOrEqual(calc.kcal); // maintenance, rounded like every target
  });

  it('age 72: a plausible target with enough protein', async () => {
    const c = await load();
    body(c, { sex: 'male', birthYear: 1954, weightKg: 78, heightCm: 174 });
    c.ob.finishOnboarding();
    expectUsable(c);
    const t = targetOf(c);
    expect(c.store.getState().profile!.age).toBe(72);
    expect(t.kcal).toBeLessThan(3000);
    expect(t.protein / 78).toBeGreaterThanOrEqual(1.2);
  });

  it('pregnancy: the goal is locked to "Halten", no deficit; the pregnancy question is asked', async () => {
    const c = await load();
    expect(c.flow.asksPregnancy('female', 30)).toBe(true);
    body(c, { sex: 'female', birthYear: 1996, weightKg: 70, heightCm: 168 });
    c.ob.setOnboardingAnswer('health', 'pregnancy', 'pregnant');
    c.ob.setOnboardingAnswer('goal', 'type', 'fat_loss');
    c.ob.finishOnboarding();
    expectUsable(c);
    const s = c.store.getState();
    expect(s.goal!.type).toBe('maintain');
    const calc = c.nutrition.calculateTargets(s.profile!, 'maintain', 70, s.training!.weekdays.length);
    expect(targetOf(c).kcal).toBeGreaterThanOrEqual(calc.kcal); // maintenance, rounded like every target
  });

  it('BMI below 18.5: fat loss is not offered – a chosen fat loss becomes the recommendation', async () => {
    const c = await load();
    body(c, { sex: 'female', birthYear: 1996, weightKg: 49, heightCm: 166 }); // BMI 17.8
    c.ob.setOnboardingAnswer('goal', 'type', 'fat_loss');
    c.ob.finishOnboarding();
    expectUsable(c);
    expect(c.store.getState().goal!.type).not.toBe('fat_loss');
    expect(c.summary.summaryOf(c.store.getState(), MONDAY)[0]!.lines.join(' ')).toMatch(/BMI ca\. 17,3–18,3/);
  });
});
