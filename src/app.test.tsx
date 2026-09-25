// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from './domain/types';

/**
 * App-level tests: first start, onboarding, persisted state and reset.
 * The store reads localStorage when its module is loaded, so every test
 * prepares storage first and then imports a fresh module graph.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = 'lifefit:v1';
const BACKUP_KEY = 'lifefit:corrupt-backup';
const WELCOME = 'Plane deine Woche.';

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  // Current Chrome returns a Promise from scrollTo() – the original cause of the blank screen.
  window.scrollTo = vi.fn(() => Promise.resolve()) as unknown as typeof window.scrollTo;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  vi.restoreAllMocks();
});

/** Renders the app like main.tsx does (StrictMode double-invokes effects). */
async function startApp() {
  vi.resetModules();
  const { App } = await import('./App');
  const store = await import('./store/store');
  root = createRoot(container);
  await act(async () => root!.render(<StrictMode><App /></StrictMode>));
  return store;
}

const text = () => container.textContent ?? '';

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
  if (!found) throw new Error(`Button "${label}" not found. Screen: ${text().slice(0, 200)}`);
  return found;
}

async function click(label: string) {
  await act(async () => button(label).click());
}

/** Sets a controlled React input the way a user would. */
async function type(label: string, value: string) {
  const lbl = [...container.querySelectorAll('label')].find((l) => l.textContent === label);
  const input = lbl && document.getElementById(lbl.htmlFor);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Field "${label}" not found`);
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function completeOnboardingFlow() {
  await click('Los geht');
  await click('Weiter'); // goal
  await type('Alter', '30');
  await type('Größe', '180');
  await type('Gewicht', '80');
  await click('Weiter'); // body
  await click('Weiter'); // training
  await click('Weiter'); // nutrition
  await click('übernehmen'); // program
  await click('Meine Woche erstellen');
  // The "creating" step saves after a short animation (1.4 s).
  await act(() => new Promise((r) => setTimeout(r, 1600)));
}

function storedState(): AppState | null {
  const raw = localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as AppState) : null;
}

/**
 * A complete state as written by onboarding – deliberately in the OLD v1
 * format, so these tests also cover loading + migrating existing user data.
 */
function completeState() {
  return {
    schemaVersion: 1,
    profile: { name: 'Alex', sex: 'male', age: 30, heightCm: 180, activity: 'moderate', experience: 'beginner', createdAt: '2026-09-01T08:00:00' },
    goal: { type: 'muscle_gain', startWeightKg: 80, startedAt: '2026-09-01' },
    nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['breakfast', 'lunch', 'dinner'] },
    targets: [{ id: 't1', validFrom: '2026-09-01', method: 'formula', kcal: 2700, protein: 160, carbs: 330, fat: 75 }],
    training: { programId: 'full-body', weekdays: [0, 2, 4] },
    plannedMeals: [],
    logEntries: [],
    workouts: [],
    weights: [],
    shopping: {},
    coach: { dismissed: {} },
  };
}

describe('first start', () => {
  it('shows the welcome screen when storage is empty', async () => {
    await startApp();
    expect(text()).toContain(WELCOME);
    expect(button('Los geht')).toBeTruthy();
  });

  it('does not crash when scrollTo() returns a Promise', async () => {
    await startApp();
    await click('Los geht');
    expect(container.innerHTML).not.toBe('');
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('must not return anything besides a function'), expect.anything(), expect.anything());
  });

  it('"Los geht’s" leads to the next onboarding step', async () => {
    await startApp();
    await click('Los geht');
    expect(text()).toContain('Was ist dein Ziel?');
    expect(text()).not.toContain(WELCOME);
  });

  it('stores nothing before onboarding is completed', async () => {
    await startApp();
    await click('Los geht');
    await click('Weiter');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('completing onboarding starts the regular app and persists the setup', async () => {
    await startApp();
    await completeOnboardingFlow();

    expect(container.querySelector('nav[aria-label="Hauptnavigation"]')).not.toBeNull();
    expect(text()).not.toContain(WELCOME);
    const saved = storedState();
    expect(saved?.profile?.age).toBe(30);
    expect(saved?.training).not.toBeNull();
    expect(saved?.targets.length).toBe(1);
  }, 10_000);
});

describe('saved state', () => {
  it('a complete saved state opens the app without the welcome screen', async () => {
    localStorage.setItem(KEY, JSON.stringify(completeState()));
    await startApp();
    expect(text()).not.toContain(WELCOME);
    expect(container.querySelector('nav[aria-label="Hauptnavigation"]')).not.toBeNull();
  });

  it('an incomplete saved state leads to onboarding without deleting data', async () => {
    const partial = { ...completeState(), training: null, targets: [] };
    localStorage.setItem(KEY, JSON.stringify(partial));
    await startApp();
    expect(text()).toContain(WELCOME);
    // Nothing was overwritten just by opening the app.
    expect(storedState()).toEqual(partial);
  });

  it('keeps existing data when an incomplete setup is completed again', async () => {
    const partial = { ...completeState(), training: null, weights: [{ id: 'old', date: '2026-08-01', kg: 82 }] };
    localStorage.setItem(KEY, JSON.stringify(partial));
    await startApp();
    await completeOnboardingFlow();
    expect(storedState()?.weights.some((w) => w.id === 'old')).toBe(true);
  }, 10_000);
});

describe('resetAll', () => {
  it('removes all LifeFit data and shows the welcome screen again', async () => {
    localStorage.setItem(KEY, JSON.stringify(completeState()));
    localStorage.setItem(BACKUP_KEY, '{"broken":');
    localStorage.setItem('other-app', 'keep');
    const store = await startApp();
    expect(text()).not.toContain(WELCOME);

    await act(async () => store.resetAll());

    expect(text()).toContain(WELCOME);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull();
    expect(localStorage.getItem('other-app')).toBe('keep');
  });
});

describe('week cascade', () => {
  it('shows the change summary and "Rückgängig" restores the previous plan', async () => {
    localStorage.setItem(KEY, JSON.stringify(completeState()));
    const store = await startApp();
    const { applyWithUndo } = await import('./lib/undo');
    const { today, weekStart } = await import('./domain/dates');
    const slotId = `${weekStart(today())}#0`;
    const before = store.getState();

    await act(async () => {
      applyWithUndo({ type: 'skipWorkout', slotId });
    });
    expect(store.getState().workoutOverrides[slotId]?.status).toBe('skipped');
    expect(text()).toContain('fällt diese Woche aus');

    await click('Rückgängig');
    expect(store.getState()).toBe(before);
    expect(storedState()?.workoutOverrides).toEqual({});
  });
});

