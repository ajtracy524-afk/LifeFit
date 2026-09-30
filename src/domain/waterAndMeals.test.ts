import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState, markEatingOutSkips } from '../store/persistence';
import { dayGoals } from './dayGoals';
import { runEngine } from './engine';
import { buildContext } from './engine/context';
import { dayReview } from './review/dayReview';
import { dayTimeline } from './schedule';
import { excludedSlots } from './timeBudget';
import type { AppState, LogEntry, PlannedMeal } from './types';
import { closedMeals, dayContextFor, dayTargetFor, planMeals, weekShopping } from './week';
import { waterAverage, waterGoalReached, waterReminder, waterWeek } from './water';
import { weekProgress } from './weekProgress';

const T = '2026-09-29'; // Tuesday
const MON = '2026-09-28';
const base = (patch: Partial<AppState> = {}): AppState => ({
  ...emptyState(),
  profile: { name: 'A', sex: 'male', age: 30, heightCm: 180, activity: 'moderate', experience: 'beginner', createdAt: '2026-07-01T08:00:00' },
  goal: { type: 'maintain', startWeightKg: 80, startedAt: '2026-07-01' },
  nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['breakfast', 'lunch', 'dinner'], waterGoalMl: 2000 },
  targets: [{ id: 't', validFrom: '2026-07-01', method: 'formula', kcal: 2500, protein: 150, carbs: 300, fat: 80 }],
  ...patch,
});
const at = (time: string, date = T) => new Date(`${date}T${time}:00`);
const entry = (slot: LogEntry['slot'], kcal: number, protein: number, date = T): LogEntry => ({
  id: `${slot}-${date}`,
  date,
  slot,
  loggedAt: `${date}T08:00:00`,
  name: 'x',
  method: 'quick',
  macros: { kcal, protein, carbs: 60, fat: 20 },
});
const meal = (id: string, slot: PlannedMeal['slot'], status: PlannedMeal['status'], date = T): PlannedMeal => ({ id, date, slot, recipeId: 'veggie-omelette', servings: 1, status, source: 'suggest' });

describe('water is a real part of the day goal and the week', () => {
  it('counts once in the day goals, with the one "reached" rule', () => {
    const s = base({ water: { [T]: 2000 } });
    const water = dayGoals(s, T).goals.filter((g) => g.key === 'water');
    expect(water).toHaveLength(1);
    expect(water[0]!.done).toBe(true);
    expect(waterGoalReached(s, T)).toBe(true);
    expect(dayGoals(base({ water: { [T]: 1750 } }), T).goals.find((g) => g.key === 'water')!.done).toBe(false);
    // Without a goal there is nothing to reach – no fake chip.
    expect(dayGoals(base({ nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['lunch'] } }), T).goals.some((g) => g.key === 'water')).toBe(false);
  });

  it('shows every day of the week: reached, not reached (with amount), no entry, still ahead', () => {
    const s = base({ water: { [MON]: 2250, [T]: 900 } });
    const days = waterWeek(s, MON, T);
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ date: MON, ml: 2250, reached: true, share: 1, future: false });
    expect(days[1]).toMatchObject({ ml: 900, reached: false, share: 0.45 });
    expect(days[2]).toMatchObject({ ml: 0, future: true });
    const p = weekProgress({ ...s, profile: { ...s.profile!, createdAt: `${MON}T08:00:00` } }, MON, T);
    expect(p.water).toBe(1);
    expect(p.waterDays?.map((d) => d.reached)).toEqual([true, false, false, false, false, false, false]);
  });
});

