import { describe, expect, it } from 'vitest';
import { getFood } from '../data/foods';
import { emptyState } from '../store/persistence';
import { ingredientFromFood } from './dishes';
import { runEngine } from './engine';
import { FEEDBACK_RULES, foodFeedback, withFeedback } from './foodFeedback';
import type { AppState, CustomDish, LogEntry, Macros, NutritionTarget } from './types';

/** Feedback after logging: at most one line, only from real values, no judgement. */

const target: NutritionTarget = { id: 't', validFrom: '2026-01-01', method: 'formula', kcal: 2500, protein: 150, carbs: 300, fat: 80 };
const m = (kcal: number, protein: number, carbs: number, fat: number): Macros => ({ kcal, protein, carbs, fat });
const before = m(800, 40, 100, 30);

describe('food feedback', () => {
  it('reaching the protein target wins over everything else', () => {
    const f = foodFeedback({ entry: { macros: m(400, 30, 20, 10) }, before: m(1000, 125, 100, 30), target });
    expect(f).toEqual({ kind: 'protein_goal', icon: '💪', text: 'Protein-Tagesziel erreicht' });
  });

  it('calories entering the target zone (the central zone of calorieStatus)', () => {
    const f = foodFeedback({ entry: { macros: m(500, 10, 60, 20) }, before: m(1900, 60, 200, 60), target });
    expect(f?.kind).toBe('calorie_zone');
    // Already in the zone before → no repeat.
    expect(foodFeedback({ entry: { macros: m(100, 2, 20, 1) }, before: m(2450, 60, 200, 60), target })?.kind).not.toBe('calorie_zone');
  });

  it('sugar: said once, neutrally, when the day crosses the EU reference of 90 g – with the real number', () => {
    const f = foodFeedback({ entry: { macros: m(300, 3, 70, 1), micros: { sugar: 40 } }, before, sugarBefore: 60, target });
    expect(f).toEqual({ kind: 'sugar', icon: 'ℹ️', text: 'Zucker heute bei 100 g – über dem Referenzwert von 90 g', amount: 100 });
    expect(FEEDBACK_RULES.sugarReferenceG).toBe(90);
    // Already above before → not repeated with every entry.
    expect(foodFeedback({ entry: { macros: m(300, 3, 70, 1), micros: { sugar: 40 } }, before, sugarBefore: 95, target })?.kind).not.toBe('sugar');
  });

  it('protein-rich (≥ 20 g and ≥ 25 % of the energy), fiber-rich (≥ 5 g), balanced – in that order', () => {
    expect(foodFeedback({ entry: { macros: m(150, 27, 10, 0.5) }, before, target })).toEqual({ kind: 'protein', icon: '💪', text: 'Starker Protein-Boost · 27 g', amount: 27 });
    expect(foodFeedback({ entry: { macros: m(300, 10, 50, 5), micros: { fiber: 8 } }, before, target })).toEqual({ kind: 'fiber', icon: '🌱', text: 'Gute Ballaststoffquelle · 8 g', amount: 8 });
    // 22 % protein, 50 % carbs, 27 % fat of 600 kcal – balanced, but not protein-rich.
    expect(foodFeedback({ entry: { macros: m(600, 33, 75, 18) }, before, target })?.kind).toBe('balanced');
  });

  it('nothing special → no feedback (it stays special); unknown protein never counts as protein-rich', () => {
    expect(foodFeedback({ entry: { macros: m(90, 1, 20, 0.3) }, before, target })).toBeUndefined();
    expect(foodFeedback({ entry: { macros: m(150, 27, 10, 0.5), unknown: ['protein'] }, before, target })).toBeUndefined();
    expect(withFeedback('Apfel erfasst', undefined)).toBe('Apfel erfasst');
    expect(withFeedback('Skyr erfasst', { kind: 'protein', icon: '💪', text: 'Starker Protein-Boost · 27 g' })).toBe('Skyr erfasst · 💪 Starker Protein-Boost · 27 g');
  });

  it('never judges or claims health effects', () => {
    const texts = [
      foodFeedback({ entry: { macros: m(400, 30, 20, 10) }, before: m(1000, 125, 100, 30), target }),
      foodFeedback({ entry: { macros: m(300, 3, 70, 1), micros: { sugar: 40 } }, before, sugarBefore: 60, target }),
      foodFeedback({ entry: { macros: m(150, 27, 10, 0.5) }, before, target }),
    ].map((f) => f!.text);
    for (const t of texts) expect(t).not.toMatch(/schlecht|ungesund|gesund|macht dich|stärker|sollst|musst/i);
  });
});

