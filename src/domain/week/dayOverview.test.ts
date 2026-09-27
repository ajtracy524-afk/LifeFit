import { describe, expect, it } from 'vitest';
import { emptyState } from '../../store/persistence';
import { catalogPrice } from '../costs';
import type { AppState, LogEntry, PlannedMeal } from '../types';
import { dayOverview } from './dayOverview';
import { buildWeekPlan } from './weekPlan';

/** The week plan's day cards read the central WeekPlan and rate it with the one calorie zone. */

const MON = '2026-09-21';
const TUE = '2026-09-22';
const WED = '2026-09-23';
const slots = ['breakfast', 'lunch', 'dinner'] as const;
const base = (patch: Partial<AppState> = {}): AppState => ({
  ...emptyState(),
  nutritionProfile: { diet: 'omnivore', excluded: [], slots: [...slots] },
  targets: [{ id: 't', validFrom: '2026-01-01', method: 'formula', kcal: 2000, protein: 120, carbs: 220, fat: 70 }],
  closedDayTargets: { [MON]: 2000, [TUE]: 2000, [WED]: 2000 },
  ...patch,
});
const meal = (id: string, date: string, slot: PlannedMeal['slot'], servings: number, status: PlannedMeal['status'] = 'planned'): PlannedMeal => ({ id, date, slot, recipeId: 'chili', servings, status, source: 'suggest' });
const day = (s: AppState, date: string) => buildWeekPlan(s, MON, TUE).days.find((d) => d.date === date)!;

describe('day overview of the nutrition week plan', () => {
  it('an open day: plan against the day target – "Plan passt" inside the calorie zone, otherwise how much is missing / too much', () => {
    const fits = base({ plannedMeals: [meal('a', WED, 'lunch', 1.4), meal('b', WED, 'dinner', 1.4)] });
    const o = dayOverview(day(fits, WED), TUE, [...slots], catalogPrice);
    expect(o.kcalRef).toBe(2000);
    expect(o.meals).toBe(2);
    expect(o.status.text).toMatch(/^Plan passt$|^Plan: /);
    const tooLittle = dayOverview(day(base({ plannedMeals: [meal('a', WED, 'lunch', 1)] }), WED), TUE, [...slots], catalogPrice);
    expect(tooLittle.status).toMatchObject({ tone: 'orange' });
    expect(tooLittle.status.text).toMatch(/^Plan: − [\d.]+ kcal$/);
    expect(tooLittle.cost!.lowChf).toBeGreaterThan(0);
  });

  it('a past day says how it really went (eaten values), an empty future day that it is not planned yet', () => {
    const eaten: LogEntry = { id: 'e', date: MON, slot: 'lunch', loggedAt: `${MON}T12:00:00Z`, name: 'x', method: 'quick', macros: { kcal: 1950, protein: 125, carbs: 200, fat: 70 } };
    const s = base({ logEntries: [eaten] });
    const past = dayOverview(day(s, MON), TUE, [...slots], catalogPrice);
    expect(past).toMatchObject({ kcal: 1950, protein: 125, status: { tone: 'green', text: '✓ Im Ziel' }, kcalTone: 'green', proteinTone: 'green' });
    expect(dayOverview(day(s, WED), TUE, [...slots], catalogPrice).status).toEqual({ tone: 'none', text: 'Noch nicht geplant' });
  });

  it('eating out: only the planned share of the target counts (dinner out → less kcal expected from the plan)', () => {
    const s = base({ dayContexts: { [WED]: { timeBudget: 'normal', mode: 'eating_out' } }, plannedMeals: [meal('a', WED, 'lunch', 1)] });
    const o = dayOverview(day(s, WED), TUE, [...slots], catalogPrice);
    expect(o.kcalRef).toBeLessThan(2000);
  });

  it('skipped meals do not count; eaten / planned is counted for today', () => {
    const s = base({ plannedMeals: [meal('a', TUE, 'breakfast', 1, 'eaten'), meal('b', TUE, 'lunch', 1), meal('c', TUE, 'dinner', 1, 'skipped')] });
    expect(dayOverview(day(s, TUE), TUE, [...slots], catalogPrice)).toMatchObject({ meals: 2, eaten: 1 });
  });
});

describe('day overview: carbs, fat and the cost of one day', () => {
  it('carbs and fat against the day target (planned for open days)', () => {
    const s = base({ plannedMeals: [meal('a', WED, 'lunch', 1), meal('b', WED, 'dinner', 1)] });
    const d = day(s, WED);
    const o = dayOverview(d, TUE, [...slots], catalogPrice);
    expect(o.carbs).toBe(d.planned.carbs);
    expect(o.fat).toBe(d.planned.fat);
    expect(o.carbsRef).toBe(220);
    expect(o.fatRef).toBe(70);
  });

  it('weekFoodCost for one day counts only that day (the "Heute" budget line)', async () => {
    const { weekFoodCost } = await import('./weekPlan');
    const s = base({ plannedMeals: [meal('a', TUE, 'lunch', 1), meal('b', WED, 'lunch', 1), meal('c', WED, 'dinner', 1)] });
    const tue = weekFoodCost(s, MON, { day: TUE })!;
    const wed = weekFoodCost(s, MON, { day: WED })!;
    const week = weekFoodCost(s, MON)!;
    expect(wed.lowChf).toBeCloseTo(tue.lowChf * 2, 1);
    expect(week.lowChf).toBeCloseTo(tue.lowChf + wed.lowChf, 1);
  });
});
