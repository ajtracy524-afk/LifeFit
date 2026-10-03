import { describe, expect, it } from 'vitest';
import { emptyState } from '../../store/persistence';
import type { AppState } from '../types';
import { editFromSummary, initialState, next } from './flow';
import { migrateOnboarding } from './migrate';
import { previewLines, recalcPreview } from './recalc';
import { compactWeekTemplate, MISSING_HINT_REST_DAYS, missingHint, pendingConfirmation, restUntil, summaryOf } from './summary';

/** Prompt 9 – "Dein Plan", the Heute card for missing answers, Vorher / Nachher. */

const NOW = new Date('2026-10-01T08:00:00Z');
const TODAY = '2026-10-01';

/** A user who finished the old onboarding (migrated, like on the first start after the update). */
const legacy = (patch: Partial<AppState> = {}): AppState =>
  migrateOnboarding(
    {
      ...emptyState(),
      profile: { name: 'A', sex: 'male', age: 30, heightCm: 180, activity: 'moderate', experience: 'beginner', createdAt: '2026-09-01T08:00:00Z' },
      goal: { type: 'muscle_gain', startWeightKg: 80, startedAt: '2026-09-01' },
      nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['breakfast', 'lunch', 'dinner'] },
      training: { programId: 'full-body', weekdays: [0, 2, 4] },
      targets: [{ id: 't', validFrom: '2026-09-01', method: 'formula', kcal: 2700, protein: 160, carbs: 330, fat: 75 }],
      weights: [{ id: 'w', date: '2026-09-01', kg: 80 }],
      ...patch,
    },
    NOW,
  );
/** … who has answered the one-time meal-prep question (E18). */
const user = (patch: Partial<AppState> = {}): AppState => {
  const s = legacy(patch);
  s.onboarding!.food.mealPrep = { value: true, source: 'user', updatedAt: NOW.toISOString() };
  return s;
};

describe('"Dein Plan"', () => {
  it('five cards – body, goal, energy, food frame, training week – each with the step "Ändern" opens', () => {
    const cards = summaryOf(user(), TODAY);
    expect(cards.map((c) => c.id)).toEqual(['body', 'goal', 'energy', 'food', 'training']);
    const body = cards[0]!;
    expect(body.lines.join(' ')).toMatch(/BMI ca\. 24,2–25,2/); // a range, not a false precision
    expect(body.lines.join(' ')).toMatch(/Körperfett: keine Angabe/);
    expect(body.step).toBe('bodyFat');
    expect(body.estimated).toEqual(['Alter', 'Körperfett']); // the birth year is derived from the age
    expect(cards[2]!.lines[0]).toBe('ca. 2.700 kcal pro Tag'); // the app's number format (fmt)
    expect(cards[3]!.lines.join(' ')).toContain('jeden Tag zuhause');
    expect(cards[4]!.step).toBe('plan');
  });

  it('with body fat: KFA and FFMI as ranges', () => {
    const s = user({ measurements: [{ id: 'm', date: '2026-09-01', kind: 'body_fat', value: 15, method: 'estimate' }] });
    const body = summaryOf(s, TODAY)[0]!;
    expect(body.lines.join(' ')).toMatch(/Körperfett ca\. \d+–\d+ %/);
    expect(body.lines.join(' ')).toMatch(/FFMI ca\. \d+,\d–\d+,\d/);
    expect(body.step).toBe('analysis');
  });

  it('number-free mode: portions instead of kcal', () => {
    const s = user();
    s.onboarding = { ...s.onboarding!, health: { ...s.onboarding!.health, numberFree: { value: true, source: 'user', updatedAt: NOW.toISOString() } } };
    const energy = summaryOf(s, TODAY).find((c) => c.id === 'energy')!;
    expect(energy.title).toBe('Portionen');
    expect(energy.lines.join(' ')).not.toContain('kcal');
  });

  it('the typical week in one line', () => {
    const out = { kind: 'out' } as const;
    const week = { 0: { lunch: out }, 1: { lunch: out }, 2: { lunch: out }, 3: { lunch: out }, 4: { lunch: out, dinner: { kind: 'togo' } } } as const;
    expect(compactWeekTemplate(week, ['breakfast', 'lunch', 'dinner'])).toBe('Mittag: Mo–Fr auswärts · Abend: Fr mitnehmen');
    expect(compactWeekTemplate({ 0: { lunch: out }, 2: { lunch: out } }, ['lunch'])).toBe('Mittag: Mo, Mi auswärts');
    expect(compactWeekTemplate(undefined, ['lunch'])).toBe('jeden Tag zuhause');
  });

  it('"Ändern" opens the step and "Weiter" returns to the summary', () => {
    const atSummary = { ...initialState('quick'), step: 'summary' as const };
    const editing = editFromSummary(atSummary, 'weight');
    expect(editing).toMatchObject({ step: 'weight', returnTo: 'summary' });
    const back = next(editing, {});
    expect(back.state.step).toBe('summary');
    expect(back.state.returnTo).toBeUndefined();
    expect(back.done).toBe(false);
  });
});