describe('water reminders: gentle, spread over the day, never when on track', () => {
  const behind = base({ water: { [T]: 0 } });

  it('comes only when clearly behind the pace of the day', () => {
    expect(waterReminder(behind, T, at('12:00'))?.text).toBeTruthy();
    expect(waterReminder(base({ water: { [T]: 500 } }), T, at('12:00'))).toBeUndefined(); // on track (~0,75 L expected)
    expect(waterReminder(base({ water: { [T]: 2000 } }), T, at('15:00'))).toBeUndefined(); // goal reached
    expect(waterReminder(base({ nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['lunch'] } }), T, at('12:00'))).toBeUndefined(); // no goal
  });

  it('stays quiet in the first and the last hour (no evening catch-up) and when switched off', () => {
    expect(waterReminder(behind, T, at('07:40'))).toBeUndefined();
    expect(waterReminder(behind, T, at('20:00'))).toBeUndefined();
    expect(waterReminder(base({ nutritionProfile: { ...behind.nutritionProfile!, waterReminders: 'off' } }), T, at('12:00'))).toBeUndefined();
  });

  it('pauses after a drink, after "Später" and after a reminder; at most five per day', () => {
    const coach = (water: AppState['coach']['water']) => base({ water: { [T]: 0 }, coach: { dismissed: {}, water } });
    expect(waterReminder(coach({ date: T, lastDrinkAt: at('11:40').toISOString() }), T, at('12:00'))).toBeUndefined();
    expect(waterReminder(coach({ date: T, snoozedUntil: at('13:00').toISOString() }), T, at('12:00'))).toBeUndefined();
    expect(waterReminder(coach({ date: T, sent: [at('11:00').toISOString()] }), T, at('12:00'))).toBeUndefined();
    expect(waterReminder(coach({ date: T, sent: [at('10:00').toISOString()] }), T, at('12:00'))).toBeDefined();
    expect(waterReminder(coach({ date: T, sent: ['08', '09', '10', '10', '10'].map((h) => at(`${h}:00`).toISOString()) }), T, at('13:00'))).toBeUndefined();
    // Yesterday's memory does not count today.
    expect(waterReminder(coach({ date: MON, sent: [at('11:30').toISOString()] }), T, at('12:00'))).toBeDefined();
  });

  it('changes its wording instead of repeating the same line', () => {
    const texts = new Set(['10:00', '12:00', '14:00', '16:00'].map((t) => waterReminder(behind, T, at(t))?.text));
    expect(texts.size).toBeGreaterThan(2);
  });
});

describe('dinner out / removed: no open task, no suggestion to fill it', () => {
  const eatenDay = [entry('breakfast', 600, 30), entry('lunch', 800, 40)];

  it('eating out: dinner is not a free slot and keeps its share – no dinner at home is suggested', () => {
    const s = base({ dayContexts: { [T]: { timeBudget: 'normal', mode: 'eating_out' } }, plannedMeals: [meal('d', 'dinner', 'skipped')], logEntries: eatenDay });
    const ctx = buildContext(s, { date: T, hour: 17 });
    expect(ctx.freeSlots).not.toContain('dinner');
    expect(ctx.reservedSlots).toEqual(['dinner']);
    const gap = runEngine(s, { date: T, hour: 17 }).find((r) => r.kind === 'nutrition_gap');
    expect(gap?.actions.some((a) => a.type === 'add_meal' && a.slot === 'dinner') ?? false).toBe(false);
    // Once dinner is logged, the share is no longer reserved.
    expect(buildContext({ ...s, logEntries: [...eatenDay, entry('dinner', 900, 50)] }, { date: T, hour: 21 }).reserved.kcal).toBe(0);
  });

  it('"Anders gegessen" (skipped) closes the slot too', () => {
    const s = base({ plannedMeals: [meal('d', 'dinner', 'skipped')], logEntries: eatenDay });
    expect(buildContext(s, { date: T, hour: 17 }).freeSlots).not.toContain('dinner');
  });

  describe('removing a meal', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(at('16:00'));
    });
    afterEach(() => vi.useRealTimers());

    it('closes the slot: no task, no suggestion, no re-planning – until something is planned there again', async () => {
      const store = await import('../store/store');
      const actions = await import('../store/actions');
      store.commit(base({ plannedMeals: [meal('b', 'breakfast', 'eaten'), meal('d', 'dinner', 'planned')], logEntries: eatenDay }));

      actions.removePlannedMeal('d');
      let s = store.getState();
      expect(dayContextFor(s, T).removedSlots).toEqual(['dinner']);
      expect(excludedSlots(dayContextFor(s, T))).toContain('dinner');
      expect(dayGoals(s, T).goals.find((g) => g.key === 'meals')).toMatchObject({ done: true, detail: '1 / 1' });
      expect(buildContext(s, { date: T, hour: 17 }).freeSlots).not.toContain('dinner');
      expect(runEngine(s, { date: T, hour: 17 }).some((r) => r.actions.some((a) => a.type === 'add_meal' && a.slot === 'dinner' && a.date === T))).toBe(false);
      // Re-planning (check-in, "Woche vorschlagen") leaves the slot empty.
      expect(planMeals(s, { dates: [T], today: T, seed: 'x' }).some((m) => m.slot === 'dinner')).toBe(false);

      // Planning a recipe there again opens the slot.
      actions.addPlannedMeal(T, 'dinner', 'veggie-omelette', 1);
      s = store.getState();
      expect(dayContextFor(s, T).removedSlots ?? []).toEqual([]);
      expect(s.dayContexts[T]).toBeUndefined();
      store.commit(emptyState());
    });

    it('back to "Zuhause" after eating out plans dinner again', async () => {
      const store = await import('../store/store');
      const actions = await import('../store/actions');
      store.commit(base({ dayContexts: { [T]: { timeBudget: 'normal', mode: 'eating_out', removedSlots: ['dinner'] } } }));
      actions.applyChange({ type: 'setDayContext', date: T, context: { mode: 'normal' } });
      const s = store.getState();
      expect(excludedSlots(dayContextFor(s, T))).toEqual([]);
      expect(s.plannedMeals.some((m) => m.date === T && m.slot === 'dinner' && m.status === 'planned')).toBe(true);
      store.commit(emptyState());
    });
  });
});