describe('move / skip a workout (end to end)', () => {
  // Monday 21.09.2026, full body on Mon/Wed/Fri → slots #0 Mon, #1 Wed, #2 Fri.
  const MON = '2026-09-21';
  const WED = '2026-09-23';
  const THU = '2026-09-24';
  const FRI = '2026-09-25';
  const dayMeals = (date: string) => [
    { id: `${date}-l`, date, slot: 'lunch', recipeId: 'chicken-rice-bowl', servings: 1, status: 'planned', source: 'suggest' },
    { id: `${date}-d`, date, slot: 'dinner', recipeId: 'bolognese', servings: 1, status: 'planned', source: 'suggest' },
  ];
  const withMeals = () => ({ ...completeState(), plannedMeals: [...dayMeals(WED), ...dayMeals(THU), ...dayMeals(FRI)] });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 21, 10, 0));
    // jsdom has no <dialog> modal support – the Sheet only needs open/close.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });
  afterEach(() => vi.useRealTimers());

  const servings = (s: AppState, date: string) => s.plannedMeals.filter((m) => m.date === date).map((m) => m.servings);
  const weekRows = () => [...container.querySelectorAll('ul li')].filter((li) => li.querySelector('button[aria-label$="ausfallen lassen"], a'));
  const planButton = (index: number) => container.querySelectorAll<HTMLButtonElement>('button[aria-label$="verschieben oder ausfallen lassen"]')[index]!;

  async function openTraining() {
    localStorage.setItem(KEY, JSON.stringify(withMeals()));
    window.history.replaceState(null, '', '/#/training');
    return startApp();
  }

  it('Training: Mittwoch → Donnerstag moves targets, servings and shows undo', async () => {
    const store = await openTraining();
    const before = store.getState();
    await act(async () => planButton(1).click()); // Wednesday session
    await click('Do 24.');

    const after = store.getState();
    expect(after.workoutOverrides[`${MON}#1`]).toEqual({ slotId: `${MON}#1`, status: 'moved', date: THU });
    // Wednesday is a rest day now → smaller portions; Thursday is the training day → larger.
    expect(servings(after, WED).every((s) => s < 1)).toBe(true);
    expect(servings(after, THU).every((s) => s > 1)).toBe(true);
    expect(text()).toMatch(/auf Donnerstag verschoben/);
    expect(text()).toMatch(/Tagesziele: Mi −\d+ kcal, Do \+\d+ kcal/);
    expect(text()).toMatch(/Portionen angepasst/);
    expect(weekRows().some((li) => li.textContent?.includes('verschoben von Mi'))).toBe(true);

    await click('Rückgängig');
    expect(store.getState()).toBe(before);
    expect(servings(store.getState(), WED)).toEqual([1, 1]);
  });

  it('Training: skipping Friday affects only this week and updates shopping', async () => {
    const store = await openTraining();
    const { weekShopping } = await import('./domain/week');
    const { resolveWorkouts, scheduleForWeek } = await import('./domain/training');
    const chicken = (s: AppState) => weekShopping(s, MON, MON).find((i) => i.foodId === 'chicken')!.remainingG;
    const before = store.getState();

    await act(async () => planButton(2).click()); // Friday session
    await click('Diese Woche ausfallen lassen');

    const after = store.getState();
    expect(after.workoutOverrides[`${MON}#2`]?.status).toBe('skipped');
    expect(text()).toContain('Fällt aus');
    expect(text()).toMatch(/fällt diese Woche aus/);
    // Friday lost its training bonus → smaller portions → less chicken to buy.
    expect(servings(after, FRI).every((s) => s < 1)).toBe(true);
    expect(chicken(after)).toBeLessThan(chicken(before));
    // Calendar rotation: next week is exactly the plain rotation.
    const next = '2026-09-28';
    expect(resolveWorkouts(after.training, after.workoutOverrides, [], next).map((w) => [w.date, w.template.id])).toEqual(
      scheduleForWeek(after.training, next).map((w) => [w.date, w.template.id]),
    );

    await click('Rückgängig');
    expect(store.getState().workoutOverrides).toEqual({});
  });

  it('Heute: "Heute nicht?" moves today’s session and the day becomes a rest day', async () => {
    localStorage.setItem(KEY, JSON.stringify(withMeals()));
    window.history.replaceState(null, '', '/#/today');
    const store = await startApp();
    expect(text()).toContain('Heutiges Training');

    await click('Heute nicht?');
    await click('Di 22.');

    expect(store.getState().workoutOverrides[`${MON}#0`]).toMatchObject({ status: 'moved', date: '2026-09-22' });
    expect(text()).toContain('Ruhetag');
    expect(text()).toMatch(/auf Dienstag verschoben/);
  });
  it('Heute: "Wenig Zeit" exchanges slow meals, shortens training, undo restores', async () => {
    const slow = [
      { id: 'mon-l', date: MON, slot: 'lunch', recipeId: 'chili', servings: 1, status: 'planned', source: 'suggest' },
      { id: 'mon-d', date: MON, slot: 'dinner', recipeId: 'oven-salmon', servings: 1, status: 'planned', source: 'suggest' },
    ];
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), plannedMeals: slow }));
    window.history.replaceState(null, '', '/#/today');
    const store = await startApp();
    const before = store.getState();
    const minutes = () => Number(text().match(/Übungen · ~(\d+) min/)?.[1]);
    const full = minutes();

    await click('Wenig Zeit');

    const after = store.getState();
    expect(after.dayContexts[MON]?.timeBudget).toBe('low');
    expect(after.plannedMeals.filter((m) => m.date === MON).map((m) => m.recipeId)).not.toContain('oven-salmon');
    expect(minutes()).toBeLessThanOrEqual(30);
    expect(minutes()).toBeLessThan(full);
    expect(text()).toMatch(/Montag: Wenig Zeit/);
    expect(text()).toMatch(/ersetzt/);
    expect(text()).toMatch(/Training: .*\(kurz\)/);

    await click('Rückgängig');
    expect(store.getState()).toBe(before);
    expect(minutes()).toBe(full);
  });
});