describe('the Heute card for missing answers', () => {
  const at = NOW.toISOString();
  it('one card at a time: migrated values to confirm first (allergens, then meal prep), then the missing answers', () => {
    const s = legacy({ nutritionProfile: { diet: 'omnivore', excluded: ['nuts'], slots: ['breakfast', 'lunch', 'dinner'] } });
    expect(pendingConfirmation(s)).toBe('allergens'); // "Nüsse" → peanuts + tree nuts (E5)
    expect(missingHint(s, TODAY)).toBeUndefined();
    s.onboarding!.food.allergens = { ...s.onboarding!.food.allergens!, source: 'user' };
    expect(pendingConfirmation(s)).toBe('mealPrep'); // E18
    s.onboarding!.food.mealPrep = { value: true, source: 'user', updatedAt: at };
    expect(pendingConfirmation(s)).toBeUndefined();
    expect(missingHint(s, TODAY)).toBe('bodyFat');
  });

  it('priority: body fat > everyday activity > typical week > pantry; then nothing', () => {
    const s = user();
    expect(missingHint(s, TODAY)).toBe('bodyFat');
    s.measurements = [{ id: 'm', date: TODAY, kind: 'body_fat', value: 18, method: 'estimate' }];
    s.onboarding!.body.activity = { value: 'moderate', source: 'default', updatedAt: at };
    expect(missingHint(s, TODAY)).toBe('activity');
    s.onboarding!.body.activity = { value: 'moderate', source: 'user', updatedAt: at };
    expect(missingHint(s, TODAY)).toBe('weekTemplate');
    s.onboarding!.food.weekTemplate = { value: {}, source: 'user', updatedAt: at };
    expect(missingHint(s, TODAY)).toBe('pantry');
    s.pantry = { oats: { foodId: 'oats', grams: 500, updatedAt: TODAY } } as unknown as AppState['pantry'];
    expect(missingHint(s, TODAY)).toBeUndefined();
  });

  it(`"Später": ${MISSING_HINT_REST_DAYS} days of rest – back on day ${MISSING_HINT_REST_DAYS}`, () => {
    const s = user();
    s.onboarding = { ...s.onboarding!, notices: { completeCard: { dismissedUntil: restUntil(TODAY) } } };
    expect(restUntil(TODAY)).toBe('2026-10-15');
    expect(missingHint(s, TODAY)).toBeUndefined();
    expect(missingHint(s, '2026-10-14')).toBeUndefined();
    expect(missingHint(s, '2026-10-15')).toBe('bodyFat');
  });

  it('never while the onboarding is open or the setup incomplete', () => {
    const s = user();
    s.onboarding = { ...s.onboarding!, progress: { ...s.onboarding!.progress, active: true } };
    expect(missingHint(s, TODAY)).toBeUndefined();
    expect(missingHint({ ...user(), targets: [] }, TODAY)).toBeUndefined();
  });
});

describe('Vorher / Nachher', () => {
  it('more activity → a higher target; nothing is stored', () => {
    const s = user();
    const p = recalcPreview(s, { profile: { activity: 'active' } }, TODAY)!;
    expect(p.before.kcal).toBe(2700);
    expect(p.after.kcal).toBeGreaterThan(2700);
    expect(p.changed).toBe(true);
    expect(p.lines[0]).toMatch(/^Kalorien: 2\.700 → [\d.]+ kcal \(\+[\d.]+\)$/);
    expect(s.targets).toHaveLength(1);
  });

  it('more training days raise the surcharge', () => {
    const s = user();
    const three = recalcPreview(s, {}, TODAY)!;
    const five = recalcPreview(s, { trainingDays: 5 }, TODAY)!;
    expect(five.after.kcal).toBeGreaterThan(three.after.kcal);
  });

  it('number-free mode speaks of portions', () => {
    const m = { kcal: 2000, protein: 120, carbs: 220, fat: 70 };
    expect(previewLines(m, { ...m, kcal: 2300 }, true)).toEqual(['Deine Portionen werden etwas größer.']);
    expect(previewLines(m, { ...m, kcal: 1700 }, true)).toEqual(['Deine Portionen werden etwas kleiner.']);
    expect(previewLines(m, { ...m, kcal: 2030 }, true)).toEqual(['Deine Portionen bleiben etwa gleich.']);
    expect(previewLines(m, m, false)[1]).toBe('Protein: 120 → 120 g');
  });
});