describe('recommendations use own dishes', () => {
  const SAT = '2026-09-26';
  const dish: CustomDish = {
    id: 'melon',
    name: 'Melonen-Sandwich',
    portions: 1,
    ingredients: [ingredientFromFood(getFood('bread')!, 120, 'a'), ingredientFromFood(getFood('feta')!, 80, 'b'), ingredientFromFood(getFood('chicken')!, 120, 'c')],
    createdAt: `${SAT}T08:00:00Z`,
    updatedAt: `${SAT}T08:00:00Z`,
  };
  const base = (patch: Partial<AppState> = {}): AppState => ({
    ...emptyState(),
    profile: { name: 'T', sex: 'male', age: 30, heightCm: 180, activity: 'moderate', experience: 'intermediate', createdAt: '2026-08-01T08:00:00' },
    goal: { type: 'maintain', startWeightKg: 80, startedAt: '2026-08-01' },
    nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['breakfast', 'snack', 'lunch', 'dinner'] },
    targets: [{ ...target, validFrom: '2026-08-01' }],
    training: null,
    weights: [{ id: 'w', date: '2026-08-01', kg: 80 }],
    customDishes: { melon: dish },
    ...patch,
  });
  const breakfast: LogEntry = { id: 'b', date: SAT, slot: 'breakfast', loggedAt: `${SAT}T08:00:00Z`, name: 'x', method: 'quick', macros: m(600, 30, 70, 20) };
  const eatenDish = (id: string, date: string): LogEntry => ({ id, date, slot: 'lunch', loggedAt: `${date}T12:00:00Z`, name: dish.name, method: 'dish', dishId: 'melon', macros: m(700, 50, 60, 25) });

  it('"Dein Melonen-Sandwich passt heute gut" – with kcal, protein, why, and one tap to log it', () => {
    const recs = runEngine(base({ logEntries: [breakfast, eatenDish('p1', '2026-09-20'), eatenDish('p2', '2026-09-23')] }), { date: SAT, hour: 12, limit: 20 });
    const own = recs.find((r) => r.kind === 'own_dish')!;
    expect(own.title).toBe('Dein Melonen-Sandwich passt heute gut');
    expect(own.message).toMatch(/^ca\. [\d.]+ kcal und \d+ g Protein/);
    const a = own.actions[0]!;
    expect(a.type).toBe('log_dish');
    if (a.type !== 'log_dish') return;
    expect(a.dishId).toBe('melon');
    expect(a.details!.because).toContain('dein eigenes Gericht');
    expect(a.details!.because).toContain('in den letzten 30 Tagen 2× gegessen');
  });

  it('only when it fits: no own-dish suggestion when the day is almost full', () => {
    const full: LogEntry = { ...breakfast, macros: m(2350, 140, 280, 75) };
    expect(runEngine(base({ logEntries: [full] }), { date: SAT, hour: 18, limit: 20 }).some((r) => r.kind === 'own_dish')).toBe(false);
    expect(runEngine(base({ logEntries: [breakfast], customDishes: {} }), { date: SAT, hour: 12, limit: 20 }).some((r) => r.kind === 'own_dish')).toBe(false);
  });
});