describe('pantry in the shopping list (F2)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 21, 10, 0));
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });
  afterEach(() => vi.useRealTimers());

  it('ticking off fills the pantry, the detail sheet corrects it, undo restores', async () => {
    const lunch = { id: 'l', date: '2026-09-23', slot: 'lunch', recipeId: 'chicken-rice-bowl', servings: 1, status: 'planned', source: 'suggest' };
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), plannedMeals: [lunch] }));
    window.history.replaceState(null, '', '/#/shopping');
    const store = await startApp();
    const { pantryEstimate } = await import('./domain/week');

    // Tick off chicken (180 g needed) → one 400 g pack in the pantry.
    await click('Hähnchenbrust');
    expect(pantryEstimate(store.getState()).chicken).toBe(400);

    // Correct the amount in the detail sheet (the bought item sits under "Erledigt").
    await click('Erledigt');
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Wofür wird Hähnchenbrust gebraucht?"]')!.click());
    expect(text()).toContain('ca. 400 g da');
    const before = store.getState();
    await type('Hähnchenbrust im Vorrat', '100');
    await click('Speichern');
    expect(pantryEstimate(store.getState()).chicken).toBe(100);
    expect(text()).toMatch(/Vorrat: Hähnchenbrust aktualisiert/);
    // 180 g needed, 100 g there → back on the list with the missing amount.
    expect(text()).toMatch(/Hähnchenbrust\s*80 g/);

    await click('Rückgängig');
    expect(store.getState()).toBe(before);
  });
});

describe('error boundary', () => {
  it('shows a fallback with "Neu laden" instead of a blank page', async () => {
    vi.doMock('./features/onboarding/Onboarding', () => ({
      Onboarding: () => {
        throw new Error('boom');
      },
    }));
    try {
      await startApp();
      expect(text()).toContain('Hier ist etwas schiefgelaufen');
      expect(button('Neu laden')).toBeTruthy();
      expect(text()).not.toContain('Zur Startseite');
    } finally {
      vi.doUnmock('./features/onboarding/Onboarding');
    }
  });
});