describe('dinner "Zuhause / Auswärts": decided in the week plan, followed by plan, shopping, Heute', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('09:00'));
  });
  afterEach(() => vi.useRealTimers());
  const WED = '2026-09-30';
  const eggs = (s: AppState) => weekShopping(s, MON, T).find((i) => i.foodId === 'egg')?.neededG ?? 0;

  it('Auswärts takes the dinner off the plan and the list, Zuhause brings exactly it back – no duplicates, undo restores', async () => {
    const store = await import('../store/store');
    const actions = await import('../store/actions');
    const { undoTo } = await import('../lib/undo');
    store.commit(base({ plannedMeals: [meal('d', 'dinner', 'planned', WED)] }));
    const before = eggs(store.getState());
    expect(before).toBeGreaterThan(0);

    const snap = store.snapshot();
    actions.applyChange({ type: 'setDayContext', date: WED, context: { mode: 'eating_out' } });
    let s = store.getState();
    expect(s.plannedMeals.find((m) => m.id === 'd')).toMatchObject({ status: 'skipped', skippedFor: 'eating_out' });
    expect(eggs(s)).toBe(0);
    expect(closedMeals(s, WED)).toEqual([{ date: WED, slot: 'dinner', reason: 'eating_out', recipeId: 'veggie-omelette' }]);
    // The day target stays – nothing is spread onto the other meals.
    expect(dayTargetFor(s, WED)).toEqual(dayTargetFor(base(), WED));

    actions.applyChange({ type: 'setDayContext', date: WED, context: { mode: 'normal' } });
    s = store.getState();
    const dinners = s.plannedMeals.filter((m) => m.date === WED && m.slot === 'dinner');
    expect(dinners).toHaveLength(1);
    expect(dinners[0]).toMatchObject({ id: 'd', status: 'planned' });
    expect(dinners[0]!.skippedFor).toBeUndefined();
    expect(eggs(s)).toBe(before);

    // Undo of a change = the snapshot before it.
    expect(undoTo(snap, store.snapshot())).toBe(true);
    expect(store.getState().plannedMeals).toEqual([meal('d', 'dinner', 'planned', WED)]);
    store.commit(emptyState());
  });

  it('an own "Anders gegessen" stays as the user left it when switching back to Zuhause', async () => {
    const store = await import('../store/store');
    const actions = await import('../store/actions');
    store.commit(base({ plannedMeals: [meal('d', 'dinner', 'skipped', WED)] }));
    actions.applyChange({ type: 'setDayContext', date: WED, context: { mode: 'eating_out' } });
    actions.applyChange({ type: 'setDayContext', date: WED, context: { mode: 'normal' } });
    expect(store.getState().plannedMeals.find((m) => m.id === 'd')!.status).toBe('skipped');
    store.commit(emptyState());
  });

  it('older data: dinners skipped by Auswärts get their reason once on load', () => {
    const s = base({ dayContexts: { [WED]: { timeBudget: 'normal', mode: 'eating_out' } }, plannedMeals: [meal('d', 'dinner', 'skipped', WED), meal('l', 'lunch', 'skipped', WED)] });
    const migrated = markEatingOutSkips(s);
    expect(migrated.plannedMeals.map((m) => m.skippedFor)).toEqual(['eating_out', undefined]);
    expect(markEatingOutSkips(migrated)).toBe(migrated);
  });

  it('Heute shows the state in the timeline – not the dish that was planned', () => {
    const s = base({ dayContexts: { [T]: { timeBudget: 'normal', mode: 'eating_out' } }, plannedMeals: [meal('b', 'breakfast', 'planned'), { ...meal('d', 'dinner', 'skipped'), skippedFor: 'eating_out' }] });
    const items = dayTimeline(s, T);
    expect(items.map((i) => i.kind)).toEqual(['meal', 'closed']);
    expect(items[1]).toMatchObject({ kind: 'closed', closed: { slot: 'dinner', reason: 'eating_out' } });
    // Removed: a closed slot without any meal record.
    const removed = base({ dayContexts: { [T]: { timeBudget: 'normal', mode: 'normal', removedSlots: ['lunch'] } } });
    expect(dayTimeline(removed, T)).toEqual([{ kind: 'closed', time: '12:30', closed: { date: T, slot: 'lunch', reason: 'removed' } }]);
  });
});

describe('water: one logic for Heute, the week, the review and the next step', () => {
  it('day goal chip shows drunk / goal', () => {
    expect(dayGoals(base({ water: { [T]: 1800 } }), T).goals.find((g) => g.key === 'water')).toMatchObject({ value: '1,8 / 2 L', detail: '1,8 L von 2 L', done: false });
  });

  it('the week average counts only days with an entry', () => {
    expect(waterAverage(waterWeek(base({ water: { [MON]: 2000, [T]: 1000 } }), MON, T))).toBe(1500);
    expect(waterAverage(waterWeek(base(), MON, T))).toBeUndefined();
  });

  it('next step: water when it is the simplest open thing – food gaps come first; hiding it ends reminders today', () => {
    const covered = base({ logEntries: [entry('lunch', 2500, 150)] });
    const step = runEngine(covered, { date: T, hour: 12 }).find((r) => r.kind === 'water_pace');
    expect(step).toMatchObject({ title: '💧 Noch 2 L Wasser', priority: 'low' });
    expect(step!.actions.map((a) => a.type)).toEqual(['add_water', 'snooze_water']);
    const hungry = runEngine(base(), { date: T, hour: 12 });
    expect(hungry.findIndex((r) => r.kind === 'nutrition_gap')).toBeLessThan(hungry.findIndex((r) => r.kind === 'water_pace'));
    // "Ausblenden" = no water reminder for the rest of the day (in the app and as notification).
    const hidden: AppState = { ...covered, coach: { dismissed: { [`water_pace:${T}`]: T } } };
    expect(runEngine(hidden, { date: T, hour: 12 }).some((r) => r.kind === 'water_pace')).toBe(false);
    expect(waterReminder(hidden, T, at('12:00'))).toBeUndefined();
  });

  it('the day review says water as "x von y" – no negative wording', () => {
    const y = '2026-09-28';
    const low = dayReview(base({ water: { [y]: 1000 }, logEntries: [entry('lunch', 2500, 150, y)] }), y)!;
    for (const line of low.improve.filter((l) => l.startsWith('Wasser'))) expect(line).toBe('Wasser gestern: 1 L von 2 L. Ein einzelner Tag ist kein Problem.');
    expect(low.good).not.toContain('Wasserziel erreicht');
    expect(dayReview(base({ water: { [y]: 2000 }, logEntries: [entry('lunch', 2500, 150, y)] }), y)!.good).toContain('Wasserziel erreicht');
  });
});
