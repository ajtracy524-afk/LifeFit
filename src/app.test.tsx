// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from './domain/types';
import { getFood } from './data/foods';
import { getRecipe } from './data/recipes';

/**
 * App-level tests: first start, onboarding, persisted state and reset.
 * The store reads localStorage when its module is loaded, so every test
 * prepares storage first and then imports a fresh module graph.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Every test imports a fresh module graph; the first (cold) import of the app takes a few seconds on a
// busy machine – a timeout there would cascade into the following tests. No assertion depends on it.
vi.setConfig({ testTimeout: 20_000 });

const KEY = 'lifefit:v1';
const BACKUP_KEY = 'lifefit:corrupt-backup';
/** The first screen of the onboarding. */
const WELCOME = 'Willkommen bei LifeFit';

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

/** Exact button label inside the open sheet (the page may have similar labels). */
async function clickInDialog(label: string) {
  const found = [...container.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`Dialog button "${label}" not found`);
  await act(async () => found.click());
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

/** Schnellstart with the required minimum (80 kg, 180 cm, 30 years, male) → "Dein Plan" → "Los geht's". */
async function completeOnboardingFlow() {
  await click('Schnellstart (ca. 1 Minute)');
  await click('Weiter');
  await type('Gewicht', '80');
  await click('Weiter');
  await type('Größe', '180');
  await click('Weiter');
  await type('Geburtsjahr', String(new Date().getFullYear() - 30));
  await click('Weiter');
  await click('Männlich');
  for (let i = 0; i < 20 && container.querySelector('h1')?.textContent !== 'Dein Plan'; i++) await click('Weiter');
  await click('Los geht’s');
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
    expect(button('Schnellstart (ca. 1 Minute)')).toBeTruthy();
    expect(button('Ohne Angaben starten')).toBeTruthy();
  });

  it('does not crash when scrollTo() returns a Promise', async () => {
    await startApp();
    await click('Weiter');
    expect(container.innerHTML).not.toBe('');
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('must not return anything besides a function'), expect.anything(), expect.anything());
  });

  it('"Weiter" leads to the next onboarding step', async () => {
    await startApp();
    await click('Weiter');
    expect(container.querySelector('h1')?.textContent).toBe('Dein Gewicht');
    expect(text()).not.toContain(WELCOME);
  });

  it('before the onboarding is completed only the answers and the position are stored – no setup, no plan', async () => {
    await startApp();
    await click('Weiter');
    await type('Gewicht', '80');
    await click('Weiter');
    // The flow resumes after a restart (E8), so the answers are saved – but nothing of the app setup exists yet.
    const saved = storedState()!;
    expect(saved.onboarding!.progress.step).toBe('height');
    expect(saved.profile).toBeNull();
    expect(saved.goal).toBeNull();
    expect(saved.training).toBeNull();
    expect(saved.targets).toEqual([]);
    expect(saved.plannedMeals).toEqual([]);
    expect(saved.weights).toEqual([]);
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
    // Monday's session is part of "Dein Plan".
    expect(text()).toMatch(/Dein Plan[\s\S]*Ganzkörper/);

    await click('Heute nicht?');
    await click('Di 22.');

    expect(store.getState().workoutOverrides[`${MON}#0`]).toMatchObject({ status: 'moved', date: '2026-09-22' });
    expect(text()).toContain('Ruhetag');
    expect(text()).toMatch(/auf Dienstag verschoben/);
  });
  it('"Wenig Zeit" is set in Ernährung (not on Heute): exchanges slow meals, shortens training, undo restores', async () => {
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

    // Heute shows status only – no control that re-plans meals.
    expect(container.querySelector('[role="tablist"][aria-label="Zeit zum Kochen"]')).toBeNull();
    expect(store.getState()).toBe(before);

    await act(async () => window.location.assign('#/nutrition'));
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    await click('Wenig Zeit');

    const after = store.getState();
    expect(after.dayContexts[MON]?.timeBudget).toBe('low');
    expect(after.plannedMeals.filter((m) => m.date === MON).map((m) => m.recipeId)).not.toContain('oven-salmon');
    expect(text()).toMatch(/Montag: Wenig Zeit/);
    expect(text()).toMatch(/2 Gerichte angepasst: /);
    expect(text()).toMatch(/Training: .*\(kurz\)/);
    // Heute follows and shows the state with the way to change it.
    await act(async () => window.location.assign('#/today'));
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(minutes()).toBeLessThanOrEqual(30);
    expect(minutes()).toBeLessThan(full);
    expect(text()).toMatch(/Heute: Wenig Zeit · in Ernährung ändern/);

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

describe('restock of basics (F8)', () => {
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

  it('a low basic shows as restock, "Diese Woche nicht nachkaufen" hides it, undo brings it back', async () => {
    const pantry = { oats: { foodId: 'oats', quantityG: 100, updatedAt: '2026-09-21T06:00:00Z' } };
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), pantry }));
    window.history.replaceState(null, '', '/#/shopping');
    const store = await startApp();

    expect(text()).toMatch(/Haferflocken\s*200 g · Nachkauf – Vorrat niedrig/);
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Wofür wird Haferflocken gebraucht?"]')!.click());
    expect(container.querySelector('dialog[open]')?.textContent).toMatch(/Grundvorrat: mindestens 300 g im Haus/);
    const before = store.getState();
    await click('Diese Woche nicht nachkaufen');
    expect(text()).not.toMatch(/Nachkauf – Vorrat niedrig/);
    await click('Rückgängig');
    expect(store.getState()).toBe(before);
    expect(text()).toMatch(/Nachkauf – Vorrat niedrig/);
  });
});

describe('weekly autopilot (F1)', () => {
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

  const inDialog = (label: string) => {
    const found = [...container.querySelectorAll('dialog[open] button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
    if (!found) throw new Error(`"${label}" not found in dialog`);
    return found;
  };
  const tab = (group: string, label: string) => {
    const list = container.querySelector(`[role="tablist"][aria-label="${group}"]`);
    const found = [...(list?.querySelectorAll('button') ?? [])].find((b) => b.textContent === label) as HTMLButtonElement | undefined;
    if (!found) throw new Error(`${group} / ${label} not found`);
    return found;
  };

  it('check-in → preview → "Woche erstellen" builds training, meals and shopping; undo restores', async () => {
    localStorage.setItem(KEY, JSON.stringify(completeState()));
    window.history.replaceState(null, '', '/#/today');
    const store = await startApp();
    const before = store.getState();

    await click('Woche planen');
    // Training: Tue / Thu / Sat instead of Mon / Wed / Fri.
    for (const day of ['Mo', 'Mi', 'Fr', 'Di', 'Do', 'Sa']) await act(async () => inDialog(day).click());
    await act(async () => inDialog('Weiter').click());
    await act(async () => tab('Zeit Do 24.', 'Wenig Zeit').click());
    await act(async () => inDialog('Weiter').click());
    await act(async () => tab('Abendessen Mi 23.', 'Auswärts').click());
    await act(async () => inDialog('Weiter').click());

    // Preview – nothing stored yet.
    expect(store.getState()).toBe(before);
    const dialog = () => container.querySelector('dialog[open]')?.textContent ?? '';
    expect(dialog()).toMatch(/Di\s*Ganzkörper/);
    expect(dialog()).toMatch(/Mi\s*2 Mahlzeiten · Auswärts/);
    expect(dialog()).toMatch(/\d+ Artikel/);

    await act(async () => inDialog('Woche erstellen').click());
    const after = store.getState();
    expect(after.training!.weekOverrides!['2026-09-21']).toEqual([1, 3, 5]);
    expect(after.dayContexts['2026-09-24']?.timeBudget).toBe('low');
    expect(after.dayContexts['2026-09-23']?.mode).toBe('eating_out');
    expect(after.plannedMeals.filter((m) => m.date === '2026-09-23' && m.status === 'planned').map((m) => m.slot).sort()).toEqual(['breakfast', 'lunch']);
    expect(window.location.hash).toMatch(/#\/nutrition/);
    expect(text()).toMatch(/Woche geplant/);

    await click('Rückgängig');
    expect(store.getState()).toBe(before);
  });
});

describe('Heute is focused (next action)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 21, 8, 0)); // Monday 08:00
  });
  afterEach(() => vi.useRealTimers());

  it('shows one next action; "Gegessen" logs the due meal and the next action moves on', async () => {
    const plan = ['breakfast', 'lunch', 'dinner'].map((slot, i) => ({
      id: `m${i}`, date: '2026-09-21', slot, recipeId: ['overnight-oats', 'chicken-wraps', 'bolognese'][i], servings: 1, status: 'planned', source: 'suggest',
    }));
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), plannedMeals: plan }));
    window.history.replaceState(null, '', '/#/today');
    const store = await startApp();

    const card = () => container.querySelector('[aria-label="Nächste Aktion"]')?.textContent ?? '';
    expect(card()).toMatch(/Frühstück: Protein Overnight Oats/);
    expect(text()).not.toMatch(/Hinweise zum Training/);

    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Nächste Aktion"] button')].find((b) => b.textContent?.trim() === 'Gegessen')!.click());
    expect(store.getState().plannedMeals.find((m) => m.id === 'm0')!.status).toBe('eaten');
    // Monday is a training day → training is next.
    expect(card()).toMatch(/Training starten/);
  });

  it('Heute only acts on the planned meal ("Anders gegessen" via Ersetzen) – the rest of the plan stays as it is', async () => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
    const plan = ['breakfast', 'lunch', 'dinner'].map((slot, i) => ({
      id: `m${i}`, date: '2026-09-21', slot, recipeId: ['overnight-oats', 'chicken-wraps', 'bolognese'][i], servings: 1, status: 'planned', source: 'suggest',
    }));
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), plannedMeals: plan }));
    window.history.replaceState(null, '', '/#/today');
    const store = await startApp();
    const others = () => store.getState().plannedMeals.filter((m) => m.id !== 'm0').map((m) => [m.id, m.recipeId, m.status]);
    const before = others();

    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Nächste Aktion"] button')].find((b) => b.textContent?.trim() === 'Ersetzen')!.click());
    await click('Manuell');
    await type('Name', 'Brötchen vom Bäcker');
    await type('Kalorien', '350');
    await click('Hinzufügen');

    expect(store.getState().plannedMeals.find((m) => m.id === 'm0')!.status).toBe('skipped');
    expect(store.getState().logEntries.some((e) => e.replacedMealId === 'm0' && e.name === 'Brötchen vom Bäcker')).toBe(true);
    // No hidden plan change: lunch and dinner are exactly the same meals, no day context set from Heute.
    expect(others()).toEqual(before);
    expect(store.getState().dayContexts).toEqual({});
  });
});

describe('personal plan on Heute', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 21, 8, 0)); // Monday 08:00, training day
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });
  afterEach(() => vi.useRealTimers());

  const day = () =>
    ['breakfast', 'lunch', 'dinner'].map((slot, i) => ({
      id: `m${i}`, date: '2026-09-21', slot, recipeId: ['overnight-oats', 'chicken-wraps', 'chicken-rice-bowl'][i], servings: 1, status: 'planned', source: 'suggest',
    }));

  it('"Dein Plan" shows the day in time order with training and explains itself', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), plannedMeals: day() }));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    const plan = text().slice(text().indexOf('Dein Plan'));
    expect(plan).toMatch(/07:30[\s\S]*12:30[\s\S]*18:00[\s\S]*Ganzkörper[\s\S]*19:00[\s\S]*nach dem Training/);
    await click('Warum dieser Plan?');
    expect(text()).toMatch(/Training um 18:00/);
  });

  it('"Mag ich nicht …" never plans the food again and replaces the meal (undo-able)', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), plannedMeals: day() }));
    window.history.replaceState(null, '', '/#/today');
    const store = await startApp();
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Chicken Wraps') || b.textContent?.includes('Hähnchen-Wraps'))!.click());
    expect(container.querySelector('dialog[open]')?.textContent).toMatch(/Warum dieses Gericht\?/);
    const before = store.getState();
    await click('Mag ich nicht');
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find((b) => b.textContent === 'Hähnchenbrust')!.click());
    const after = store.getState();
    expect(after.nutritionProfile!.dislikedFoods).toEqual(['chicken']);
    expect(after.plannedMeals.some((m) => m.recipeId === 'chicken-wraps' || m.recipeId === 'chicken-rice-bowl')).toBe(false);
    expect(text()).toMatch(/Hähnchenbrust wird nicht mehr eingeplant/);
    await click('Rückgängig');
    expect(store.getState()).toBe(before);
  });

  it('"Was LifeFit gelernt hat" grows from real behaviour and can be reset (undo-able)', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), plannedMeals: day() }));
    window.history.replaceState(null, '', '/#/profile');
    const store = await startApp();
    expect(text()).toMatch(/Was LifeFit gelernt hat[\s\S]*Noch nichts\./);
    expect(text()).not.toContain('Gelerntes zurücksetzen');

    // One eaten meal is a signal, not yet a statement.
    const { markEaten } = await import('./store/actions');
    await act(async () => markEaten('m0'));
    expect(text()).toContain('Erste Signale gesammelt, aber noch nichts Sicheres.');

    const { learnFromEvent } = await import('./domain/learning');
    await act(async () =>
      store.update((s) => {
        for (let i = 0; i < 6; i++) s.learning.preferences = learnFromEvent(s.learning.preferences, { type: 'meal_eaten', recipeId: 'overnight-oats', slot: 'breakfast', timeBudget: 'normal' }, 'x');
      }),
    );
    expect(text()).toMatch(/Du isst gern: Protein Overnight Oats/);

    const learned = store.getState();
    await click('Gelerntes zurücksetzen');
    expect(store.getState().learning.preferences).toEqual({});
    expect(text()).toMatch(/Noch nichts\./);
    await click('Rückgängig');
    expect(store.getState()).toBe(learned);
  });
});

describe('undo safety', () => {
  it('an outdated "Rückgängig" does not drop later changes', async () => {
    localStorage.setItem(KEY, JSON.stringify(completeState()));
    window.history.replaceState(null, '', '/#/today');
    const store = await startApp();
    const { applyWithUndo } = await import('./lib/undo');
    const actions = await import('./store/actions');
    const { today, weekStart } = await import('./domain/dates');

    await act(async () => {
      applyWithUndo({ type: 'skipWorkout', slotId: `${weekStart(today())}#0` });
    });
    const undoButton = button('Rückgängig');
    // Something else changes before the user taps "Rückgängig".
    await act(async () => actions.addWeight(today(), 81.2));
    const afterWeight = store.getState();

    await act(async () => undoButton.click());
    expect(store.getState()).toBe(afterWeight);
    expect(text()).toMatch(/Rückgängig ist nicht mehr möglich/);
  });
});

describe('error boundary', () => {
  it('shows a fallback with "Neu laden" instead of a blank page', async () => {
    vi.doMock('./features/onboarding/v2/OnboardingV2', () => ({
      OnboardingV2: () => {
        throw new Error('boom');
      },
    }));
    try {
      await startApp();
      expect(text()).toContain('Hier ist etwas schiefgelaufen');
      expect(button('Neu laden')).toBeTruthy();
      expect(text()).not.toContain('Zur Startseite');
    } finally {
      vi.doUnmock('./features/onboarding/v2/OnboardingV2');
    }
  });
});

describe('food tracking (end to end)', () => {
  const OFF_PRODUCT = {
    status: 1,
    product: { product_name: 'Knuspermüsli', brands: 'Testmarke', nutriments: { 'energy-kcal_100g': 220, proteins_100g: 8, carbohydrates_100g: 20, fat_100g: 10 }, product_quantity: 500, product_quantity_unit: 'g' },
  };
  const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 21, 9, 0)); // Monday 09:00
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });
  afterEach(() => vi.useRealTimers());

  const breakfast = { id: 'b', date: '2026-09-21', slot: 'breakfast', recipeId: 'skyr-bowl', servings: 1, status: 'planned', source: 'suggest' };

  it('Barcode → product found → 250 g → 550 kcal in the day and the meal; survives a reload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(OFF_PRODUCT), { status: 200 }));
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), plannedMeals: [breakfast] }));
    window.history.replaceState(null, '', '/#/nutrition');
    const store = await startApp();

    await click('Lebensmittel hinzufügen'); // first slot = breakfast
    await click('Barcode');
    await type('Barcode-Nummer', '4000000000009');
    await click('Produkt suchen');
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(text()).toContain('Knuspermüsli');
    await type('Menge in g', '250');
    expect(text()).toMatch(/550\s*kcal/);
    await click('Hinzufügen');

    const entries = store.getState().logEntries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ slot: 'breakfast', method: 'barcode', macros: { kcal: 550, protein: 20, carbs: 50, fat: 25 } });
    // Day balance and the breakfast card both show it; the planned meal is untouched.
    expect(text()).toMatch(/550\s*\/\s*[\d.]+ kcal/);
    expect(container.querySelector('[aria-label="Frühstück: Makros"]')?.textContent).toMatch(/20 g\s*Protein.*50 g\s*Kohlenh.*25 g\s*Fett/);
    expect(store.getState().plannedMeals[0]!.status).toBe('planned');

    await act(async () => root?.unmount());
    root = undefined;
    const again = await startApp();
    expect(again.getState().logEntries[0]?.barcode).toBe('4000000000009');
    expect(text()).toContain('Knuspermüsli');
  });

  it('product not found → "Manuell erfassen" with only calories', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 0 }), { status: 404 }));
    localStorage.setItem(KEY, JSON.stringify(completeState()));
    window.history.replaceState(null, '', '/#/nutrition');
    const store = await startApp();
    await click('Lebensmittel hinzufügen');
    await click('Barcode');
    await type('Barcode-Nummer', '4000000000009');
    await click('Produkt suchen');
    await settle();
    expect(text()).toContain('Produkt nicht gefunden');
    await click('Manuell erfassen');
    await type('Name', 'Riegel vom Kiosk');
    await type('Kalorien', '230');
    await click('Hinzufügen');
    expect(store.getState().logEntries[0]).toMatchObject({ name: 'Riegel vom Kiosk', method: 'manual', barcode: '4000000000009', macros: { kcal: 230 }, unknown: ['protein', 'carbs', 'fat'] });
    expect(text()).toMatch(/Protein –/);
  });

  it('API unreachable → honest message, manual entry offered, the app keeps working', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    localStorage.setItem(KEY, JSON.stringify(completeState()));
    window.history.replaceState(null, '', '/#/nutrition');
    await startApp();
    await click('Lebensmittel hinzufügen');
    await click('Barcode');
    await type('Barcode-Nummer', '4000000000009');
    await click('Produkt suchen');
    await settle();
    expect(text()).toContain('Produkt konnte nicht geladen werden.');
    expect(text()).toContain('Du kannst es manuell erfassen.');
    expect(button('Erneut versuchen')).toBeTruthy();
  });

  it('"Vorschlag": the planned breakfast is one tap away, alternatives come from the planner', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), plannedMeals: [breakfast] }));
    window.history.replaceState(null, '', '/#/nutrition');
    const store = await startApp();
    await click('Lebensmittel hinzufügen');
    expect(text()).toContain('Dein Plan');
    expect(text()).toContain('Oder passend zu deinem Plan');
    expect(text()).toMatch(/Heute noch offen:/);
    await click('Gegessen');
    expect(store.getState().plannedMeals[0]!.status).toBe('eaten');
  });

  it('Heute: water – tap a bottle, see goal · drunk · left, tap the last one to take it back', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), nutritionProfile: { ...completeState().nutritionProfile, waterGoalMl: 2000 } }));
    window.history.replaceState(null, '', '/#/today');
    const store = await startApp();
    const water = () => container.querySelector('[aria-label^="Wasser: 250 ml pro Glas"]')!;
    // 2 L goal → 8 glasses of 250 ml.
    expect(water().querySelectorAll('button[aria-label^="Wasser auf"]')).toHaveLength(8);
    expect(text()).toMatch(/Noch 2 L/);
    // Tapping the 2nd glass fills up to it: +500 ml in one tap.
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Wasser auf 0,5 L"]')!.click());
    expect(store.getState().water['2026-09-21']).toBe(500);
    expect(text()).toMatch(/0,5 L\s*\/ 2 L/);
    expect(text()).toMatch(/Noch 1,5 L · 6 Gläser/);
    // The last full glass takes 250 ml back; "+250" adds one.
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="250 ml weniger"]')!.click());
    expect(store.getState().water['2026-09-21']).toBe(250);
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="250 ml Wasser hinzufügen"]')!.click());
    expect(store.getState().water['2026-09-21']).toBe(500);
    // Same control, same data on "Ernährung".
    await act(async () => window.location.assign('#/nutrition'));
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(text()).toMatch(/0,5 L\s*\/ 2 L/);
  });

  it('Heute: a large goal uses 500-ml bottles (big enough to tap on a phone), +250 stays the fine step', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), nutritionProfile: { ...completeState().nutritionProfile, waterGoalMl: 2500 } }));
    window.history.replaceState(null, '', '/#/today');
    const store = await startApp();
    const water = container.querySelector('[aria-label^="Wasser: 500 ml pro Flasche"]')!;
    expect(water.querySelectorAll('button')).toHaveLength(5);
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Wasser auf 1 L"]')!.click());
    expect(store.getState().water['2026-09-21']).toBe(1000);
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="250 ml Wasser hinzufügen"]')!.click());
    expect(store.getState().water['2026-09-21']).toBe(1250);
    expect(text()).toMatch(/1,25 L\s*\/ 2,5 L/);
    expect(text()).toMatch(/Noch 1,25 L/);
  });

  it('Heute: water without a goal shows a neutral scale and asks for a goal – nothing invented', async () => {
    localStorage.setItem(KEY, JSON.stringify(completeState()));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    expect(container.querySelectorAll('button[aria-label^="Wasser auf"]')).toHaveLength(8);
    expect(text()).toContain('Wasserziel noch nicht festgelegt');
    expect(container.querySelector('a[href*="section=water"]')!.textContent).toBe('Ziel festlegen');
    expect(text()).not.toMatch(/Noch \d/);
    // No goal → no water chip in the day goals.
    expect(container.querySelector('[aria-label^="Wasser:"][data-done]')).toBeNull();
  });
});

describe('Heute: replace a meal, balance, eaten vs. next (phase 1)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 22, 12, 45)); // Tuesday 12:45 – lunch is due, dinner later
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });
  afterEach(() => vi.useRealTimers());

  const TUE = '2026-09-22';
  const day = () => [
    { id: 'b', date: TUE, slot: 'breakfast', recipeId: 'overnight-oats', servings: 1, status: 'eaten', source: 'suggest' },
    { id: 'l', date: TUE, slot: 'lunch', recipeId: 'bolognese', servings: 1, status: 'planned', source: 'suggest' },
    { id: 'd', date: TUE, slot: 'dinner', recipeId: 'chili', servings: 1, status: 'planned', source: 'suggest' },
  ];
  const withLog = () => {
    const s = completeState();
    return { ...s, plannedMeals: day(), logEntries: [{ id: 'e-b', date: TUE, slot: 'breakfast', loggedAt: `${TUE}T07:40:00Z`, name: 'Protein Overnight Oats', plannedMealId: 'b', recipeId: 'overnight-oats', servings: 1, method: 'plan', macros: { kcal: 545, protein: 41, carbs: 70, fat: 10 } }] };
  };
  const timelineItem = (title: string) => [...container.querySelectorAll<HTMLButtonElement>('ol button')].find((b) => b.textContent?.includes(title))!;
  const ringKcal = () => Number(container.querySelector('[role="img"]')!.getAttribute('aria-label')!.match(/^([\d.]+) von/)![1]!.replace('.', ''));

  it('eaten meals step back with a check, the next open meal is highlighted', async () => {
    localStorage.setItem(KEY, JSON.stringify(withLog()));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    expect(timelineItem('Protein Overnight Oats').dataset.state).toBe('eaten');
    expect(timelineItem('Protein Overnight Oats').textContent).toMatch(/gegessen/);
    expect(timelineItem('Vollkorn-Pasta Bolognese').dataset.state).toBe('next');
    expect(timelineItem('Vollkorn-Pasta Bolognese').textContent).toMatch(/als Nächstes/);
    expect(timelineItem('Chili con Carne').dataset.state).toBe('planned');
  });

  it('tap a meal → Ersetzen → Vorschlag → one tap: logged instead, balance updated at once, one entry only', async () => {
    localStorage.setItem(KEY, JSON.stringify(withLog()));
    window.history.replaceState(null, '', '/#/today');
    const store = await startApp();
    const before = ringKcal();
    await act(async () => timelineItem('Vollkorn-Pasta Bolognese').click());
    await clickInDialog('Ersetzen');
    expect(text()).toContain('Passend zu deinem Plan');
    // Lunch is due → the suggestion is logged as eaten with one tap.
    const eat = container.querySelector<HTMLButtonElement>('dialog[open] button[aria-label$=" gegessen"]')!;
    const chosen = eat.getAttribute('aria-label')!.replace(/ gegessen$/, '');
    await act(async () => eat.click());
    // Replacing is one flow with ONE feedback line: what the new food brings, or what changed (old → new · kcal).
    const replaced = document.querySelector<HTMLElement>('[data-testid="celebration"]')!;
    if (replaced.dataset.kind === 'check') expect(replaced.textContent).toMatch(new RegExp(`Vollkorn-Pasta Bolognese → ${chosen} · [+−][\d.]+ kcal`));
    else expect(replaced.dataset.level).toMatch(/^[123]$/);

    const s = store.getState();
    const lunch = s.plannedMeals.find((m) => m.id === 'l')!;
    expect(lunch.recipeId).not.toBe('bolognese');
    expect(lunch.status).toBe('eaten');
    expect(lunch.replacedRecipeId).toBe('bolognese');
    expect(s.logEntries.filter((e) => e.date === TUE && e.slot === 'lunch')).toHaveLength(1);
    const { daySummary } = await import('./domain/nutrition');
    const summary = daySummary(s.logEntries, TUE).day.macros.kcal;
    expect(ringKcal()).toBe(Math.round(summary));
    expect(ringKcal()).toBeGreaterThan(before);
    expect(timelineItem(chosen).dataset.state).toBe('eaten');
  });

  it('a later meal: the suggestion changes only the plan ("Übernehmen"), nothing is logged', async () => {
    localStorage.setItem(KEY, JSON.stringify(withLog()));
    window.history.replaceState(null, '', '/#/today');
    const store = await startApp();
    await act(async () => timelineItem('Chili con Carne').click());
    await clickInDialog('Ersetzen');
    await act(async () => container.querySelector<HTMLButtonElement>('dialog[open] button[aria-label$=" übernehmen"]')!.click());
    const s = store.getState();
    expect(s.plannedMeals.find((m) => m.id === 'd')).toMatchObject({ status: 'planned', replacedRecipeId: 'chili' });
    expect(s.logEntries).toHaveLength(1);
  });

  it('Ersetzen → Manuell: the old meal no longer counts, the entry does – undo restores everything', async () => {
    localStorage.setItem(KEY, JSON.stringify(withLog()));
    window.history.replaceState(null, '', '/#/today');
    const store = await startApp();
    const before = store.getState();
    // Replace the already eaten breakfast: its log entry must go, not stay twice.
    await act(async () => timelineItem('Protein Overnight Oats').click());
    await clickInDialog('Ersetzen');
    await click('Manuell');
    await type('Name', 'Käsebrötchen');
    await type('Kalorien', '380');
    await type('Protein', '15');
    await click('Hinzufügen');

    const s = store.getState();
    expect(s.plannedMeals.find((m) => m.id === 'b')!.status).toBe('skipped');
    const breakfast = s.logEntries.filter((e) => e.slot === 'breakfast');
    expect(breakfast).toHaveLength(1);
    expect(breakfast[0]).toMatchObject({ name: 'Käsebrötchen', replacedMealId: 'b', macros: { kcal: 380, protein: 15 } });
    expect(ringKcal()).toBe(380);
    // Shown in place of the replaced meal.
    expect(timelineItem('Käsebrötchen').textContent).toMatch(/statt Protein Overnight Oats/);

    await click('Rückgängig');
    expect(store.getState()).toBe(before);
  });

  it('remembered replacements come back as quick options', async () => {
    const s = withLog();
    s.plannedMeals.push({ id: 'old', date: '2026-09-15', slot: 'lunch', recipeId: 'chicken-rice-bowl', servings: 1, status: 'eaten', source: 'swap', replacedRecipeId: 'bolognese' } as never);
    localStorage.setItem(KEY, JSON.stringify(s));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    await act(async () => timelineItem('Vollkorn-Pasta Bolognese').click());
    await clickInDialog('Ersetzen');
    const dialog = container.querySelector('dialog[open]')!.textContent!;
    expect(dialog).toMatch(/Zuletzt als Ersatz\s*🍗?\s*Chicken-Reis-Bowl/);
    expect(dialog).toMatch(/1× als Ersatz/);
    // Offered once – not again under "Passend zu deinem Plan".
    expect(dialog.match(/Chicken-Reis-Bowl/g)).toHaveLength(1);
  });

  it('a remembered replacement the user may no longer eat (now disliked) is not offered', async () => {
    const s = withLog();
    s.plannedMeals.push({ id: 'old', date: '2026-09-15', slot: 'lunch', recipeId: 'chicken-rice-bowl', servings: 1, status: 'eaten', source: 'swap', replacedRecipeId: 'bolognese' } as never);
    const disliked = { ...s, nutritionProfile: { ...s.nutritionProfile, dislikedFoods: ['chicken'] } };
    localStorage.setItem(KEY, JSON.stringify(disliked));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    await act(async () => timelineItem('Vollkorn-Pasta Bolognese').click());
    await clickInDialog('Ersetzen');
    const dialog = container.querySelector('dialog[open]')!.textContent!;
    expect(dialog).not.toMatch(/Zuletzt als Ersatz/);
    expect(dialog).not.toMatch(/Chicken-Reis-Bowl/);
    expect(dialog).toMatch(/Passend zu deinem Plan/);
  });

  it('next-action card: time, all macros, cost; "Ersetzen" opens the suggestions directly; the name opens details', async () => {
    localStorage.setItem(KEY, JSON.stringify(withLog()));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    const card = () => container.querySelector('[aria-label="Nächste Aktion"]')!;
    expect(card().textContent).toMatch(/Jetzt · 12:30/);
    expect(card().textContent).toMatch(/Mittagessen: Vollkorn-Pasta Bolognese/);
    expect(card().textContent).toMatch(/kcal · \d+ g P · \d+ g KH · \d+ g F · ca\. CHF [\d.]+–[\d.]+/);
    const btn = (label: string) => [...card().querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;
    await act(async () => btn('Ersetzen').click());
    expect(container.querySelector('dialog[open]')!.textContent).toMatch(/Vollkorn-Pasta Bolognese ersetzen[\s\S]*Passend zu deinem Plan/);
    await act(async () => container.querySelector<HTMLButtonElement>('dialog[open] button[aria-label="Schließen"]')?.click());
    await act(async () => card().querySelector<HTMLButtonElement>('button[aria-label$="– Details"]')!.click());
    expect(container.querySelector('dialog[open]')!.textContent).toMatch(/Warum dieses Gericht\?/);
  });

  it('next-action "Gegessen": one entry, balance and timeline update, the next open meal moves up', async () => {
    localStorage.setItem(KEY, JSON.stringify(withLog()));
    window.history.replaceState(null, '', '/#/today');
    const store = await startApp();
    const card = () => container.querySelector('[aria-label="Nächste Aktion"]')!;
    const eat = () => [...card().querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Gegessen')!;
    await act(async () => eat().click());
    const s = store.getState();
    expect(s.plannedMeals.find((m) => m.id === 'l')!.status).toBe('eaten');
    expect(s.logEntries.filter((e) => e.plannedMealId === 'l')).toHaveLength(1);
    expect(ringKcal()).toBe(Math.round(545 + s.logEntries.find((e) => e.plannedMealId === 'l')!.macros.kcal));
    expect(timelineItem('Vollkorn-Pasta Bolognese').dataset.state).toBe('eaten');
    expect(timelineItem('Chili con Carne').dataset.state).toBe('next');
    // The card moves on (by design shopping needed today/tomorrow comes before a meal that is not due yet).
    expect(card().textContent).not.toMatch(/Mittagessen/);
  });

  it('quick add sits in the header (in the layout, not floating over water or timeline) and keeps its sheet', async () => {
    localStorage.setItem(KEY, JSON.stringify(withLog()));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    const quick = container.querySelector<HTMLButtonElement>('header button[aria-label="Schnell erfassen"]');
    expect(quick).not.toBeNull();
    // Exactly one quick-add button – no second floating copy anywhere.
    expect(container.querySelectorAll('button[aria-label="Schnell erfassen"]')).toHaveLength(1);
    await act(async () => quick!.click());
    const sheet = container.querySelector('dialog[open]')!.textContent!;
    expect(sheet).toMatch(/Schnell erfassen[\s\S]*Essen[\s\S]*Gewicht[\s\S]*Training[\s\S]*Einkauf/);
  });

  it('water beyond the goal: all bottles full, "erreicht" with the extra amount', async () => {
    const s = withLog();
    localStorage.setItem(KEY, JSON.stringify({ ...s, nutritionProfile: { ...s.nutritionProfile, waterGoalMl: 1000 }, water: { [TUE]: 1500 } }));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    expect(container.querySelectorAll('button[aria-label^="Wasser auf"], button[aria-label="250 ml weniger"]')).toHaveLength(4);
    expect(text()).toMatch(/Tagesziel erreicht 🎉 · 0,5 L darüber/);
  });

  it('Ernährung: a replacement shows "statt …" like on Heute, the replaced meal is marked', async () => {
    localStorage.setItem(KEY, JSON.stringify(withLog()));
    window.history.replaceState(null, '', '/#/nutrition');
    const store = await startApp();
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('main button')].find((b) => b.textContent?.includes('Vollkorn-Pasta Bolognese'))!.click());
    await clickInDialog('Ersetzen');
    await click('Manuell');
    await type('Name', 'Salat vom Buffet');
    await type('Kalorien', '420');
    await click('Hinzufügen');
    expect(store.getState().plannedMeals.find((m) => m.id === 'l')!.status).toBe('skipped');
    expect(text()).toMatch(/statt Vollkorn-Pasta Bolognese[\s\S]*Salat vom Buffet/);
    expect(text()).toContain('Anders gegessen');
    // Balance of the day: breakfast + replacement, nothing counted twice.
    expect(text()).toMatch(/965\s*\/\s*[\d.]+ kcal/);
  });

  it('macros are one compact row – no accordion', async () => {
    localStorage.setItem(KEY, JSON.stringify(withLog()));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    const macros = container.querySelector('[role="group"][aria-label="Makros"]')!;
    expect(macros.textContent).toMatch(/Protein\s*41 \/ \d+ g/);
    expect(macros.textContent).toMatch(/Kohlenhydrate\s*70 \/ \d+ g/);
    expect(macros.textContent).toMatch(/Fett\s*10 \/ \d+ g/);
    expect(container.querySelector('[aria-expanded]')?.textContent ?? '').not.toMatch(/Makros/);
  });

  it('budget line: an estimated range against the budget, only with reliable prices', async () => {
    const s = { ...withLog(), plannerSettings: { priority: 'balanced', weeklyBudgetChf: 55, mealTimes: { breakfast: '07:30', snack: '10:30', lunch: '12:30', dinner: '19:00' } } };
    localStorage.setItem(KEY, JSON.stringify(s));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    expect(text()).toMatch(/Diese Woche ca\. CHF [\d.]+–[\d.]+ von CHF 55\.–/);
    expect(text()).not.toMatch(/€/);
  });

  it('next-action card: a meal long past its time is "Noch offen", not "Jetzt"', async () => {
    vi.setSystemTime(new Date(2026, 8, 22, 18, 0)); // 18:00 – breakfast (07:30) never logged
    const s = withLog();
    s.plannedMeals = s.plannedMeals.map((m) => (m.id === 'b' ? { ...m, status: 'planned' } : m));
    s.logEntries = [];
    localStorage.setItem(KEY, JSON.stringify(s));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    const card = container.querySelector('[aria-label="Nächste Aktion"]')!.textContent!;
    expect(card).toMatch(/Noch offen · 07:30/);
    expect(card).toMatch(/Frühstück: Protein Overnight Oats/);
    expect(card).not.toMatch(/Jetzt/);
  });

  it('Heute budget: eaten so far and what is left – and being over budget is said in words', async () => {
    const settings = (budget: number) => ({ priority: 'balanced', weeklyBudgetChf: budget, mealTimes: { breakfast: '07:30', snack: '10:30', lunch: '12:30', dinner: '19:00' } });
    localStorage.setItem(KEY, JSON.stringify({ ...withLog(), plannerSettings: settings(55) }));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    // Breakfast (overnight oats) is eaten → a "bisher" value; the rest of the budget is free.
    expect(text()).toMatch(/bisher gegessen ca\. CHF [\d.]+–[\d.]+ · frei ca\. CHF [\d.]+–[\d.]+/);

    await act(async () => root?.unmount());
    root = undefined;
    localStorage.setItem(KEY, JSON.stringify({ ...withLog(), plannerSettings: settings(10) }));
    await startApp();
    expect(text()).toMatch(/von CHF 10\.– – über Budget/);
    expect(text()).toMatch(/ca\. CHF [\d.]+–[\d.]+ über Budget/);
  });

  it('Ernährung day view shows the same budget line as Heute (one calculation, one store)', async () => {
    const settings = { priority: 'balanced', weeklyBudgetChf: 55, mealTimes: { breakfast: '07:30', snack: '10:30', lunch: '12:30', dinner: '19:00' } };
    localStorage.setItem(KEY, JSON.stringify({ ...withLog(), plannerSettings: settings }));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    const line = () => text().match(/Diese Woche ca\. CHF [\d.]+–[\d.]+ von CHF 55.–bisher gegessen ca\. CHF [\d.]+–[\d.]+ · frei ca\. CHF [\d.]+–[\d.]+/)?.[0];
    const onToday = line();
    expect(onToday).toBeDefined();
    await act(async () => {
      window.location.hash = '#/nutrition';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(container.querySelector('h1')?.textContent).toMatch(/Ernährung/);
    expect(line()).toBe(onToday);
  });
});

describe('phase 2: micronutrients, CHF prices, camera (Heute + Ernährung)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 22, 12, 45)); // Tuesday 12:45
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  });
  afterEach(async () => {
    vi.useRealTimers();
    const scanner = await import('./services/barcodeScanner');
    scanner.setDecoderFactory(undefined);
  });

  const TUE = '2026-09-22';
  const scanned = {
    id: 'e-p', date: TUE, slot: 'breakfast', loggedAt: `${TUE}T08:00:00Z`, name: 'Skyr', method: 'barcode', barcode: '7610000000001', amount: 250, unit: 'g', grams: 250,
    macros: { kcal: 150, protein: 27, carbs: 10, fat: 0.5 }, micros: { calcium: 275, sodium: 90 },
  };
  const planEntry = { id: 'e-b', date: TUE, slot: 'lunch', loggedAt: `${TUE}T12:00:00Z`, name: 'Chili', plannedMealId: 'l', recipeId: 'chili', servings: 1, method: 'plan', macros: { kcal: 680, protein: 51, carbs: 90, fat: 9 }, micros: { fiber: 12 } };
  const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));
  const open = (label: RegExp) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => label.test(b.textContent ?? ''))!;

  for (const route of ['today', 'nutrition'] as const) {
    it(`${route === 'today' ? 'Heute' : 'Ernährung'}: micronutrients – known values with NRV reference, partial data marked, missing never shown as 0`, async () => {
      localStorage.setItem(KEY, JSON.stringify({ ...completeState(), logEntries: [scanned, planEntry] }));
      window.history.replaceState(null, '', `/#/${route}`);
      await startApp();
      // The micronutrients live in the Nährstoff-Auswertung (one place on both pages).
      await act(async () => open(/Nährstoff-Auswertung/).click());
      const row = (label: string) => container.querySelector(`[aria-label^="${label}:"]`)?.getAttribute('aria-label') ?? '';
      // Known from 1 of 2 entries: shown with its reference, marked incomplete – not rated, never presented as complete.
      expect(row('Calcium')).toBe('Calcium: 275 / 800 mg, mind. 275 mg – Daten unvollständig (ohne Bewertung)');
      expect(row('Natrium')).toMatch(/^Natrium: 90 \/ 2\.000 mg, Daten unvollständig/);
      expect(row('Vitamin C')).toBe('');
      expect(text()).toMatch(/Keine Daten: Vitamin A, Vitamin C/);
      expect(text()).not.toMatch(/Vitamin C\s*0/);
      expect(text()).toMatch(/Allgemeiner Referenzwert \(NRV\) – für alle gleich, nicht individuell berechnet/);
    });
  }

  it('Heute: large mg values read as g – value and reference in the same unit (Kalium 1,8 / 2 g)', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), logEntries: [{ ...scanned, micros: { potassium: 1800, calcium: 275 } }] }));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    await act(async () => open(/Nährstoff-Auswertung/).click());
    const row = (label: string) => container.querySelector(`[aria-label^="${label}:"]`)!.getAttribute('aria-label')!;
    expect(row('Kalium')).toMatch(/^Kalium: 1,8 \/ 2 g, Noch 200 mg/);
    expect(row('Calcium')).toMatch(/^Calcium: 275 \/ 800 mg, Noch 525 mg/);
  });

  it('Heute: timeline says gegessen / als Nächstes / später, shows real replacement cost and recipe cost ranges', async () => {
    const meals = [
      { id: 'b', date: TUE, slot: 'breakfast', recipeId: 'overnight-oats', servings: 1, status: 'skipped', source: 'suggest' },
      { id: 'l', date: TUE, slot: 'lunch', recipeId: 'chili', servings: 1, status: 'planned', source: 'suggest' },
      { id: 'd', date: TUE, slot: 'dinner', recipeId: 'bolognese', servings: 1, status: 'planned', source: 'suggest' },
    ];
    const replacement = { ...scanned, replacedMealId: 'b', costChf: 2.5 };
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), plannedMeals: meals, logEntries: [replacement] }));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    const items = [...container.querySelectorAll<HTMLButtonElement>('ol button')].map((b) => b.textContent ?? '');
    expect(items[0]).toMatch(/Frühstück · gegessen[\s\S]*Skyr[\s\S]*CHF 2\.50 · statt Protein Overnight Oats/);
    expect(items[1]).toMatch(/Mittagessen · als Nächstes[\s\S]*ca\. CHF [\d.]+–[\d.]+/);
    expect(items[2]).toMatch(/Abendessen · später/);
    expect(text()).not.toMatch(/CHF 0\.00|€/);
  });

  it('Heute: a day without micronutrient data says so in the report instead of showing zeros', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), logEntries: [planEntry] }));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    await act(async () => open(/Nährstoff-Auswertung/).click());
    // No vitamin/mineral data: listed once as "keine Daten", no empty thermometers, no fake zeros.
    expect(container.querySelector('[aria-label="Vitamine"]')!.querySelectorAll('[aria-label*=": "]')).toHaveLength(0);
    expect(container.querySelector('[aria-label="Vitamine"]')!.textContent).toMatch(/Keine Daten: Vitamin A, Vitamin C/);
    expect(text()).not.toMatch(/Vitamin C\s*0|0 \/ 80 mg/);
  });

  it('Heute: Essen erfassen → Barcode → Kamera → Produkt → Menge → Preis 4.95 CHF → Tagesbilanz + Budget', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) } });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 1, product: { product_name: 'Poulet-Brust', nutriments: { 'energy-kcal_100g': 110, proteins_100g: 23, carbohydrates_100g: 0, fat_100g: 1.5, calcium_100g: 0.01 }, product_quantity: 400, product_quantity_unit: 'g' } }), { status: 200 }),
    );
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), plannerSettings: { priority: 'balanced', weeklyBudgetChf: 55, mealTimes: { breakfast: '07:30', snack: '10:30', lunch: '12:30', dinner: '19:00' } } }));
    window.history.replaceState(null, '', '/#/today');
    const store = await startApp();
    // After startApp: the same module instance the app uses.
    const { setDecoderFactory } = await import('./services/barcodeScanner');
    setDecoderFactory(async () => ({ decode: async () => '7610000000001' }));

    // No plan today → quick add in the header → "Essen".
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Schnell erfassen"]')!.click());
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find((b) => b.textContent?.trim() === 'Essen')!.click());
    await click('Barcode');
    await click('Mit Kamera scannen');
    await settle();
    await settle();
    expect(text()).toContain('Poulet-Brust');
    await type('Menge in g', '200');
    await type('Packungspreis (400 g) – optional', '4.95');
    expect(text()).toMatch(/Deine Menge \(200 g\) ≈ CHF 2\.48/);
    await click('Hinzufügen');

    const s = store.getState();
    expect(s.logEntries).toHaveLength(1);
    expect(s.logEntries[0]).toMatchObject({ method: 'barcode', amount: 200, macros: { kcal: 220 }, costChf: 2.48, micros: { calcium: 20 } });
    expect(s.products['7610000000001']!.price).toMatchObject({ chf: 4.95, amount: 400 });
    expect(container.querySelector('[role="img"]')!.getAttribute('aria-label')).toMatch(/^220 von/);
    expect(text()).not.toMatch(/€/);
  });

  it('Ernährung: price field validates CHF and the week budget line speaks CHF', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 1, product: { product_name: 'Reis', nutriments: { 'energy-kcal_100g': 350 }, product_quantity: 1, product_quantity_unit: 'kg' } }), { status: 200 }));
    const meals = [{ id: 'l', date: TUE, slot: 'lunch', recipeId: 'chili', servings: 1, status: 'planned', source: 'suggest' }];
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), plannedMeals: meals, plannerSettings: { priority: 'balanced', weeklyBudgetChf: 55, mealTimes: { breakfast: '07:30', snack: '10:30', lunch: '12:30', dinner: '19:00' } } }));
    window.history.replaceState(null, '', '/#/nutrition');
    await startApp();
    await click('Lebensmittel hinzufügen');
    await click('Barcode');
    await type('Barcode-Nummer', '7610000000002');
    await click('Produkt suchen');
    await settle();
    await type('Packungspreis (1 kg) – optional', 'abc');
    expect(text()).toMatch(/Bitte einen Preis zwischen CHF 0.05 und CHF 1.000.– angeben./);
    expect([...container.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find((b) => b.textContent?.trim() === 'Hinzufügen')!.disabled).toBe(true);
    await act(async () => window.location.assign('#/nutrition?view=week'));
    await settle();
    expect(text()).toMatch(/Diese Woche ca\. CHF [\d.]+–[\d.]+ von CHF 55\.–/);
  });
});

describe('polish: barcode loading, remembered price, manual price', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 22, 12, 45));
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });
  afterEach(() => vi.useRealTimers());
  const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));
  const dialogButton = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find((b) => b.textContent?.trim() === label)!;

  it('while looking up: "Produkt wird gesucht …", the button is disabled and a second submit sends no second request', async () => {
    let resolve!: (r: Response) => void;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>((r) => (resolve = r)));
    localStorage.setItem(KEY, JSON.stringify(completeState()));
    window.history.replaceState(null, '', '/#/nutrition');
    await startApp();
    await click('Lebensmittel hinzufügen');
    await click('Barcode');
    await type('Barcode-Nummer', '4000000000009');
    await click('Produkt suchen');
    expect(text()).toContain('Produkt wird gesucht');
    const busy = dialogButton('Produkt wird gesucht …');
    expect(busy.disabled).toBe(true);
    await act(async () => container.querySelector('dialog[open] form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await act(async () => resolve(new Response(JSON.stringify({ status: 0 }), { status: 404 })));
    await settle();
    expect(text()).toContain('Produkt nicht gefunden');
  });

  it('a remembered price is prefilled and used, but not saved again when unchanged', async () => {
    const product = { barcode: '7610000000009', name: 'Joghurt', per100: { kcal: 80, protein: 4, carbs: 12, fat: 1.5 }, micros100: {}, unit: 'g', servingSize: 150, packageSize: 150, source: 'openfoodfacts', fetchedAt: '2026-09-01T08:00:00Z', price: { chf: 1.95, amount: 150, at: '2026-09-01T08:00:00Z' } };
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), products: { [product.barcode]: product } }));
    window.history.replaceState(null, '', '/#/nutrition');
    const store = await startApp();
    await click('Lebensmittel hinzufügen');
    await click('Barcode');
    await type('Barcode-Nummer', product.barcode);
    await click('Produkt suchen');
    await settle();
    const priceInput = [...container.querySelectorAll<HTMLLabelElement>('dialog[open] label')].find((l) => l.textContent?.startsWith('Packungspreis'))!;
    expect((document.getElementById(priceInput.htmlFor) as HTMLInputElement).value).toBe('1.95');
    await act(async () => dialogButton('Hinzufügen').click());
    const s = store.getState();
    expect(s.logEntries[0]).toMatchObject({ amount: 150, costChf: 1.95 });
    expect(s.products[product.barcode]!.price!.at).toBe('2026-09-01T08:00:00Z');
  });

  it('budget set but too little price data: "Preis nicht verfügbar" instead of a number – never 0 CHF', async () => {
    // A planned meal plus 3 kg of a scanned product without price or catalog link → below 80 % priced weight.
    const shakes = [{ id: 's', date: '2026-09-22', slot: 'breakfast', recipeId: 'skyr-bowl', servings: 1, status: 'planned', source: 'suggest' }];
    const unpriced = { id: 'u', date: '2026-09-22', slot: 'snack', loggedAt: '2026-09-22T10:00:00Z', name: 'Unbekannt', method: 'barcode', barcode: '1', grams: 3000, amount: 3000, unit: 'g', macros: { kcal: 900, protein: 10, carbs: 100, fat: 30 } };
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), plannedMeals: shakes, logEntries: [unpriced], plannerSettings: { priority: 'balanced', weeklyBudgetChf: 55, mealTimes: { breakfast: '07:30', snack: '10:30', lunch: '12:30', dinner: '19:00' } } }));
    const { weekFoodCost } = await import('./domain/week');
    window.history.replaceState(null, '', '/#/nutrition?view=week');
    const store = await startApp();
    if (weekFoodCost(store.getState(), '2026-09-21')) throw new Error('fixture has reliable prices – adjust');
    expect(text()).toMatch(/Diese Woche: Preis nicht verfügbar – zu wenig Preisdaten · Budget CHF 55\.–/);
    expect(text()).not.toMatch(/CHF 0\.– von|CHF 0\.00/);
  });

  it('manual entry with a price: cost on the entry, CHF only', async () => {
    localStorage.setItem(KEY, JSON.stringify(completeState()));
    window.history.replaceState(null, '', '/#/nutrition');
    const store = await startApp();
    await click('Lebensmittel hinzufügen');
    await click('Manuell');
    await type('Name', 'Sandwich');
    await type('Kalorien', '420');
    await type('Preis (optional)', '-3');
    await act(async () => dialogButton('Hinzufügen').click());
    expect(text()).toMatch(/Bitte einen Preis zwischen CHF 0.05 und CHF 1.000.– angeben./);
    expect(store.getState().logEntries).toHaveLength(0);
    await type('Preis (optional)', '6.90');
    await act(async () => dialogButton('Hinzufügen').click());
    expect(store.getState().logEntries[0]).toMatchObject({ name: 'Sandwich', costChf: 6.9, macros: { kcal: 420 } });
    expect(text()).not.toMatch(/€/);
  });
});

describe('Heute & Ernährung: status signals, day type, clear day options, explained suggestions', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 22, 12, 45)); // Tuesday 12:45
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });
  afterEach(() => vi.useRealTimers());

  const TUE = '2026-09-22';
  const log = (kcal: number, patch: Record<string, unknown> = {}) => ({
    id: `e-${kcal}`, date: TUE, slot: 'lunch', loggedAt: `${TUE}T12:00:00Z`, name: 'Eintrag', method: 'quick', macros: { kcal, protein: 40, carbs: 100, fat: 30 }, ...patch,
  });
  // Tuesday's target frozen at exactly 2700 kcal (zone ±270) – independent of the training-day shift.
  const plain = (patch: Record<string, unknown> = {}) => ({ ...completeState(), closedDayTargets: { [TUE]: 2700 }, ...patch });
  const go = async (route: string) =>
    act(async () => {
      window.location.hash = `#/${route}`;
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
  const badge = () => container.querySelector('[role="status"][aria-label]')?.textContent ?? '';

  it('calorie status: the same zone on Heute and Ernährung – "Im Ziel", then "deutlich darüber" in friendly words', async () => {
    localStorage.setItem(KEY, JSON.stringify(plain({ logEntries: [log(2600)] })));
    window.history.replaceState(null, '', '/#/today');
    const store = await startApp();
    expect(badge()).toMatch(/Im Ziel 🎯/);
    await go('nutrition');
    expect(badge()).toMatch(/Im Ziel 🎯/);
    // A second entry on Ernährung → both pages move to the next state at once.
    await act(async () => store.update((s) => void s.logEntries.push(log(700, { id: 'e-2' }) as never)));
    expect(badge()).toMatch(/Heute deutlich darüber.*über dem Ziel – morgen einfach normal weiter/);
    await go('today');
    expect(badge()).toMatch(/Heute deutlich darüber/);
  });

  it('Heute: a rest day is plain information, a training day links to the training', async () => {
    localStorage.setItem(KEY, JSON.stringify(completeState())); // trains Mon/Wed/Fri → Tuesday is a rest day
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    const rest = container.querySelector('[aria-label="Heute Ruhetag: Erholung"]')!;
    expect(rest.tagName).toBe('DIV');
    expect(rest.textContent).toMatch(/Ruhetag.*Erholung/);

    await act(async () => root?.unmount());
    root = undefined;
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), training: { programId: 'full-body', weekdays: [1, 3, 5] } }));
    await startApp();
    const training = container.querySelector<HTMLAnchorElement>('a[aria-label^="Heute Training:"]')!;
    expect(training.getAttribute('href')).toBe('#/training');
    expect(training.textContent).toMatch(/Training · ~\d+ min · \d+ Übungen/);
  });

  it('Ernährung: fiber, sugar and salt side by side – a missing value says "keine Daten", never 0', async () => {
    localStorage.setItem(KEY, JSON.stringify(plain({ logEntries: [log(500, { micros: { fiber: 12.4, salt: 1.84 } })] })));
    window.history.replaceState(null, '', '/#/nutrition');
    await startApp();
    const row = container.querySelector('[aria-label="Weitere Nährwerte"]')!;
    expect(row.textContent).toBe('Ballaststoffe12,4 gZuckerkeine DatenSalz1,8 g');
  });

  it('time and situation are two clear questions – no "Busy"/"Reise" synonyms any more', async () => {
    localStorage.setItem(KEY, JSON.stringify(plain({ dayContexts: { [TUE]: { timeBudget: 'normal', mode: 'busy' } } })));
    window.history.replaceState(null, '', '/#/nutrition');
    const store = await startApp();
    // A stored "Busy" day was loaded as what it meant: little time, dinner at home.
    expect(store.getState().dayContexts[TUE]).toEqual({ timeBudget: 'low', mode: 'normal' });
    const groups = [...container.querySelectorAll('[role="tablist"]')].map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual(expect.arrayContaining(['Zeit zum Kochen', 'Abendessen']));
    const dinner = container.querySelector('[role="tablist"][aria-label="Abendessen"]')!;
    expect([...dinner.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Zuhause', 'Auswärts']);
    expect(text()).not.toMatch(/Busy|Reise/);
    expect(text()).toMatch(/Nur schnelle Gerichte \(bis 15 min\)/);
  });

  it('water: a count of this week (no series to lose), and a calm moment when today is reached – same on both pages', async () => {
    const goal = { ...completeState().nutritionProfile, waterGoalMl: 2000 };
    // Sunday belongs to last week; this week: Monday reached, Tuesday not yet.
    localStorage.setItem(KEY, JSON.stringify(plain({ nutritionProfile: goal, water: { '2026-09-21': 2000, '2026-09-20': 2500, [TUE]: 1750 } })));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    expect(text()).toMatch(/Diese Woche an 1 von 2 Tagen ≥ 2 L/);
    expect(text()).not.toMatch(/in Folge/);
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="250 ml Wasser hinzufügen"]')!.click());
    expect(text()).toMatch(/Tagesziel erreicht 🎉/);
    expect(text()).toMatch(/Diese Woche an 2 von 2 Tagen ≥ 2 L/);
    await go('nutrition');
    expect(text()).toMatch(/Tagesziel erreicht 🎉/);
    expect(text()).toMatch(/Diese Woche an 2 von 2 Tagen ≥ 2 L/);
  });

  const waterDay = async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 22, 12, 0)); // Tuesday noon, nothing drunk yet
    const goal = { ...completeState().nutritionProfile, waterGoalMl: 2000 };
    // Food is covered for today – water is the simplest open thing.
    const eaten = log(3000, { slot: 'lunch', macros: { kcal: 3000, protein: 250, carbs: 300, fat: 90 } });
    localStorage.setItem(KEY, JSON.stringify(plain({ nutritionProfile: goal, water: { '2026-09-21': 2000 }, logEntries: [eaten] })));
    window.history.replaceState(null, '', '/#/today');
    return startApp();
  };
  const waterStep = () => [...container.querySelectorAll('li')].find((li) => li.textContent?.includes('Noch 2 L Wasser'));

  it('water on Heute: drunk / goal in the day goals, the reminder as next step with the same water action', async () => {
    const store = await waterDay();
    const chip = container.querySelector('[aria-label^="Wasser:"][data-done]')!;
    expect(chip.textContent).toContain('0 / 2 L');
    // Both quick water actions are right in the water block on Heute.
    expect(container.querySelector('button[aria-label="250 ml Wasser hinzufügen"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="500 ml Wasser hinzufügen"]')).not.toBeNull();
    expect(waterStep()).toBeDefined();
    await act(async () => [...waterStep()!.querySelectorAll('button')].find((b) => b.textContent === '+250 ml')!.click());
    expect(store.getState().water['2026-09-22']).toBe(250);
    expect(chip.textContent).toContain('0,25 / 2 L');
    // A drink pauses the reminder – the step steps back.
    expect([...container.querySelectorAll('li')].some((li) => li.textContent?.includes('Wasser') && li.textContent.includes('+250 ml'))).toBe(false);
  });

  it('water: "Später" pauses the reminder; "Diese Woche" shows the goal, every day and the average', async () => {
    const store = await waterDay();
    await act(async () => [...waterStep()!.querySelectorAll('button')].find((b) => b.textContent === 'Später')!.click());
    expect(waterStep()).toBeUndefined();
    expect(store.getState().coach.water?.snoozedUntil).toBeTruthy();
    const week = container.querySelector('[aria-label^="Wasser: an"]')!;
    expect(week.getAttribute('aria-label')).toBe('Wasser: an 1 von 2 Tagen erreicht');
    expect(week.textContent).toContain('Ziel 2 L pro Tag');
    expect(week.textContent).toContain('1 / 2 Tage Ziel erreicht');
    const days = () => [...week.querySelectorAll('ol li')].map((li) => li.getAttribute('aria-label'));
    expect(days().slice(0, 3)).toEqual(['Mo: 2 L – Ziel erreicht', 'Di: kein Eintrag', 'Mi: noch offen']);
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="500 ml Wasser hinzufügen"]')!.click());
    expect(days()[1]).toBe('Di: 0,5 L – Ziel nicht erreicht');
    expect(week.textContent).toMatch(/Ø 1,25 L pro Tag/);
  });

  it('dinner: decided in the week plan (Auswärts / Zuhause), shown on Einkauf and Heute – Heute has no toggle', async () => {
    const dinner = (date: string, id: string) => ({ id, date, slot: 'dinner', recipeId: 'veggie-omelette', servings: 1, status: 'planned', source: 'suggest' });
    localStorage.setItem(KEY, JSON.stringify(plain({ plannedMeals: [dinner(TUE, 'd-tue'), dinner('2026-09-23', 'd-wed')] })));
    window.history.replaceState(null, '', '/#/today');
    const store = await startApp();
    // Heute: no dinner decision here any more.
    expect(container.querySelector('[role="tablist"][aria-label="Abendessen"]')).toBeNull();

    await act(async () => window.location.assign('#/nutrition?view=week'));
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    const wed = container.querySelector('[role="tablist"][aria-label^="Abendessen Mi"]')!;
    await act(async () => [...wed.querySelectorAll('button')].find((b) => b.textContent?.includes('Auswärts'))!.click());
    expect(store.getState().plannedMeals.find((m) => m.id === 'd-wed')).toMatchObject({ status: 'skipped', skippedFor: 'eating_out' });
    expect(text()).toMatch(/Abendessen · Auswärts/);

    await go('shopping');
    expect(text()).toMatch(/Nicht auf der Liste: Mi Abendessen auswärts/);

    // Today out → Heute shows the state and where to change it.
    await go('nutrition');
    await act(async () => window.location.assign('#/nutrition?view=week'));
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    const tue = container.querySelector('[role="tablist"][aria-label^="Abendessen Di"]')!;
    await act(async () => [...tue.querySelectorAll('button')].find((b) => b.textContent?.includes('Auswärts'))!.click());
    await go('today');
    expect(text()).toMatch(/Abendessen heute auswärts · im Wochenplan ändern/);

    // Back to Zuhause: the same dinner returns, once.
    await act(async () => window.location.assign('#/nutrition?view=week'));
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    const wed2 = container.querySelector('[role="tablist"][aria-label^="Abendessen Mi"]')!;
    await act(async () => [...wed2.querySelectorAll('button')].find((b) => b.textContent?.includes('Zuhause'))!.click());
    expect(store.getState().plannedMeals.filter((m) => m.date === '2026-09-23' && m.slot === 'dinner').map((m) => [m.id, m.status])).toEqual([['d-wed', 'planned']]);
  });

  it('suggestions on Ernährung: the best dish with time, protein, kcal and why – one tap plans it', async () => {
    const breakfast = log(500, { slot: 'breakfast', macros: { kcal: 500, protein: 25, carbs: 60, fat: 15 } });
    localStorage.setItem(KEY, JSON.stringify(plain({ logEntries: [breakfast], dayContexts: { [TUE]: { timeBudget: 'low', mode: 'normal' } } })));
    window.history.replaceState(null, '', '/#/nutrition');
    const store = await startApp();
    expect(text()).toMatch(/Wenig Zeit heute · noch ca\. [\d.]+ kcal offen – passend für Mittagessen/);
    const facts = container.querySelector('[aria-label="Eckdaten"]')!.textContent!;
    expect(facts.trim()).toMatch(/^\d+ min\d+ g Protein[\d.]+ kcal/);
    expect(text()).toMatch(/Empfohlen, weil nur \d+ min – passt zu „Wenig Zeit“/);
    expect(text()).not.toMatch(/€|EUR/);
    await click('Einplanen');
    expect(store.getState().plannedMeals.some((m) => m.date === TUE && m.slot === 'lunch')).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-testid="celebration"]')!.dataset).toMatchObject({ kind: 'check', level: '1' });
  });
});

describe('own dishes, extended database, online search, feedback (Ernährung ↔ Heute)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 21, 9, 0)); // Monday 09:00
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });
  afterEach(() => vi.useRealTimers());

  const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));
  const setInput = async (input: HTMLInputElement, value: string) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  /** Sets an input found by selector the way a user types. */
  const fill = async (selector: string, value: string) => {
    const input = container.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(`Input ${selector} not found`);
    await setInput(input, value);
  };
  /** Waits (real time) until the extended database chunk is loaded and rendered. */
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 100 && !check(); i++) await settle();
  };
  const byLabel = async (label: string) => {
    await until(() => !!container.querySelector(`button[aria-label="${label}"]`));
    const b = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!b) throw new Error(`Button "${label}" not found. Screen: ${text().slice(0, 300)}`);
    await act(async () => b.click());
  };
  const gramsOf = (name: string) => [...container.querySelectorAll('label')].find((l) => l.textContent?.startsWith(`${name}: Menge in g`))!.querySelector('input')!;
  const toast = () => document.body.textContent ?? '';

  it('create a dish from ingredients (catalog + database), log a portion, edit it later – the logged entry stays as it was', async () => {
    localStorage.setItem(KEY, JSON.stringify(completeState()));
    window.history.replaceState(null, '', '/#/nutrition');
    const store = await startApp();

    await click('Lebensmittel hinzufügen');
    await click('Manuell');
    expect(text()).toMatch(/Meine Gerichte/);
    await click('Eigenes Gericht erstellen');
    await type('Name', 'Melonen-Sandwich');
    // The ingredient search is open for a new dish.
    await fill('input[placeholder^="Zutat suchen"]', 'Feta');
    await byLabel('Feta als Zutat hinzufügen');
    await click('Zutat hinzufügen');
    await fill('input[placeholder^="Zutat suchen"]', 'Wassermelone');
    await settle(); // the extended database loads on demand
    await byLabel('Wassermelone als Zutat hinzufügen');
    await setInput(gramsOf('Feta'), '80');
    // Live values: 80 g feta (208 kcal) + 100 g watermelon (30 kcal) = 238 kcal for the one portion.
    expect(container.querySelector('[aria-label="Nährwerte des Gerichts"]')!.textContent).toMatch(/238\s*kcal/);

    await clickInDialog('Speichern');
    // Saving feels like saving: the dish celebration (level 2).
    expect(document.querySelector<HTMLElement>('[data-testid="celebration"]')!.textContent).toMatch(/Gericht gespeichertAb jetzt mit einem Tipp erfassbar/);
    const dish = Object.values(store.getState().customDishes)[0]!;
    expect(dish).toMatchObject({ name: 'Melonen-Sandwich', portions: 1 });
    expect(dish.ingredients.map((i) => [i.name, i.grams, i.source])).toEqual([
      ['Feta', 80, 'catalog'],
      ['Wassermelone', 100, 'database'],
    ]);
    // Straight to the portion step: add one portion.
    await clickInDialog('Hinzufügen');
    const entry = store.getState().logEntries[0]!;
    expect(entry).toMatchObject({ name: 'Melonen-Sandwich', method: 'dish', dishId: dish.id, servings: 1, macros: { kcal: 238 } });
    expect(toast()).toMatch(/Melonen-Sandwich erfasst/);
    // The day shows it at once (same store).
    expect(text()).toMatch(/238\s*\/\s*[\d.]+ kcal/);
    expect(text()).toMatch(/Mein Gericht/);

    // Edit later: 160 g feta. The already logged entry does not change.
    await click('Lebensmittel hinzufügen');
    await click('Manuell');
    await click('Melonen-Sandwich');
    await click('Gericht bearbeiten');
    await setInput(gramsOf('Feta'), '160');
    await clickInDialog('Speichern');
    expect(store.getState().customDishes[dish.id]!.ingredients[0]!.grams).toBe(160);
    expect(store.getState().logEntries[0]).toEqual(entry);
    expect(text()).toMatch(/446\s*kcal/); // the portion step now shows the edited dish

    // Delete: the dish is gone, the eaten entry stays.
    await click('Gericht bearbeiten');
    await click('Gericht löschen');
    expect(store.getState().customDishes).toEqual({});
    expect(store.getState().logEntries).toEqual([entry]);
  });

  it('Suchen finds database foods (FoodData Central) – logged with their source, visible on Heute at once', async () => {
    localStorage.setItem(KEY, JSON.stringify(completeState()));
    window.history.replaceState(null, '', '/#/nutrition');
    const store = await startApp();
    await click('Lebensmittel hinzufügen');
    await click('Suchen');
    await fill('input[placeholder^="z. B. Birne"]', 'birne');
    await until(() => /Datenbank/.test(text()));
    expect(text()).toMatch(/Birne\s*Datenbank 57 kcal/);
    await click('Birne');
    expect(text()).toMatch(/USDA FoodData Central .*169118/);
    await clickInDialog('Hinzufügen');
    expect(store.getState().logEntries[0]).toMatchObject({ name: 'Birne', method: 'food', fdc: 169118, grams: 100, macros: { kcal: 57 } });
    expect(store.getState().logEntries[0]!.foodId).toBeUndefined();

    await act(async () => {
      window.location.hash = '#/today';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(container.querySelector('[role="img"]')!.getAttribute('aria-label')).toMatch(/^57 von/);
  });

  it('branded products online only on a tap; offline says so and local results keep working', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    localStorage.setItem(KEY, JSON.stringify(completeState()));
    window.history.replaceState(null, '', '/#/nutrition');
    await startApp();
    await click('Lebensmittel hinzufügen');
    await click('Suchen');
    await fill('input[placeholder^="z. B. Birne"]', 'skyr');
    await settle();
    expect(fetchSpy).not.toHaveBeenCalled(); // typing never goes online
    expect(text()).toMatch(/Skyr natur/);
    await click('Markenprodukte online suchen');
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toMatch(/search_terms=skyr/);
    expect(text()).toMatch(/Keine Verbindung – die Online-Suche braucht Internet/);
    expect(text()).toMatch(/Skyr natur/);
  });

  it('feedback after logging comes from the real values – a protein-rich food gets the protein celebration', async () => {
    localStorage.setItem(KEY, JSON.stringify(completeState()));
    window.history.replaceState(null, '', '/#/nutrition');
    await startApp();
    await click('Lebensmittel hinzufügen');
    await click('Suchen');
    await fill('input[placeholder^="z. B. Birne"]', 'Hähnchenbrust');
    await click('Hähnchenbrust');
    await clickInDialog('Hinzufügen');
    // The undo toast stays short; the ONE feedback line is the celebration chip – a protein 'power' moment, level 2.
    expect(toast()).toMatch(/Hähnchenbrust erfasst/);
    const chip = document.querySelector<HTMLElement>('[data-testid="celebration"]')!;
    expect(chip.textContent).toBe('💪Protein-Boost · +24 gnoch 137 g bis zum Tagesziel');
    expect(chip.dataset).toMatchObject({ kind: 'power', level: '2' });
  });

  it('water bottles fill through a transform (animatable) – the level is the data', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), nutritionProfile: { ...completeState().nutritionProfile, waterGoalMl: 2000 }, water: { '2026-09-21': 375 } }));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    const levels = [...container.querySelectorAll<SVGRectElement>('[aria-label^="Wasser: 250 ml"] rect')].map((r) => r.style.transform);
    expect(levels.slice(0, 3)).toEqual(['scaleY(1)', 'scaleY(0.5)', 'scaleY(0)']);
  });
});

describe('gamification loop on Heute and Ernährung (action → reaction → progress → feedback → goal)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 22, 12, 45)); // Tuesday 12:45
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });
  afterEach(async () => {
    vi.useRealTimers();
    const { dismissCelebration } = await import('./lib/celebrate');
    dismissCelebration();
  });

  const TUE = '2026-09-22';
  const chip = () => document.querySelector<HTMLElement>('[data-testid="celebration"]');
  const ring = () => container.querySelector<HTMLElement>('[role="img"][data-impact]')!;
  const quickLog = (id: string, date: string, kcal: number, protein: number) => ({ id, date, slot: 'lunch', loggedAt: `${date}T12:00:00Z`, name: 'Eintrag', method: 'quick', macros: { kcal, protein, carbs: 100, fat: 30 } });
  const withGoal = (patch: Record<string, unknown> = {}) => ({
    ...completeState(),
    closedDayTargets: { [TUE]: 2700 },
    nutritionProfile: { ...completeState().nutritionProfile, waterGoalMl: 2000 },
    ...patch,
  });

  it('"Gegessen" on the next-action card: the ring takes the impact, the timeline check snaps in, the card sets in the next action', async () => {
    const lunch = { id: 'l', date: TUE, slot: 'lunch', recipeId: 'bolognese', servings: 1, status: 'planned', source: 'suggest' };
    const dinner = { id: 'd', date: TUE, slot: 'dinner', recipeId: 'chili', servings: 1, status: 'planned', source: 'suggest' };
    localStorage.setItem(KEY, JSON.stringify(withGoal({ plannedMeals: [lunch, dinner] })));
    window.history.replaceState(null, '', '/#/today');
    const store = await startApp();
    expect(ring().dataset.impact).toBe('0'); // nothing animates on arrival
    await act(() => new Promise((r) => setTimeout(r, 450))); // a person looks before tapping (elements appearing later animate in)
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Nächste Aktion"] button:not([aria-label])')!.click());
    expect(store.getState().plannedMeals.find((m) => m.id === 'l')!.status).toBe('eaten');
    expect(ring().dataset.impact).toBe('1');
    const eatenMark = [...container.querySelectorAll('ol li button')].find((b) => b.textContent?.includes('Bolognese'))!.querySelector('[class*="doneMark"]')!;
    expect(eatenMark.className).toMatch(/snap/);
    // The next action changed (here: shopping comes first) – it is set in, not just swapped.
    const next = container.querySelector('[aria-label="Nächste Aktion"]')!;
    expect(next.textContent).not.toMatch(/Mittagessen/);
    expect(next.className).toMatch(/enter/);
  });

  it('water: the filled bottle waves, the goal crossing celebrates (level 3) and the row bounces', async () => {
    localStorage.setItem(KEY, JSON.stringify(withGoal({ water: { [TUE]: 1500 } })));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="250 ml Wasser hinzufügen"]')!.click());
    expect(container.querySelectorAll('[aria-label^="Wasser: 250 ml"] path[class*="bottleWave"]')).toHaveLength(1);
    // A normal glass: the small water boost (level 1) – same chip system as protein and fiber.
    expect(chip()!.dataset).toMatchObject({ kind: 'water', level: '1' });
    expect(chip()!.textContent).toBe('💧Hydration-Boost · +250 mlnoch 0,25 L bis zum Ziel');
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="250 ml Wasser hinzufügen"]')!.click());
    expect(chip()!.dataset).toMatchObject({ kind: 'water', level: '3' });
    expect(chip()!.textContent).toMatch(/Wasserziel erreicht2 L heute/);
    expect(container.querySelector('[aria-label^="Wasser: 250 ml"]')!.className).toMatch(/waterWin/);
    // Taking water back: level goes down, no celebration, no "negative" animation.
    await act(async () => (await import('./lib/celebrate')).dismissCelebration());
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="250 ml weniger"]')!.click());
    expect(chip()).toBeNull();
  });

  it('water: three quarters of the own goal is its own milestone ("Tagesziel fast geschafft", level 2)', async () => {
    localStorage.setItem(KEY, JSON.stringify(withGoal({ water: { [TUE]: 1250 } })));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="250 ml Wasser hinzufügen"]')!.click());
    expect(chip()!.dataset).toMatchObject({ kind: 'water', level: '2' });
    expect(chip()!.textContent).toBe('💧Tagesziel fast geschafftnoch 0,5 L · Hydration-Boost +250 ml');
  });

  it('timeline: a long-past open meal is "noch offen", a skipped one is marked and does not count', async () => {
    const breakfast = { id: 'b', date: TUE, slot: 'breakfast', recipeId: 'overnight-oats', servings: 1, status: 'planned', source: 'suggest' };
    const lunch = { id: 'l', date: TUE, slot: 'lunch', recipeId: 'bolognese', servings: 1, status: 'skipped', source: 'suggest' };
    const dinner = { id: 'd', date: TUE, slot: 'dinner', recipeId: 'chili', servings: 1, status: 'planned', source: 'suggest' };
    localStorage.setItem(KEY, JSON.stringify(withGoal({ plannedMeals: [breakfast, lunch, dinner] })));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    const state = (s: string) => container.querySelector<HTMLElement>(`ol [data-state="${s}"]`);
    expect(state('overdue')!.textContent).toMatch(/Frühstück · noch offen/);
    expect(state('skipped')!.textContent).toMatch(/Mittagessen · übersprungen/);
    expect(state('skipped')!.textContent).toMatch(/zählt nicht in die Tagesbilanz/);
    // The next meal is the first one still ahead – not the forgotten breakfast.
    expect(state('next')!.textContent).toMatch(/Abendessen/);
  });

  it('"Alles erledigt": a clear protein gap is named as a hint, a small one is not', async () => {
    // Everything of the day is done (a rest day, nothing planned left).
    const eaten = (['breakfast', 'lunch', 'dinner'] as const).map((slot) => ({ id: slot, date: TUE, slot, recipeId: 'chili', servings: 1, status: 'eaten', source: 'suggest' }));
    localStorage.setItem(KEY, JSON.stringify(withGoal({ plannedMeals: eaten, logEntries: [quickLog('q', TUE, 1500, 100)] })));
    window.history.replaceState(null, '', '/#/today');
    const store = await startApp();
    const next = () => container.querySelector('[aria-label="Nächste Aktion"]')!.textContent!;
    expect(next()).toMatch(/Alles erledigt ✓/);
    expect(next()).toMatch(/Noch 60 g Protein bis zum Tagesziel\./);
    // 5 g short is noise – no line.
    await act(async () => store.update((s) => void s.logEntries.push(quickLog('q2', TUE, 300, 55) as never)));
    expect(next()).toMatch(/Alles erledigt ✓/);
    expect(next()).not.toMatch(/Protein/);
  });

  it('budget: Heute and the Ernährung day view show what today costs next to a seventh of the week budget (CHF)', async () => {
    const meals = [
      { id: 'l', date: TUE, slot: 'lunch', recipeId: 'chili', servings: 1, status: 'planned', source: 'suggest' },
      { id: 'w', date: '2026-09-23', slot: 'lunch', recipeId: 'chili', servings: 1, status: 'planned', source: 'suggest' },
    ];
    const settings = { priority: 'balanced', weeklyBudgetChf: 70, mealTimes: { breakfast: '07:30', snack: '10:30', lunch: '12:30', dinner: '19:00' } };
    localStorage.setItem(KEY, JSON.stringify(withGoal({ plannedMeals: meals, plannerSettings: settings })));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    expect(text()).toMatch(/Heute ca\. CHF [\d.]+–[\d.]+ · Tagesanteil CHF 10\.–/);
    await act(async () => window.location.assign('#/nutrition'));
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(text()).toMatch(/Heute ca\. CHF [\d.]+–[\d.]+ · Tagesanteil CHF 10\.–/);
    expect(text()).not.toMatch(/€|EUR|USD|GBP/);
  });

  it('day goals close one by one; the last one completes the day – the biggest moment (level 4); consistency is a count ("Erfasst an 2 von 2 Tagen")', async () => {
    const logs = [quickLog('y1', '2026-09-21', 2600, 150), quickLog('y2', '2026-09-20', 2500, 140), quickLog('t', TUE, 2650, 170)];
    localStorage.setItem(KEY, JSON.stringify(withGoal({ logEntries: logs, water: { [TUE]: 1750 } })));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    const goals = () => container.querySelector('[aria-label="Tagesziele"]')!;
    expect(goals().textContent).toMatch(/^Tagesziele 2 \/ 3/);
    expect(text()).not.toMatch(/Tage dabei/);
    expect(container.querySelector('[aria-label="Diese Woche"] [aria-label="Erfasst: 2 von 2 Tagen"]')).toBeTruthy();
    expect([...goals().querySelectorAll('li')].map((li) => li.getAttribute('data-done'))).toEqual(['true', 'true', 'false']);
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="250 ml Wasser hinzufügen"]')!.click());
    expect(goals().textContent).toMatch(/^Tag abgeschlossen ✨/);
    expect(chip()!.dataset).toMatchObject({ kind: 'day', level: '4' });
    expect(chip()!.textContent).toMatch(/Tag abgeschlossen/);
    expect(goals().className).toMatch(/dayGoalsFinish/);
  });

  it('the ring turns calmly amber above the zone – never a red "error"', async () => {
    localStorage.setItem(KEY, JSON.stringify(withGoal({ logEntries: [quickLog('t', TUE, 3300, 150)] })));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    expect(ring().dataset.tone).toBe('over');
    expect(ring().querySelector('circle[class*="ringValue"]')!.getAttribute('stroke')).toBe('var(--carbs)');
  });

  it('Ernährung: logging updates the day total with a bump and the macros glide; the protein goal crossing pulses the protein column', async () => {
    localStorage.setItem(KEY, JSON.stringify(withGoal({ logEntries: [quickLog('t', TUE, 1500, 150)] })));
    window.history.replaceState(null, '', '/#/nutrition');
    const store = await startApp();
    await act(async () => store.update((s) => void s.logEntries.push(quickLog('t2', TUE, 200, 20) as never)));
    expect(container.querySelector('[class*="numberBump"]')!.textContent).toBe('1.700');
    const protein = [...container.querySelectorAll('[aria-label="Makros"] > div')][0]!;
    expect(protein.className).toMatch(/macroPower/);
    expect(protein.textContent).toMatch(/Protein ✓170 \/ 160 g/);
  });
});

describe('must-haves: "Wie gestern", "Was kann ich kochen?", training → nutrition', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 22, 7, 30)); // Tuesday 07:30
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });
  afterEach(() => vi.useRealTimers());

  const MON = '2026-09-21';
  const TUE = '2026-09-22';

  it('"Wie gestern": yesterday\'s breakfast in one tap – today\'s planned breakfast is replaced, not counted twice; undo restores all', async () => {
    const yesterday = { id: 'y', date: MON, slot: 'breakfast', loggedAt: `${MON}T08:00:00Z`, name: 'Bananen', foodId: 'banana', grams: 120, method: 'food', macros: { kcal: 112, protein: 1.4, carbs: 24, fat: 0.2 } };
    const planned = { id: 'p', date: TUE, slot: 'breakfast', recipeId: 'overnight-oats', servings: 1, status: 'planned', source: 'suggest' };
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), plannedMeals: [planned], logEntries: [yesterday] }));
    window.history.replaceState(null, '', '/#/nutrition');
    const store = await startApp();
    await click('Lebensmittel hinzufügen'); // breakfast, "Vorschlag" opens first
    expect(text()).toMatch(/Wie gesternBananen112 kcal · 1 g Protein/);
    await click('Übernehmen');
    const s = store.getState();
    expect(s.plannedMeals.find((m) => m.id === 'p')!.status).toBe('skipped');
    const copy = s.logEntries.find((e) => e.date === TUE)!;
    expect(copy).toMatchObject({ name: 'Bananen', foodId: 'banana', grams: 120, slot: 'breakfast', replacedMealId: 'p', macros: yesterday.macros });
    expect(s.logEntries.filter((e) => e.date === TUE)).toHaveLength(1);
    await click('Rückgängig');
    expect(store.getState().logEntries.filter((e) => e.date === TUE)).toEqual([]);
    expect(store.getState().plannedMeals.find((m) => m.id === 'p')!.status).toBe('planned');
  });

  it('"Was kann ich kochen?": the pantry is preselected, recipes come ranked, one tap plans it and the missing items go on the shopping list', async () => {
    const at = `${MON}T08:00:00Z`;
    const pantry = Object.fromEntries(['egg', 'spinach', 'feta', 'tomato', 'onion'].map((id) => [id, { foodId: id, quantityG: 400, updatedAt: at }]));
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), pantry }));
    window.history.replaceState(null, '', '/#/nutrition');
    const store = await startApp();
    await click('Was kann ich kochen?');
    const choices = container.querySelector('[aria-label="Zutaten zuhause"]')!;
    // Exactly the pantry foods are preselected.
    expect([...choices.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent).sort()).toEqual(['Blattspinat (TK)', 'Eier', 'Feta', 'Tomaten', 'Zwiebeln']);
    const list = container.querySelector('[aria-label="Passende Rezepte"]')!;
    const first = list.querySelector('li')!;
    const title = first.querySelector('[class*="mealTitle"]')!.textContent!;
    expect(first.textContent).toMatch(/Zutaten da|Alle Zutaten da ✓/);
    await act(async () => [...first.querySelectorAll('button')].find((b) => b.textContent === 'Einplanen')!.click());
    const recipe = (await import('./data/recipes')).RECIPES.find((r) => r.title === title)!;
    const meal = store.getState().plannedMeals.find((m) => m.date === TUE && m.recipeId === recipe.id);
    expect(meal).toBeDefined();
    // Plan → shopping: what is not at home is on the list, what is at home is not bought again.
    const { weekShopping } = await import('./domain/week');
    const shopping = weekShopping(store.getState(), '2026-09-21', TUE).filter((i) => i.state === 'open').map((i) => i.foodId);
    for (const ing of recipe.ingredients) if (!pantry[ing.foodId]) expect(shopping).toContain(ing.foodId);
    expect(document.querySelector<HTMLElement>('[data-testid="celebration"]')!.textContent).toMatch(/Eingeplant/);
  });

  it('Heute: one prioritized next step – the day\'s gap; right after training it answers the session (same engine)', async () => {
    const plain = { ...completeState(), training: { programId: 'full-body', weekdays: [1, 3, 5] } };
    localStorage.setItem(KEY, JSON.stringify(plain));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    const step = () => [...container.querySelectorAll('h2')].find((h) => h.textContent === 'Dein nächster sinnvoller Schritt')?.closest('section, div[class*="card"]') ?? null;
    expect(step()!.textContent).toMatch(/Heute fehlen noch [\d.]+ kcal und \d+ g Protein/);
    expect(step()!.querySelectorAll('li[class*="item"]')).toHaveLength(1); // one step, not a list of warnings
    await act(async () => root?.unmount());
    root = undefined;
    // Finished 07:00 local time, now 07:30.
    const workout = { id: 'w', date: TUE, templateId: 'fb-a', name: 'Ganzkörper A', startedAt: `${TUE}T06:00:00`, endedAt: `${TUE}T07:00:00`, status: 'completed', exercises: [] };
    localStorage.setItem(KEY, JSON.stringify({ ...plain, workouts: [workout] }));
    await startApp();
    expect(step()!.textContent).toMatch(/Nach dem Training: noch [\d.]+ kcal und \d+ g Protein/);
  });
});

describe('Nährstoff-Auswertung and the nutrition week plan', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 22, 12, 45)); // Tuesday 12:45
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });
  afterEach(() => vi.useRealTimers());

  const MON = '2026-09-21';
  const TUE = '2026-09-22';
  const log = (patch: Record<string, unknown>) => ({ id: `e${Math.random()}`, date: TUE, slot: 'lunch', loggedAt: `${TUE}T12:00:00Z`, name: 'Eintrag', method: 'manual', macros: { kcal: 0, protein: 0, carbs: 0, fat: 0 }, ...patch });
  const withGoal = (patch: Record<string, unknown> = {}) => ({
    ...completeState(),
    closedDayTargets: { [TUE]: 2700, [MON]: 2700 },
    nutritionProfile: { ...completeState().nutritionProfile, waterGoalMl: 2000 },
    ...patch,
  });
  const row = (label: string) => document.querySelector(`dialog[open] [aria-label^="${label}:"]`)?.getAttribute('aria-label') ?? '';

  it('Ernährung: the entry shows the most important hint; the report explains the day with thermometers, words and a next step', async () => {
    const entries = [log({ macros: { kcal: 1500, protein: 90, carbs: 150, fat: 50 }, micros: { salt: 6.2, fiber: 14, sugar: 40, vitaminC: 95, calcium: 300 } })];
    localStorage.setItem(KEY, JSON.stringify(withGoal({ logEntries: entries, water: { [TUE]: 1000 } })));
    window.history.replaceState(null, '', '/#/nutrition');
    const store = await startApp();
    // The main page stays compact: one line with the alert, not a wall of values.
    expect(container.querySelector('[class*="reportEntry"]')!.textContent).toMatch(/Nährstoff-AuswertungSalz: über dem empfohlenen Bereich/);
    await click('Nährstoff-Auswertung');
    const summary = document.querySelector('dialog[open] [aria-label="Zusammenfassung"]')!.textContent!;
    expect(summary).toMatch(/Salz bereits über dem empfohlenen Bereich\./);
    expect(summary).toMatch(/Protein: noch 70 g bis zum Ziel\./);
    // Three kinds, three ratings.
    expect(row('Protein')).toBe('Protein: 90 / 160 g, Noch 70 g (beobachten)'); // minimum, open
    expect(row('Salz')).toBe('Salz: 6,2 / 5 g, über dem empfohlenen Bereich (außerhalb)'); // upper limit
    expect(row('Vitamin C')).toBe('Vitamin C: 95 / 80 mg, Im Zielbereich (im Bereich)'); // more is not "better", just reached
    expect(row('Ballaststoffe')).toMatch(/^Ballaststoffe: 14 \/ 38 g, Noch 24 g/); // 14 g per 1000 kcal of 2700
    expect(row('Wasser')).toBe('Wasser: 1 / 2 L, Noch 1 L (beobachten)');
    expect(document.querySelector('dialog[open]')!.textContent).toMatch(/Keine Daten: Vitamin A/);
    // Next step from the data: water right here (same boost system).
    await clickInDialog('+250 ml Wasser');
    expect(store.getState().water[TUE]).toBe(1250);
    expect(document.querySelector<HTMLElement>('[data-testid="celebration"]')!.textContent).toMatch(/Hydration-Boost · \+250 ml/);
    expect(row('Wasser')).toBe('Wasser: 1,25 / 2 L, Noch 0,75 L (beobachten)');
  });

  it('every thermometer says what its reference is (Tagesziel, Obergrenze, Referenz (NRV) …)', async () => {
    const entries = [log({ macros: { kcal: 1500, protein: 90, carbs: 150, fat: 50 }, micros: { salt: 3, fiber: 14, sugar: 40, vitaminC: 95 } })];
    localStorage.setItem(KEY, JSON.stringify(withGoal({ logEntries: entries, water: { [TUE]: 1000 } })));
    window.history.replaceState(null, '', '/#/nutrition');
    await startApp();
    await click('Nährstoff-Auswertung');
    const tag = (label: string) => document.querySelector(`dialog[open] [aria-label^="${label}:"] [class*="tag"]`)?.textContent;
    expect(tag('Protein')).toBe('Tagesziel');
    expect(tag('Ballaststoffe')).toBe('Mindestwert');
    expect(tag('Salz')).toBe('Obergrenze');
    expect(tag('Zucker')).toBe('Orientierungswert');
    expect(tag('Vitamin C')).toBe('Referenz (NRV)');
    expect(tag('Wasser')).toBe('Dein Ziel');
  });

  it('Heute has the same entry (one report for both pages)', async () => {
    localStorage.setItem(KEY, JSON.stringify(withGoal({ logEntries: [log({ macros: { kcal: 800, protein: 60, carbs: 80, fat: 20 } })] })));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    await click('Nährstoff-Auswertung');
    expect(row('Kalorien')).toMatch(/^Kalorien: 800 \/ 2\.700 kcal, Noch 1\.900 kcal/);
  });

  it('week plan: one card per day – today highlighted, training/rest tag, eaten count, kcal/protein bars; past days fold', async () => {
    const meals = [
      { id: 'm1', date: MON, slot: 'lunch', recipeId: 'chili', servings: 1, status: 'eaten', source: 'suggest' },
      { id: 't1', date: TUE, slot: 'lunch', recipeId: 'bolognese', servings: 1, status: 'eaten', source: 'suggest' },
      { id: 't2', date: TUE, slot: 'dinner', recipeId: 'chili', servings: 1, status: 'planned', source: 'suggest' },
    ];
    localStorage.setItem(KEY, JSON.stringify(withGoal({ plannedMeals: meals })));
    window.history.replaceState(null, '', '/#/nutrition?view=week');
    await startApp();
    const cards = [...container.querySelectorAll('[class*="weekDay_"]')].filter((c) => c.querySelector('[class*="weekDayHead"]'));
    expect(cards).toHaveLength(7);
    const mon = cards[0]!;
    const tue = cards[1]!;
    expect(tue.className).toMatch(/weekDayToday/);
    expect(tue.textContent).toMatch(/Di\s*Heute/);
    expect(tue.textContent).toMatch(/1 \/ 2 gegessen/);
    expect(tue.textContent).toMatch(/kcal[\d.]+ \/ [\d.]+/);
    expect(tue.textContent).toMatch(/🌿 Ruhetag/); // trains Mon/Wed/Fri
    expect(mon.textContent).toMatch(/🏋️/);
    // Monday is past: folded to its summary, expandable.
    expect(mon.querySelector('[class*="weekDayMeals"]')).toBeNull();
    await act(async () => mon.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!.click());
    expect(mon.querySelector('[class*="weekDayMeals"]')!.textContent).toMatch(/Chili/);
  });
});

describe('personal products, CHF prices and own dishes in the planner (UI)', () => {
  const OFF = {
    status: 1,
    product: { product_name: 'Haferflocken fein', brands: 'M-Classic', nutriments: { 'energy-kcal_100g': 370, proteins_100g: 13, carbohydrates_100g: 59, fat_100g: 7 }, product_quantity: 500, product_quantity_unit: 'g' },
  };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 21, 9, 0)); // Monday 09:00
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });
  afterEach(() => vi.useRealTimers());
  const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));
  const setField = async (labelStart: string, value: string) => {
    const lbl = [...document.querySelectorAll('dialog[open] label')].find((l) => l.textContent?.startsWith(labelStart));
    const input = (lbl && (document.getElementById((lbl as HTMLLabelElement).htmlFor) as HTMLInputElement | null)) ?? lbl?.querySelector('input');
    if (!input) throw new Error(`Field ${labelStart} not found`);
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const byLabel = async (label: string) => {
    const b = document.querySelector<HTMLButtonElement>(`dialog[open] button[aria-label="${label}"]`);
    if (!b) throw new Error(`Button ${label} not found`);
    await act(async () => b.click());
  };

  it('barcode → CHF pack price → "Meine Produkte" → edit → one pack into the pantry → rescan is recognised without a request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(OFF), { status: 200 }));
    localStorage.setItem(KEY, JSON.stringify(completeState()));
    window.history.replaceState(null, '', '/#/nutrition');
    const store = await startApp();
    await click('Lebensmittel hinzufügen');
    await click('Barcode');
    await type('Barcode-Nummer', '7610000000011');
    await click('Produkt suchen');
    await settle();
    await setField('Packungspreis', '4.49');
    await clickInDialog('Hinzufügen');
    expect(store.getState().products['7610000000011']!.price).toMatchObject({ chf: 4.49, amount: 500 });

    await click('Lebensmittel hinzufügen');
    await click('Manuell');
    const library = document.querySelector('dialog[open] [aria-label="Meine Produkte"]')!;
    expect(library.textContent).toMatch(/Haferflocken feinM-Classic · 500 g · CHF 4\.49/);
    expect(library.textContent).not.toMatch(/€|EUR|USD/);
    await byLabel('Haferflocken fein bearbeiten');
    await setField('Packungspreis', '3.95');
    await clickInDialog('Speichern');
    expect(store.getState().products['7610000000011']!.price).toMatchObject({ chf: 3.95, amount: 500 });
    await click('Lebensmittel hinzufügen');
    await click('Manuell');
    await byLabel('Haferflocken fein bearbeiten');
    await clickInDialog('1 Packung in den Vorrat');
    // No catalog link → the pantry keeps it as the product itself (one product model, one pantry).
    expect(store.getState().pantry['product:7610000000011']!.quantityG).toBe(500);

    // Scanning it again: known from the local cache – no second request, the user's pack and price are shown.
    await click('Lebensmittel hinzufügen');
    await click('Barcode');
    await type('Barcode-Nummer', '7610000000011');
    await click('Produkt suchen');
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(document.querySelector('dialog[open]')!.textContent).toMatch(/✓ Bekanntes Produkt · M-Classic · 500 g · CHF 3\.95/);
  });

  it('removing the price and deleting a product; eaten entries keep their values', async () => {
    const product = { barcode: '1', name: 'Skyr', per100: { kcal: 63, protein: 11, carbs: 4, fat: 0.2 }, micros100: {}, unit: 'g', packageSize: 450, price: { chf: 1.95, amount: 450, at: '2026-09-20T08:00:00Z' }, source: 'openfoodfacts', fetchedAt: '2026-09-20T08:00:00Z' };
    const entry = { id: 'e', date: '2026-09-21', slot: 'breakfast', loggedAt: '2026-09-21T08:00:00Z', name: 'Skyr', barcode: '1', grams: 150, method: 'barcode', macros: { kcal: 95, protein: 16.5, carbs: 6, fat: 0.3 }, costChf: 0.65 };
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), products: { '1': product }, logEntries: [entry] }));
    window.history.replaceState(null, '', '/#/nutrition');
    const store = await startApp();
    await click('Lebensmittel hinzufügen');
    await click('Manuell');
    await byLabel('Skyr bearbeiten');
    await clickInDialog('Preis entfernen');
    expect(store.getState().products['1']!.price).toBeUndefined();
    await clickInDialog('Produkt löschen');
    expect(store.getState().products['1']).toBeUndefined();
    expect(store.getState().logEntries[0]).toEqual(entry);
  });

  it('own dish offered to the planner: meal slots in the editor; deleting a planned dish archives it (history stays)', async () => {
    localStorage.setItem(KEY, JSON.stringify(completeState()));
    window.history.replaceState(null, '', '/#/nutrition');
    const store = await startApp();
    await click('Lebensmittel hinzufügen');
    await click('Manuell');
    await click('Eigenes Gericht erstellen');
    await type('Name', 'Chicken-Reis-Bowl');
    const fill = async (value: string) => {
      const input = document.querySelector<HTMLInputElement>('dialog[open] input[placeholder^="Zutat suchen"]')!;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      await act(async () => {
        set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    await fill('Hähnchenbrust');
    await byLabel('Hähnchenbrust als Zutat hinzufügen');
    await click('Zutat hinzufügen');
    await fill('Basmatireis');
    await byLabel('Basmatireis als Zutat hinzufügen');
    const slots = document.querySelector('dialog[open] [aria-label="Im Wochenplan vorschlagen für"]')!;
    await act(async () => [...slots.querySelectorAll('button')].find((b) => b.textContent?.includes('Mittagessen'))!.click());
    expect(document.querySelector('dialog[open]')!.textContent).toMatch(/Der Planer schlägt es für diese Mahlzeiten vor/);
    await clickInDialog('Speichern');
    const dish = Object.values(store.getState().customDishes)[0]!;
    expect(dish).toMatchObject({ name: 'Chicken-Reis-Bowl', slots: ['lunch'], prepMin: 15 });
    const { getRecipe } = await import('./data/recipes');
    expect(getRecipe(`dish:${dish.id}`)).toMatchObject({ title: 'Chicken-Reis-Bowl', personal: true });

    // Planned (past and future), then deleted: archived, the future plan entry is removed, the past one stays readable.
    const { update } = store;
    await act(async () =>
      update((s) => {
        s.plannedMeals.push({ id: 'past', date: '2026-09-20', slot: 'lunch', recipeId: `dish:${dish.id}`, servings: 1, status: 'eaten', source: 'user' });
        s.plannedMeals.push({ id: 'next', date: '2026-09-23', slot: 'lunch', recipeId: `dish:${dish.id}`, servings: 1, status: 'planned', source: 'user' });
      }),
    );
    const { deleteDish } = await import('./store/actions');
    await act(async () => void deleteDish(dish.id));
    expect(store.getState().customDishes[dish.id]).toMatchObject({ archived: true });
    expect(store.getState().plannedMeals.map((m) => m.id)).toEqual(['past']);
    expect(getRecipe(`dish:${dish.id}`)!.title).toBe('Chicken-Reis-Bowl');
  });

  it('"Als Gericht speichern" on an eaten meal opens the editor prefilled with what was eaten', async () => {
    const entry = { id: 'e', date: '2026-09-21', slot: 'breakfast', loggedAt: '2026-09-21T08:00:00Z', name: 'Bananen', foodId: 'banana', grams: 120, method: 'food', macros: { kcal: 112, protein: 1.4, carbs: 24, fat: 0.2 } };
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), logEntries: [entry] }));
    window.history.replaceState(null, '', '/#/nutrition');
    const store = await startApp();
    await click('Als Gericht speichern');
    expect(document.querySelector('dialog[open] [aria-label="Zutaten"]')!.textContent).toMatch(/Bananen/);
    await type('Name', 'Bananen-Snack');
    await clickInDialog('Speichern');
    expect(Object.values(store.getState().customDishes)[0]).toMatchObject({ name: 'Bananen-Snack', slots: ['breakfast'], ingredients: [{ name: 'Bananen', grams: 120, foodId: 'banana' }] });
  });
});

describe('hardening: product corrections, origin, skipped parts (UI)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 21, 9, 0));
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });
  afterEach(() => vi.useRealTimers());
  const setField = async (labelStart: string, value: string) => {
    const lbl = [...document.querySelectorAll('dialog[open] label')].find((l) => l.textContent?.startsWith(labelStart));
    const input = (lbl && (document.getElementById((lbl as HTMLLabelElement).htmlFor) as HTMLInputElement | null)) ?? lbl?.querySelector('input');
    if (!input) throw new Error(`Field ${labelStart} not found`);
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const skyr = { barcode: '7610900016099', name: 'Skyr', brand: 'Emmi', per100: { kcal: 63, protein: 10, carbs: 4, fat: 0.2 }, micros100: { sugar: 4, calcium: 110 }, unit: 'g', packageSize: 500, source: 'openfoodfacts', fetchedAt: '2026-09-20T08:00:00Z' };
  const dishWithSkyr = { id: 'd', name: 'Skyr-Frühstück', portions: 1, ingredients: [{ id: 'i', name: 'Skyr (Emmi)', grams: 200, source: 'product', ref: '7610900016099', per100: skyr.per100, micros100: skyr.micros100 }], createdAt: 'x', updatedAt: 'x' };
  const eaten = { id: 'e', date: '2026-09-21', slot: 'breakfast', loggedAt: '2026-09-21T08:00:00Z', name: 'Skyr', barcode: '7610900016099', grams: 150, method: 'barcode', macros: { kcal: 95, protein: 15, carbs: 6, fat: 0.3 } };

  it('nutrients of a scanned product can be corrected later: origin stays, the correction is marked, empty = unknown, dishes follow, eaten entries stay', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), products: { [skyr.barcode]: skyr }, customDishes: { d: dishWithSkyr }, logEntries: [eaten] }));
    window.history.replaceState(null, '', '/#/nutrition');
    const store = await startApp();
    await click('Lebensmittel hinzufügen');
    await click('Manuell');
    await act(async () => document.querySelector<HTMLButtonElement>('dialog[open] button[aria-label="Skyr bearbeiten"]')!.click());
    expect(document.querySelector('dialog[open]')!.textContent).toMatch(/Nährwerte: Open Food Facts · Preis: deine Angabe/);
    await setField('Protein', '11');
    await setField('Zucker', ''); // unknown, not 0
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('dialog[open] [aria-label="Enthält"] button')].find((b) => b.textContent?.includes('Laktose'))!.click());
    await clickInDialog('Speichern');
    const p = store.getState().products[skyr.barcode]!;
    expect(p).toMatchObject({ source: 'openfoodfacts', per100: { kcal: 63, protein: 11, carbs: 4, fat: 0.2 }, allergens: ['lactose'] });
    expect(p.nutrientsEdited).toBeDefined();
    expect(p.micros100).toEqual({ calcium: 110 }); // sugar unknown now, the source's calcium kept
    expect(store.getState().customDishes.d!.ingredients[0]).toMatchObject({ per100: { protein: 11 }, micros100: { calcium: 110 } });
    expect(store.getState().logEntries[0]).toEqual(eaten);
    await click('Lebensmittel hinzufügen');
    await click('Manuell');
    await act(async () => document.querySelector<HTMLButtonElement>('dialog[open] button[aria-label="Skyr bearbeiten"]')!.click());
    expect(document.querySelector('dialog[open]')!.textContent).toMatch(/Nährwerte: Open Food Facts · von dir korrigiert/);
  });

  it('invalid nutrient input is refused with a clear message – nothing saved', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), products: { [skyr.barcode]: skyr } }));
    window.history.replaceState(null, '', '/#/nutrition');
    const store = await startApp();
    await click('Lebensmittel hinzufügen');
    await click('Manuell');
    await act(async () => document.querySelector<HTMLButtonElement>('dialog[open] button[aria-label="Skyr bearbeiten"]')!.click());
    await setField('Fett', 'viel');
    await clickInDialog('Speichern');
    expect(document.querySelector('dialog[open] [role="alert"]')!.textContent).toMatch(/nur Zahlen ab 0/);
    expect(store.getState().products[skyr.barcode]).toEqual(skyr);
  });

  it('"Als Gericht speichern": parts without an amount are named in the editor, the rest is editable', async () => {
    const manual = { id: 'm', date: '2026-09-21', slot: 'breakfast', loggedAt: '2026-09-21T08:05:00Z', name: 'Kaffee mit Milch', amount: 1, unit: 'portion', method: 'manual', macros: { kcal: 40, protein: 2, carbs: 3, fat: 2 } };
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), products: { [skyr.barcode]: skyr }, logEntries: [eaten, manual] }));
    window.history.replaceState(null, '', '/#/nutrition');
    await startApp();
    await click('Als Gericht speichern');
    const dlg = document.querySelector('dialog[open]')!;
    expect(dlg.textContent).toMatch(/Nicht übernommen \(ohne Mengenangabe\): Kaffee mit Milch/);
    expect(dlg.querySelector('[aria-label="Zutaten"]')!.textContent).toMatch(/Skyr \(Emmi\)/);
  });
});

describe('training premium core (UI)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 22, 10, 0)); // Tuesday 10:00
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });
  afterEach(async () => {
    vi.useRealTimers();
    (await import('./lib/celebrate')).dismissCelebration();
  });

  const MON = '2026-09-21';
  const done = (weight: number, reps: number) => ({ id: `s${Math.random()}`, weightKg: weight, reps, done: true, type: 'working' });
  // Last week's push: bench 80 × 8 × 3, shoulder press 20 × 10.
  const lastPush = {
    id: 'old',
    date: '2026-09-15',
    templateId: 'ppl-push',
    name: 'Push',
    startedAt: '2026-09-15T17:00:00Z',
    endedAt: '2026-09-15T18:00:00Z',
    status: 'completed',
    exercises: [
      { id: 'o1', exerciseId: 'bench-press', repMin: 6, repMax: 10, restSec: 150, sets: [done(80, 8), done(80, 8), done(80, 8)] },
      { id: 'o2', exerciseId: 'overhead-press', repMin: 8, repMax: 12, restSec: 120, sets: [done(20, 10)] },
    ],
  };
  const withTraining = (patch: Record<string, unknown> = {}) => ({
    ...completeState(),
    training: { programId: 'push-pull-legs', weekdays: [0, 2, 4], startedAt: '2026-09-01' },
    workouts: [lastPush],
    ...patch,
  });
  const dialog = () => document.querySelector<HTMLDialogElement>('dialog[open]');
  const dialogButton = (start: string) => {
    const found = [...(dialog()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => b.textContent?.trim().startsWith(start));
    if (!found) throw new Error(`Dialog button starting "${start}" not found`);
    return found;
  };
  const byLabel = <T extends HTMLElement>(label: string) => {
    const el = container.querySelector<T>(`[aria-label="${label}"]`);
    if (!el) throw new Error(`[aria-label="${label}"] not found`);
    return el;
  };
  const tap = (el: HTMLElement) => act(async () => el.click());
  const setInput = async (el: HTMLInputElement, value: string) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const chip = () => document.querySelector<HTMLElement>('[data-testid="celebration"]');

  it('library: muscle chips, filters, search; the detail explains the exercise with figure, muscles, steps, alternatives and own numbers', async () => {
    localStorage.setItem(KEY, JSON.stringify(withTraining()));
    window.history.replaceState(null, '', '/#/training');
    await startApp();
    await click('Übungen');
    expect(window.location.hash).toBe('#/exercises');
    const rows = () => [...container.querySelectorAll<HTMLButtonElement>('main ul button')].map((b) => b.querySelector('strong')!.textContent);
    const all = rows().length;
    expect(all).toBeGreaterThanOrEqual(50);
    await click('Brust');
    expect(rows().slice(0, 3)).toEqual(['Bankdrücken', 'Kurzhantel-Bankdrücken', 'Schrägbankdrücken (KH)']);
    expect(rows()).toContain('Enges Bankdrücken'); // chest as secondary muscle, listed after
    await click('Filter');
    await click('Maschine');
    expect(rows()).toEqual(['Brustpresse (Maschine)']);
    await click('Maschine');
    await click('Brust');
    await setInput(byLabel<HTMLInputElement>('Übung suchen'), 'kreuzheb');
    expect(rows()).toEqual(['Kreuzheben', 'Rumänisches Kreuzheben', 'Rumänisches Kreuzheben (KH)']);

    await setInput(byLabel<HTMLInputElement>('Übung suchen'), 'Bankdrücken');
    await tap([...container.querySelectorAll<HTMLButtonElement>('main ul button')].find((b) => b.querySelector('strong')!.textContent === 'Bankdrücken')!);
    const d = dialog()!;
    expect(d.getAttribute('aria-label')).toBe('Bankdrücken');
    expect(d.querySelector('svg[role="img"]')!.getAttribute('aria-label')).toBe('Trainiert: Brust (hauptsächlich), Trizeps, Schultern');
    expect(d.textContent).toMatch(/Kraft · Langhantel · Fortgeschritten/);
    expect(d.textContent).toMatch(/Letztes Training80 kg × 8 · 80 kg × 8 · 80 kg × 8/);
    expect(d.textContent).toMatch(/Bestleistung80 kg × 8/);
    expect(d.textContent).toMatch(/So geht’s/);
    expect(d.textContent).toMatch(/Darauf achten/);
    // Alternatives open in place.
    await tap(dialogButton('Kurzhantel-Bankdrücken'));
    expect(dialog()!.querySelector('h2')!.textContent).toBe('Kurzhantel-Bankdrücken');
  });

  it('gym flow: start → prefilled target → ✓ → live record + rest timer with the next set → edit, skip, set type, replace → finish with plan vs. reality', async () => {
    localStorage.setItem(KEY, JSON.stringify(withTraining()));
    window.history.replaceState(null, '', '/#/training');
    const store = await startApp();
    await tap(byLabel('Push – Brust, Schulter & Trizeps starten'));
    // Every start goes through the short check – nothing changes without a decision.
    expect(dialog()!.getAttribute('aria-label')).toBe('Push – Brust, Schulter & Trizeps');
    await clickInDialog('Training starten');
    expect(window.location.hash).toBe('#/session');
    const bench = container.querySelector('section[aria-label="Bankdrücken"]')!;
    // Today's target from last time (80 × 8 → 80 × 9) is prefilled, last time and best are right at the exercise.
    expect(bench.querySelector<HTMLInputElement>('[aria-label="Gewicht Satz 1"]')!.value).toBe('80');
    expect(bench.querySelector<HTMLInputElement>('[aria-label="Wiederholungen Satz 1"]')!.value).toBe('9');
    expect(bench.textContent).toMatch(/Letztes Training: 80 kg × 8, 80 kg × 8, 80 kg × 8/);
    expect(bench.textContent).toMatch(/Bestleistung: 80 kg × 8/);
    expect(bench.querySelector('[aria-label="Vorschlag: 80 kg × 9"]')!.textContent).toContain('+1 Wdh.Letztes Mal 8 / 8 / 8 – heute eine Wiederholung mehr pro Satz.');
    expect(bench.querySelector('[role="row"]:nth-child(2) [class*="prev"]')!.textContent).toBe('80×8');

    // ✓ → a real rep record right away, and the rest timer starts by itself.
    await tap(bench.querySelector<HTMLButtonElement>('[aria-label="Satz 1 erledigt"]')!);
    expect(chip()!.textContent).toMatch(/Wiederholungs-Rekord/);
    expect(chip()!.textContent).toMatch(/Bankdrücken · 80 kg: 9 statt 8/);
    const timer = () => container.querySelector<HTMLElement>('[role="timer"]');
    expect(timer()!.textContent).toMatch(/Pause/);
    expect(timer()!.textContent).toMatch(/2:30/);
    expect(timer()!.textContent).toMatch(/Als Nächstes: Bankdrücken · Satz 2 · 80 kg × 9/);
    await tap(byLabel('30 Sekunden mehr'));
    expect(timer()!.textContent).toMatch(/3:00/);
    await tap(byLabel('30 Sekunden weniger'));
    await tap(byLabel('30 Sekunden weniger'));
    expect(timer()!.textContent).toMatch(/2:00/);
    await tap([...timer()!.querySelectorAll('button')].find((b) => b.textContent === 'Überspringen')!);
    expect(timer()).toBeNull();
    // The same record is not celebrated twice in one session.
    (await import('./lib/celebrate')).dismissCelebration();
    await tap(bench.querySelector<HTMLButtonElement>('[aria-label="Satz 2 erledigt"]')!);
    expect(chip()).toBeNull();
    // Edit a set: only 7 reps in set 3.
    await setInput(bench.querySelector<HTMLInputElement>('[aria-label="Wiederholungen Satz 3"]')!, '7');
    await tap(bench.querySelector<HTMLButtonElement>('[aria-label="Satz 3 erledigt"]')!);
    const w = () => store.getState().workouts.find((x) => x.status === 'in_progress')!;
    expect(w().exercises[0]!.sets.map((s) => [s.weightKg, s.reps, s.done])).toEqual([
      [80, 9, true],
      [80, 9, true],
      [80, 7, true],
    ]);

    // Set options on the incline press: warm-up for set 1, skip set 3.
    const incline = () => container.querySelector('section[aria-label="Schrägbankdrücken (KH)"]')!;
    await tap(incline().querySelector<HTMLButtonElement>('[aria-label^="Satz 1: Normal"]')!);
    await tap(dialogButton('WAufwärmen'));
    expect(incline().querySelector('[aria-label^="Satz 1: Aufwärmen"]')!.textContent).toBe('W');
    await tap(incline().querySelector<HTMLButtonElement>('[aria-label^="Satz 3: Normal"]')!);
    await clickInDialog('Satz überspringen');
    expect(incline().querySelector<HTMLInputElement>('[aria-label="Gewicht Satz 3"]')!.disabled).toBe(true);
    expect(incline().querySelector<HTMLButtonElement>('[aria-label="Satz 3 erledigt"]')!.disabled).toBe(true);
    await setInput(incline().querySelector<HTMLInputElement>('[aria-label="Gewicht Satz 2"]')!, '24');
    await setInput(incline().querySelector<HTMLInputElement>('[aria-label="Wiederholungen Satz 2"]')!, '10');
    await tap(incline().querySelector<HTMLButtonElement>('[aria-label="Satz 2 erledigt"]')!);

    // Replace the shoulder press with the machine – straight from "trainiert dasselbe".
    await tap(byLabel('Optionen für Schulterdrücken (KH)'));
    await clickInDialog('Übung ersetzen');
    expect(dialog()!.textContent).toMatch(/Trainiert dasselbe/);
    await tap(dialogButton('Schulterpresse (Maschine)'));
    const machine = container.querySelector('section[aria-label="Schulterpresse (Maschine)"]')!;
    expect(machine.textContent).toMatch(/Ersetzt · statt Schulterdrücken \(KH\)/);
    expect(machine.textContent).toMatch(/Erstes Mal/); // prefilled from ITS OWN history (none) – nothing invented
    await setInput(machine.querySelector<HTMLInputElement>('[aria-label="Gewicht Satz 1"]')!, '40');
    await tap(machine.querySelector<HTMLButtonElement>('[aria-label="Satz 1 erledigt"]')!);
    // Skip the lateral raise completely; stop early (triceps not started).
    await tap(byLabel('Optionen für Seitheben'));
    await clickInDialog('Übung überspringen');
    expect(container.querySelector('section[aria-label="Seitheben"]')!.getAttribute('data-state')).toBe('skipped');

    await click('Beenden');
    await clickInDialog('Speichern');
    expect(window.location.hash).toMatch(/^#\/workout\?id=.+&done=1$/);
    expect(text()).toMatch(/Stark gemacht/);
    expect(text()).toMatch(/Neue Bestleistung/);
    expect(text()).toMatch(/Wiederholungs-RekordBankdrücken · 80 kg: 9 statt 8/);
    const summary = container.querySelector('[aria-label="Zusammenfassung"]')!.textContent!;
    expect(summary).toMatch(/Übungen3/);
    expect(summary).toMatch(/Sätze5/); // 3 bench + 1 incline (warm-up not counted) + 1 machine
    expect(text()).toMatch(/3 von 5 Übungen gemacht · 1 mit weniger Sätzen\/Wdh\. · 1 ersetzt · 2 ausgelassen/);
    const item = (name: string) => [...container.querySelectorAll('li[data-status]')].find((li) => li.querySelector('strong')!.textContent === name)!;
    expect(item('Bankdrücken').textContent).toMatch(/Geplant: 3 × 6–10 @ 80 kgGemacht: 9 @ 80 · 9 @ 80 · 7 @ 80/);
    expect(item('Schulterpresse (Maschine)').textContent).toMatch(/Ersetztstatt Schulterdrücken \(KH\)/);
    expect(item('Seitheben').textContent).toMatch(/AusgelassenGeplant: 3 × 12–20Nicht gemacht/);
    expect(item('Schrägbankdrücken (KH)').getAttribute('data-status')).toBe('less');
  });

  it('history, muscle groups this week, routines (create, start, duplicate, delete) and programs (choose, own program)', async () => {
    const thisWeek = { ...lastPush, id: 'mon', date: MON, startedAt: `${MON}T17:00:00Z`, endedAt: `${MON}T17:52:00Z`, name: 'Push – Brust, Schulter & Trizeps', volumeKg: 2120, records: [{ exerciseId: 'bench-press', kind: 'rep', value: 9, weightKg: 80, reps: 9, previous: 8 }] };
    localStorage.setItem(KEY, JSON.stringify(withTraining({ workouts: [lastPush, thisWeek] })));
    window.history.replaceState(null, '', '/#/training');
    const store = await startApp();
    // Which muscle groups were trained this week (bench 3 sets: chest 3, shoulders + arms 1.5; shoulder press 1 set).
    expect(byLabel('Brust: 3 Sätze')).toBeTruthy();
    expect(byLabel('Schultern: 2,5 Sätze')).toBeTruthy();
    expect(byLabel('Beine: 0 Sätze')).toBeTruthy();
    // History by week.
    await click('Verlauf');
    expect(window.location.hash).toBe('#/history');
    expect(text()).toMatch(/Diese Woche/);
    expect(text()).toMatch(/Push – Brust, Schulter & Trizeps.*52 min · 4 Sätze · 2.120 kg · 1 Rekord/);
    expect(text()).toMatch(/Letzte Woche/);

    // A new routine.
    await act(async () => window.location.assign('#/routine'));
    await type('Name', 'Oberkörper kurz');
    await click('Übung hinzufügen');
    await setInput(dialog()!.querySelector<HTMLInputElement>('[aria-label="Übung suchen"]')!, 'Latzug');
    await tap(dialogButton('Latzug'));
    expect(text()).toMatch(/LatzugSätzeWdh\. vonbisPause s/);
    await click('Routine speichern');
    expect(window.location.hash).toBe('#/training');
    const routine = Object.values(store.getState().routines)[0]!;
    expect(routine).toMatchObject({ name: 'Oberkörper kurz', exercises: [{ exerciseId: 'lat-pulldown', sets: 3, repMin: 8, repMax: 12 }] });
    // Duplicate, then delete the copy.
    await tap(byLabel('Optionen für Oberkörper kurz'));
    await clickInDialog('Duplizieren');
    expect(Object.values(store.getState().routines).map((r) => r.name).sort()).toEqual(['Oberkörper kurz', 'Oberkörper kurz (Kopie)']);
    await tap(byLabel('Optionen für Oberkörper kurz (Kopie)'));
    await clickInDialog('Löschen');
    expect(Object.keys(store.getState().routines)).toEqual([routine.id]);
    // Start it like any session.
    await tap(byLabel('Oberkörper kurz starten'));
    await clickInDialog('Training starten');
    expect(window.location.hash).toBe('#/session');
    expect(container.querySelector('section[aria-label="Latzug"]')).toBeTruthy();
    await act(async () => store.update((s) => void (s.workouts = s.workouts.filter((w) => w.status !== 'in_progress'))));

    // Programs: the recommendation, the real week preview, choosing one.
    await act(async () => window.location.assign('#/programs'));
    const card = (name: string) => byLabel(name);
    expect(card('Push / Pull / Beine').textContent).toMatch(/Aktiv · Woche 4 von 12/);
    expect(card('Ganzkörper').textContent).toMatch(/Empfohlen/); // beginner + 3 days
    await tap(card('Oberkörper / Unterkörper').querySelector<HTMLButtonElement>('[aria-label="Wochenplan zeigen"]')!);
    expect(card('Oberkörper / Unterkörper').textContent).toMatch(/Woche 1Mo (Ober|Unter)körper – [^·]+ · Mi (Ober|Unter)körper – [^·]+ · Fr (Ober|Unter)körper – [^·]+Woche 2Mo /); // the real rotation of this calendar week
    await tap([...card('Oberkörper / Unterkörper').querySelectorAll('button')].find((b) => b.textContent === 'Dieses Programm wählen')!);
    expect(store.getState().training).toMatchObject({ programId: 'upper-lower', weekdays: [0, 2, 4], startedAt: '2026-09-22' });
    // Completed workouts are untouched by the plan change.
    expect(store.getState().workouts.map((w) => w.id)).toEqual(['old', 'mon']);
    // An own program from the routine + a built-in session.
    await click('Programm erstellen');
    await type('Name', 'Mein Wechsel');
    await tap(dialogButton('Oberkörper kurz'));
    await tap(dialogButton('Beine – Kniebeuge & Hüfte'));
    await clickInDialog('Speichern');
    const own = Object.values(store.getState().customPrograms)[0]!;
    expect(own).toMatchObject({ name: 'Mein Wechsel', routineIds: [routine.id, 'ppl-legs'] });
    expect(card('Mein Wechsel').textContent).toMatch(/2 Einheiten im Wechsel/);
  });
});

describe('adaptive training (UI)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 22, 16, 45)); // Tuesday 16:45
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });
  afterEach(async () => {
    vi.useRealTimers();
    (await import('./lib/celebrate')).dismissCelebration();
  });

  const done = (weight: number, reps: number) => ({ id: `s${Math.random()}`, weightKg: weight, reps, done: true, type: 'working' });
  const lastPush = {
    id: 'old',
    date: '2026-09-15',
    templateId: 'ppl-push',
    name: 'Push – Brust, Schulter & Trizeps',
    startedAt: '2026-09-15T17:00:00',
    endedAt: '2026-09-15T18:00:00',
    status: 'completed',
    exercises: [
      { id: 'o1', exerciseId: 'bench-press', repMin: 6, repMax: 10, restSec: 150, sets: [done(80, 10), done(80, 10), done(80, 10)] },
      { id: 'o2', exerciseId: 'overhead-press', repMin: 8, repMax: 12, restSec: 120, sets: [done(20, 10), done(20, 10), done(20, 9)] },
    ],
  };
  const setup = (patch: Record<string, unknown> = {}) => ({
    ...completeState(),
    training: { programId: 'push-pull-legs', weekdays: [1], startedAt: '2026-09-01' },
    plannerSettings: { priority: 'balanced', mealTimes: { breakfast: '07:30', snack: '10:30', lunch: '12:30', dinner: '19:30' }, trainingTime: '18:00' },
    workouts: [lastPush],
    ...patch,
  });
  const dialog = () => document.querySelector<HTMLDialogElement>('dialog[open]')!;
  const inDialog = (start: string) => {
    const b = [...dialog().querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent?.trim().startsWith(start));
    if (!b) throw new Error(`"${start}" not in dialog`);
    return b;
  };
  const tap = (el: HTMLElement) => act(async () => el.click());
  const proposal = (title: string) => dialog().querySelector<HTMLElement>(`[aria-label="${title}"]`)!;
  const startPush = async () => tap(container.querySelector<HTMLButtonElement>('[aria-label="Push – Brust, Schulter & Trizeps starten"]')!);

  it('check-in: time + discomfort → proposals with reasons; only accepted ones change the session', async () => {
    localStorage.setItem(KEY, JSON.stringify(setup()));
    window.history.replaceState(null, '', '/#/training');
    const store = await startApp();
    await startPush();
    expect(dialog().textContent).toMatch(/Kurzer Check · geplant ~35 min/);
    expect(dialog().querySelector('[aria-label="Vorschläge für heute"]')).toBeNull(); // nothing to propose yet
    await tap(inDialog('25 min'));
    await tap(inDialog('Schulter'));
    const compact = proposal('Kompakte Variante · ~25 min');
    expect(compact.textContent).toMatch(/Du hast heute 25 min, geplant sind ~35 min/);
    const swap = proposal('Kurzhantel-Bankdrücken statt Bankdrücken');
    expect(swap.textContent).toMatch(/Du hast Beschwerden \(Schulter\) angegeben/);
    expect(dialog().textContent).toMatch(/LifeFit stellt keine Diagnose/);
    await tap([...compact.querySelectorAll('button')].find((b) => b.textContent === 'Übernehmen')!);
    await tap([...swap.querySelectorAll('button')].find((b) => b.textContent === 'Überspringen')!);
    expect(compact.getAttribute('data-decision')).toBe('accepted');
    await tap(inDialog('Starten · 1 Anpassung'));
    expect(window.location.hash).toBe('#/session');
    const w = store.getState().workouts.find((x) => x.status === 'in_progress')!;
    expect(w.checkIn).toEqual({ minutes: 25, discomfort: ['shoulder'] });
    expect(w.adaptations!.map((a) => a.kind)).toEqual(['shorten']);
    expect(w.exercises[0]!.exerciseId).toBe('bench-press'); // the declined swap did not happen
    expect(w.exercises.length).toBeLessThan(5);
    expect(container.textContent).toMatch(/Heute angepasst: Kompakte Variante · ~25 min/);
  });

  it('suggestion per exercise: reason visible; "Wie letztes Mal" declines it, "Übernehmen" keeps it; RIR is stored (as RPE, one field)', async () => {
    localStorage.setItem(KEY, JSON.stringify(setup()));
    window.history.replaceState(null, '', '/#/training');
    const store = await startApp();
    await startPush();
    await tap(inDialog('Training starten'));
    const bench = () => container.querySelector('section[aria-label="Bankdrücken"]')!;
    const bar = bench().querySelector('[aria-label="Vorschlag: 82,5 kg × 6"]')!;
    expect(bar.textContent).toContain('+2,5 kg');
    expect(bar.textContent).toContain('Letztes Training 3 × 80 kg (10 / 10 / 10) geschafft – oberes Ende erreicht.');
    expect(bench().querySelector<HTMLInputElement>('[aria-label="Gewicht Satz 1"]')!.value).toBe('82,5');
    await tap([...bar.querySelectorAll('button')].find((b) => b.textContent === 'Wie letztes Mal')!);
    expect(bench().querySelector<HTMLInputElement>('[aria-label="Gewicht Satz 1"]')!.value).toBe('80');
    expect(bench().querySelector<HTMLInputElement>('[aria-label="Wiederholungen Satz 1"]')!.value).toBe('10');
    expect(bench().textContent).toMatch(/Wie letztes Mal – Vorschlag nicht übernommen/);
    // Shoulder press: 10 / 10 / 9 inside the range → one rep more; accepted.
    const ohp = container.querySelector('section[aria-label="Schulterdrücken (KH)"]')!;
    await tap([...ohp.querySelectorAll('button')].find((b) => b.textContent === 'Übernehmen')!);
    expect(ohp.textContent).toMatch(/✓ Vorschlag übernommen · 20 kg × 11/);
    const w = () => store.getState().workouts.find((x) => x.status === 'in_progress')!;
    expect(w().exercises.slice(0, 2).map((e) => e.prescription!.decision)).toEqual(['declined', 'accepted']);
    // RIR 1 for set 1 of the bench press – stored as RPE 9 (no second field).
    await tap(bench().querySelector<HTMLButtonElement>('[aria-label^="Satz 1: Normal"]')!);
    await clickInDialog('1');
    expect(w().exercises[0]!.sets[0]!.rpe).toBe(9);
    // Right after a set, the rest timer asks the same question – one tap, optional.
    await tap(bench().querySelector<HTMLButtonElement>('[aria-label="Satz 2 erledigt"]')!);
    const timer = container.querySelector('[role="timer"]')!;
    expect(timer.textContent).toMatch(/Wie viele wären noch gegangen\?/);
    await tap(timer.querySelector<HTMLButtonElement>('[aria-label="RIR 2"]')!);
    expect(w().exercises[0]!.sets[1]!.rpe).toBe(8);
  });

  it('finish with feedback → stored, shown in the summary, and the discomfort is preselected at the next start', async () => {
    localStorage.setItem(KEY, JSON.stringify(setup()));
    window.history.replaceState(null, '', '/#/training');
    const store = await startApp();
    await startPush();
    await tap(inDialog('Training starten'));
    const bench = container.querySelector('section[aria-label="Bankdrücken"]')!;
    await tap(bench.querySelector<HTMLButtonElement>('[aria-label="Satz 1 erledigt"]')!);
    await click('Beenden');
    await tap(inDialog('Hart'));
    await tap(inDialog('Schulter'));
    expect(dialog().textContent).toMatch(/Deine Angaben fließen in die nächsten Vorschläge ein/);
    await clickInDialog('Speichern');
    const w = store.getState().workouts.find((x) => x.id !== 'old')!;
    expect(w.feedback).toEqual({ effort: 'hard', discomfort: ['shoulder'] });
    expect(text()).toMatch(/Dein Eindruck: Hart/);
    expect(text()).toMatch(/Beschwerden: Schulter – beim nächsten Start bietet LifeFit dafür Alternativen an/);
    // Next start: preselected, and the alternative is proposed right away.
    await act(async () => window.location.assign('#/training'));
    await startPush();
    expect(dialog().textContent).toMatch(/Beschwerden vom letzten Training übernommen/);
    expect(proposal('Kurzhantel-Bankdrücken statt Bankdrücken')).toBeTruthy();
  });

  it('Heute before training: few carbs so far → "Vor dem Training" with a snack sized from the own target', async () => {
    localStorage.setItem(KEY, JSON.stringify(setup({ workouts: [] })));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    const card = [...container.querySelectorAll('h2')].find((h) => h.textContent === 'Vor dem Training')?.closest('section, div[class*="card"]') ?? container;
    expect(card.textContent).toMatch(/Training in 75 min – ein kleiner Snack mit Kohlenhydraten\?/);
    expect(card.textContent).toMatch(/Bananen \d+ g erfassen · \d+ g KH/);
  });
});

describe('one day, one week: Heute + Ernährung + Training + Einkauf (end to end)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 22, 12, 45)); // Tuesday 12:45 – a training day
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });
  afterEach(async () => {
    vi.useRealTimers();
    (await import('./lib/celebrate')).dismissCelebration();
  });

  const TUE = '2026-09-22';
  const done = (weight: number, reps: number) => ({ id: `s${Math.random()}`, weightKg: weight, reps, done: true, type: 'working' });
  const lastPush = {
    id: 'old',
    date: '2026-09-15',
    templateId: 'ppl-push',
    name: 'Push – Brust, Schulter & Trizeps',
    startedAt: '2026-09-15T17:00:00',
    endedAt: '2026-09-15T18:00:00',
    status: 'completed',
    exercises: [{ id: 'o1', exerciseId: 'bench-press', repMin: 6, repMax: 10, restSec: 150, sets: [done(80, 8), done(80, 8), done(80, 8)] }],
  };
  const meal = (id: string, slot: string, recipeId: string) => ({ id, date: TUE, slot, recipeId, servings: 1, status: 'planned', source: 'suggest' });
  const chip = () => document.querySelector<HTMLElement>('[data-testid="celebration"]');
  const tap = (el: Element | null | undefined) => {
    if (!el) throw new Error('element not found');
    return act(async () => (el as HTMLElement).click());
  };
  const dialogButton = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find((b) => b.textContent?.trim() === label);
  const goal = (label: string) => container.querySelector(`[aria-label="Tagesziele"] [aria-label^="${label}:"]`)?.getAttribute('aria-label') ?? '';
  const week = (label: string) => container.querySelector(`[aria-label="Diese Woche"] [aria-label^="${label}:"]`)?.getAttribute('aria-label') ?? '';
  const go = async (hash: string) => {
    await act(async () => window.location.assign(hash));
    await act(() => new Promise((r) => setTimeout(r, 30)));
  };

  it('meal → protein → water boost → training → PR → finish → nutrition, day, week and shopping follow', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        ...completeState(),
        nutritionProfile: { ...completeState().nutritionProfile, waterGoalMl: 2000 },
        training: { programId: 'push-pull-legs', weekdays: [1], startedAt: '2026-09-01' },
        plannedMeals: [meal('l', 'lunch', 'bolognese'), meal('d', 'dinner', 'chili')],
        water: { [TUE]: 1250 },
        workouts: [lastPush],
      }),
    );
    window.history.replaceState(null, '', '/#/today');
    const store = await startApp();

    // 1. Heute: the day in one place – training day, goals incl. training, the week.
    expect(container.querySelector('[aria-label^="Heute Training:"]')).toBeTruthy();
    expect(goal('Training')).toMatch(/offen/);
    expect(week('Training')).toBe('Training: 0 / 1');

    // 2.–3. Log the planned lunch from the next-action card → protein moves.
    const proteinBefore = goal('Protein');
    await act(() => new Promise((r) => setTimeout(r, 450)));
    await tap(container.querySelector('[aria-label="Nächste Aktion"] button:not([aria-label])'));
    expect(store.getState().plannedMeals.find((m) => m.id === 'l')!.status).toBe('eaten');
    expect(goal('Protein')).not.toBe(proteinBefore);
    expect(goal('Protein')).toMatch(/^Protein: offen \([1-9]\d* \/ \d+ g\)$/);

    // 4.–5. Water: three quarters of the goal → the hydration milestone (same celebration system).
    (await import('./lib/celebrate')).dismissCelebration();
    await tap(container.querySelector('button[aria-label="250 ml Wasser hinzufügen"]'));
    expect(chip()!.textContent).toMatch(/Tagesziel fast geschafft/);

    // 6.–8. Training: check-in → session → the first set is a real record right away.
    await go('#/training');
    await tap(container.querySelector('[aria-label="Push – Brust, Schulter & Trizeps starten"]'));
    await tap(dialogButton('Training starten'));
    expect(window.location.hash).toBe('#/session');
    (await import('./lib/celebrate')).dismissCelebration();
    await tap(container.querySelector('section[aria-label="Bankdrücken"] [aria-label="Satz 1 erledigt"]'));
    expect(chip()!.textContent).toMatch(/Wiederholungs-Rekord.*9 statt 8/);

    // 9.–10. Finish → summary; nutrition answers the session ("Nach dem Training").
    await click('Beenden');
    await tap(dialogButton('Speichern'));
    expect(text()).toMatch(/Neue Bestleistung/);
    const coach = [...container.querySelectorAll('h2')].find((h) => h.textContent === 'Nach dem Training')!.closest('section, div')!.parentElement!;
    expect(coach.textContent).toMatch(/Nach dem Training: noch/);
    const workout = store.getState().workouts.find((w) => w.id !== 'old')!;
    expect(workout).toMatchObject({ status: 'completed', date: TUE });
    expect(workout.plannedId).toBeTruthy(); // counts for today's planned session

    // 13. Plan the suggested meal → its missing ingredients land on the shopping list (pantry considered).
    const planned = store.getState().plannedMeals.length;
    await tap([...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Einplanen'));
    expect(store.getState().plannedMeals.length).toBe(planned + 1);
    const added = store.getState().plannedMeals[store.getState().plannedMeals.length - 1]!;
    const { weekShopping } = await import('./domain/week');
    const { getRecipe } = await import('./data/recipes');
    const list = weekShopping(store.getState(), '2026-09-21', TUE);
    const ingredients = getRecipe(added.recipeId)!.ingredients.map((i) => i.foodId);
    expect(list.some((i) => ingredients.includes(i.foodId) && i.sources.some((s) => s.date === added.date))).toBe(true);

    // 11. Heute follows: training goal done, the week counts it, the badge says it.
    await go('#/today');
    expect(goal('Training')).toMatch(/erreicht/);
    expect(week('Training')).toBe('Training: 1 / 1');
    expect(container.querySelector('[aria-label^="Heute Training:"]')!.getAttribute('aria-label')).toMatch(/erledigt ✓/);

    // 12. The nutrition week plan shows the finished session on its day.
    await go('#/nutrition?view=week');
    expect(text()).toMatch(/🏋️ [^·]+ · erledigt ✓/);
  });

  it('rest day: calm "Erholung" with what it means for the target; no training goal', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), training: { programId: 'push-pull-legs', weekdays: [0, 2, 4], startedAt: '2026-09-01' } }));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    const rest = container.querySelector('[aria-label="Heute Ruhetag: Erholung"]')!;
    expect(rest.textContent).toMatch(/Tagesziel −\d+ kcal – Ausgleich zu den Trainingstagen, die Woche bleibt gleich/);
    expect(goal('Training')).toBe('');
  });
});

describe('coach phase 1 (UI): yesterday, next step, tips with memory, activity, portions', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 29, 9, 0)); // Tuesday morning
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });
  afterEach(() => vi.useRealTimers());

  const day = (n: number) => {
    const d = new Date(2026, 8, 29 - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  // A balanced day (2700 kcal target of completeState) with little fiber.
  const lowFiberDay = (n: number) => ({ id: `f${n}`, date: day(n), slot: 'lunch', loggedAt: `${day(n)}T12:00:00`, name: 'Eintrag', method: 'quick', macros: { kcal: 2700, protein: 165, carbs: 330, fat: 75 }, micros: { fiber: 12, sugar: 40, salt: 4 } });
  const state = (patch: Record<string, unknown> = {}) => ({
    ...completeState(),
    profile: { ...completeState().profile, createdAt: '2026-08-01T08:00:00' },
    logEntries: [1, 2, 3, 4, 5, 6, 7].map(lowFiberDay),
    ...patch,
  });
  const card = (title: string) => [...container.querySelectorAll('h2')].find((h) => h.textContent === title)?.closest('section, div[class*="card"]') ?? null;

  it('"Dein gestriger Tag": good points, the pattern, the simplest step, why – and gone after "Verstanden"', async () => {
    localStorage.setItem(KEY, JSON.stringify(state()));
    window.history.replaceState(null, '', '/#/today');
    const store = await startApp();
    const review = container.querySelector('[aria-label="Dein gestriger Tag"]')!;
    expect(review.textContent).toMatch(/Was lief gutKalorienziel erreichtProtein-Ziel erreicht/);
    // The longest window that carries the pattern: 7 rated days within the last 14.
    expect(review.textContent).toMatch(/Was auffälltBallaststoffe lag an 7 von 7 erfassten Tagen der letzten 14 Tage unter deinem persönlichen Bereich\./);
    expect(review.textContent).toMatch(/Die einfachste VerbesserungTäglich eine zusätzliche Portion Gemüse/);
    await act(async () => [...review.querySelectorAll('button')].find((b) => b.textContent === 'Warum?')!.click());
    expect(review.textContent).toMatch(/Ø 12 g bei einem Bereich um 38 g/);
    await act(async () => [...review.querySelectorAll('button')].find((b) => b.textContent === 'Verstanden')!.click());
    expect(container.querySelector('[aria-label="Dein gestriger Tag"]')).toBeNull();
    expect(store.getState().coach.reviewSeen).toEqual({ [day(1)]: true });
  });

  it('one next step and one tip at a time; the tip shown is remembered for the coach', async () => {
    localStorage.setItem(KEY, JSON.stringify(state()));
    window.history.replaceState(null, '', '/#/today');
    const store = await startApp();
    const step = card('Dein nächster sinnvoller Schritt')!;
    expect(step.querySelectorAll('li[class*="item"]')).toHaveLength(1);
    expect(step.textContent).toMatch(/Heute fehlen noch/);
    const tips = card('💡 Tipps für dich')!;
    expect(tips.querySelectorAll('li[class*="item"]')).toHaveLength(1);
    expect(tips.textContent).toMatch(/🥦 Mehr Ballaststoffe/);
    expect(store.getState().coach.topics!['tip:fiber:low']).toMatchObject({ shownDays: 1, status: 'active', firstShown: '2026-09-29' });
  });

  it('activity: entered in two taps, shown on Heute, explicitly not added to the target', async () => {
    localStorage.setItem(KEY, JSON.stringify(state()));
    window.history.replaceState(null, '', '/#/today');
    const store = await startApp();
    await click('Aktivität eintragen (optional)');
    expect(document.querySelector('dialog[open]')!.textContent).toMatch(/nicht automatisch zu deinem Tagesziel addiert/);
    await type('Aktive Kalorien', '420');
    await type('Schritte', '8400');
    await clickInDialog('Speichern');
    expect(store.getState().activity['2026-09-29']).toMatchObject({ activeKcal: 420, steps: 8400, source: 'manual' });
    expect(container.querySelector('[aria-label^="Aktivität heute: 420 kcal, 8.400 Schritte"]')).toBeTruthy();
  });

  it('portion intelligence: a scanned toast starts at "1 Scheibe", counted in slices', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 1, product: { product_name: 'Toastbrot', nutriments: { 'energy-kcal_100g': 260, proteins_100g: 8, carbohydrates_100g: 48, fat_100g: 3 }, serving_size: '2 slices (50 g)', serving_quantity: 50, product_quantity: 500, product_quantity_unit: 'g' } }), { status: 200 }),
    );
    localStorage.setItem(KEY, JSON.stringify(state({ logEntries: [] })));
    window.history.replaceState(null, '', '/#/nutrition');
    await startApp();
    await click('Lebensmittel hinzufügen');
    await click('Barcode');
    await type('Barcode-Nummer', '4012345678901');
    await click('Produkt suchen');
    await act(() => new Promise((r) => setTimeout(r, 30)));
    const dialog = document.querySelector('dialog[open]')!;
    expect(dialog.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!.value).toBe('25');
    expect([...dialog.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent)).toContain('1 Scheibe (25 g)');
    expect(dialog.textContent).toMatch(/Scheiben à 25 g/);
    expect(dialog.textContent).toMatch(/1 Portion \(50 g\)/);
  });

  it('the amount logged last time is offered again (still editable) – with its unit', async () => {
    const toast = { barcode: '4012345678901', name: 'Toastbrot', per100: { kcal: 260, protein: 8, carbs: 48, fat: 3 }, micros100: {}, unit: 'g', servingSize: 50, servingLabel: '2 slices (50 g)', packageSize: 500, lastAmount: 75, source: 'openfoodfacts', fetchedAt: '2026-09-20T08:00:00Z' };
    localStorage.setItem(KEY, JSON.stringify(state({ logEntries: [], products: { [toast.barcode]: toast } })));
    window.history.replaceState(null, '', '/#/nutrition');
    await startApp();
    await click('Lebensmittel hinzufügen');
    await click('Barcode');
    await type('Barcode-Nummer', '4012345678901');
    await click('Produkt suchen');
    await act(() => new Promise((r) => setTimeout(r, 30)));
    const dialog = document.querySelector('dialog[open]')!;
    expect(dialog.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!.value).toBe('75');
    expect(dialog.textContent).toMatch(/Zuletzt: 3 Scheiben \(75 g\)/);
  });
});

describe('onboarding – frame, resume, re-open', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 1, 9, 0)); // Thursday 09:00
    window.history.replaceState(null, '', '/#/today');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const restart = async () => {
    await act(async () => root?.unmount());
    root = undefined;
    return startApp();
  };
  const title = () => container.querySelector('h1')?.textContent ?? '';
  const go = async (route: string) => {
    await act(async () => window.location.assign(`#/${route}`));
    await act(async () => new Promise((r) => setTimeout(r, 0)));
  };

  it('the new onboarding is the only one – no switch, no old welcome screen', async () => {
    window.history.replaceState(null, '', '/');
    await startApp();
    expect(title()).toBe(WELCOME);
    expect(text()).toContain('Warum fragen wir das?');
    expect(text()).not.toContain('Plane deine Woche.');
  });

  it('click through the Schnellstart, close the app mid-way, resume at the same step, finish → Heute', async () => {
    let store = await startApp();
    expect(title()).toBe('Willkommen bei LifeFit');
    expect(text()).toContain('Warum fragen wir das?');
    expect(container.querySelector('[aria-label="Fortschritt"]')!.children).toHaveLength(3);
    // Überspringen is always there.
    expect(button('Ohne Angaben starten')).toBeTruthy();

    await click('Schnellstart (ca. 1 Minute)');
    await click('Weiter');
    // One topic per screen: weight, height, birth year, sex.
    expect(title()).toBe('Dein Gewicht');
    expect(button('Überspringen')).toBeTruthy();
    await click('Weiter');
    expect(title()).toBe('Deine Größe');
    await click('Weiter');
    expect(title()).toBe('Dein Geburtsjahr');
    await click('Weiter');
    expect(title()).toBe('Dein Geschlecht');
    // "Weiblich" → the pregnancy question follows (conditional step).
    await click('Weiblich');
    await click('Weiter');
    expect(title()).toBe('Gesundheit');
    expect(store.getState().onboarding!.progress).toMatchObject({ step: 'health', active: true });
    expect(JSON.parse(localStorage.getItem(KEY)!).onboarding.progress.step).toBe('health'); // saved after each step

    // App closed and opened again → same step.
    store = await restart();
    expect(title()).toBe('Gesundheit');

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Zurück"]')!.click());
    expect(title()).toBe('Dein Geschlecht');
    await click('Weiter');
    await click('Überspringen');
    expect(title()).toBe('Dein Ziel');
    expect(store.getState().onboarding!.progress.skipped).toEqual(['health']);
    await click('Weiter');
    expect(title()).toBe('Dein Rahmen');
    await click('Weiter');
    expect(title()).toBe('Dein Plan');
    expect(text()).toContain('LifeFit ersetzt keine ärztliche oder ernährungswissenschaftliche Beratung.');
    await click('Los geht’s');

    const s = store.getState();
    expect(s.profile).toMatchObject({ sex: 'female' }); // the answer given
    expect(s.onboarding!.body.heightCm).toMatchObject({ source: 'default' }); // defaults are marked as such
    expect(s.onboarding!.progress.finishedAt).toBeTruthy();
    expect(text()).toMatch(/Guten Morgen/); // the regular app (Heute)
  });

  it('"Später fortsetzen" makes the app usable with defaults; the profile resumes the flow at the same step', async () => {
    const store = await startApp();
    await click('Weiter'); // detailed path
    for (let i = 0; i < 4; i++) await click('Weiter'); // weight, height, birth year, sex
    expect(title()).toBe('Kraftsport-Erfahrung');
    await click('Später fortsetzen');
    expect(text()).toMatch(/Guten Morgen/);
    expect(store.getState().onboarding!.progress).toMatchObject({ step: 'experience', active: false });
    expect(store.getState().onboarding!.progress.finishedAt).toBeUndefined();

    await go('profile');
    await click('Onboarding fortsetzen');
    expect(title()).toBe('Kraftsport-Erfahrung');
    // Bereich überspringen → next section.
    await click('Bereich überspringen');
    expect(title()).toBe('Ernährungsform');
  });

  it('each section can be re-opened from the profile with the known values pre-filled; "Fertig" returns to the profile', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), nutritionProfile: { diet: 'vegetarian', excluded: ['nuts'], slots: ['breakfast', 'lunch', 'dinner'] } }));
    window.history.replaceState(null, '', '/#/profile');
    const store = await startApp();
    // Finished with the old onboarding → no new run.
    expect(text()).toContain('Deine Angaben');
    expect(text()).not.toContain('Onboarding fortsetzen');

    await click('Essen & Einkauf');
    expect(title()).toBe('Ernährungsform');
    const pressed = (label: string) => [...container.querySelectorAll('main button[aria-pressed="true"]')].some((b) => b.textContent!.includes(label));
    expect(pressed('Vegetarisch')).toBe(true); // pre-filled from the saved data
    await click('Weiter');
    // E5: re-interpreted ("Nüsse" → peanuts + tree nuts), to be confirmed
    expect(text()).toContain('Aus deinen bisherigen Angaben übernommen.');
    expect(pressed('Erdnüsse') && pressed('Schalenfrüchte (Nüsse)')).toBe(true);
    // Other sections are not part of this run.
    for (let i = 0; i < 4; i++) await click('Weiter');
    expect(title()).toBe('Was hast du schon zu Hause?');
    await click('Fertig');
    expect(window.location.hash).toBe('#/profile');
    expect(store.getState().onboarding!.progress.active).toBe(false);

    await click('Körper & Ziel');
    const input = () => container.querySelector<HTMLInputElement>('main input')!;
    expect(title()).toBe('Dein Gewicht');
    expect(input().value).toBe('80'); // pre-filled from the saved data
    await click('Weiter');
    expect(input().value).toBe('180');
    await click('Weiter');
    expect(input().value).toBe('1996');
    expect(text()).toContain('Das sind 30 Jahre.');
    await click('Schließen');
    expect(window.location.hash).toBe('#/profile');
  });

  it('#/onboarding without an open flow (back button after "Fertig") shows Heute, not a stale step', async () => {
    localStorage.setItem(KEY, JSON.stringify(completeState()));
    window.history.replaceState(null, '', '/#/profile');
    await startApp();
    await click('Essen & Einkauf');
    for (let i = 0; i < 6 && title() !== 'Was hast du schon zu Hause?'; i++) await click('Weiter');
    await click('Fertig');
    expect(window.location.hash).toBe('#/profile');
    await go('onboarding');
    expect(window.location.hash).toBe('#/today');
    expect(text()).toMatch(/Guten Morgen/);
  });

  describe('area A (Prompt 2): body data, analysis, body fat', () => {
    const input = () => container.querySelector<HTMLInputElement>('main input')!;
    /** Detailed path up to the analysis: 90 kg, 180 cm, born 1990, male, 3–5 years, active, no waist. */
    const toAnalysis = async () => {
      const store = await startApp();
      await click('Weiter'); // welcome → detailed
      await type('Gewicht', '90');
      await click('Weiter');
      await type('Größe', '180');
      await click('Weiter');
      await type('Geburtsjahr', '1990');
      expect(text()).toContain('Das sind 36 Jahre.');
      await click('Weiter');
      await click('Männlich');
      await click('Weiter');
      await click('3–5 Jahre');
      await click('Weiter');
      await click('Aktiv');
      await click('Weiter');
      expect(title()).toBe('Taillenumfang');
      expect(text()).toContain('Schneide eine Schnur in deiner Körpergröße ab');
      await click('Überspringen');
      expect(title()).toBe('Deine Werte');
      return store;
    };

    it('big number inputs with −/+; an implausible value shows a friendly hint but blocks nothing', async () => {
      const store = await startApp();
      await click('Weiter');
      expect(title()).toBe('Dein Gewicht');
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Gewicht erhöhen"]')!.click());
      expect(input().value).toBe('70,5'); // from the start value, one decimal
      expect(store.getState().onboarding!.body.weightKg).toMatchObject({ value: 70.5, source: 'user' });
      await type('Gewicht', '25');
      expect(text()).toMatch(/Bitte kurz prüfen – üblich sind 30–300 kg\. Du kannst trotzdem weiter\./);
      await click('Weiter');
      expect(title()).toBe('Deine Größe'); // not blocked
    });

    it('analysis: BMI with neutral wording, the muscle card highlighted for experienced users, WHtR hint, energy start value', async () => {
      const store = await toAnalysis();
      const bmiCard = container.querySelector('[aria-label="BMI"]')!;
      expect(bmiCard.textContent).toMatch(/27,8\s*Über dem Referenzbereich/);
      expect(text()).toContain('Der BMI unterscheidet nicht zwischen Muskeln und Fett.');
      expect(container.querySelector('[data-highlight]')).not.toBeNull();
      expect(text()).toContain('Passt sie um deine Taille, liegt dein WHtR unter 0,5.'); // no waist → string trick
      const energy = container.querySelector('[aria-label="Energiebedarf"]')!.textContent!;
      expect(energy).toMatch(/Startwert Energiebedarf pro Tag/);
      expect(energy).toContain('Wir passen ihn anhand deines Gewichtsverlaufs automatisch an.');
      // Mifflin 90/180/36 male = 1850; × 1.5 (aktiv), no training planned yet.
      expect(energy).toMatch(/ca\. 2\.780 kcal/);
      expect(button('Körperfett ergänzen (empfohlen)')).toBeTruthy();
      // "Überspringen" here skips the body fat estimate as well.
      await click('Überspringen');
      expect(title()).toBe('Gesundheit'); // the health check (for everyone) comes before the goal
      expect(store.getState().onboarding!.progress.skipped).toEqual(['waist', 'bodyFat']);
    });

    it('body fat: four methods by accuracy; Navy from neck and waist, then the visual comparison – result as a range, method stored', async () => {
      const store = await toAnalysis();
      await click('Körperfett ergänzen (empfohlen)');
      expect(title()).toBe('Körperfett');
      const methods = [...container.querySelectorAll('[aria-label="Methode"] button')].map((b) => b.textContent);
      expect(methods.map((m) => m!.match(/^(Ich kenne meinen Wert|Massband|Nur Taille|Ohne Hilfsmittel)/)?.[1])).toEqual(['Ich kenne meinen Wert', 'Massband', 'Nur Taille', 'Ohne Hilfsmittel']);
      expect(methods[1]).toContain('Beste Methode ohne Gerät');

      await click('Massband');
      expect(text()).toContain('Hals unterhalb des Kehlkopfs');
      expect(text()).not.toContain('Hüfte an der breitesten Stelle'); // men: no hip
      await type('Hals', '38');
      await type('Taille', '85');
      // 180 cm, waist 85, neck 38 → 16.1 % → "ca. 16 % (13–20 %)"
      expect(container.querySelector('[aria-label="Körperfett"]')!.textContent).toContain('ca. 16 % (13–20 %)');
      expect(store.getState().onboarding!.body.bodyFat).toMatchObject({ value: { method: 'navy', percent: 16, range: [13, 20] }, source: 'estimated' });
      expect(text()).toMatch(/FFMI \(normalisiert\) ca\. 23,3/); // 90 kg, 16 % → FFM 75.6 kg / 3.24
      // Katch-McArdle over the body fat range 13–20 %: (370 + 21.6 · FFM) × 1.5 → 2'890–3'090 kcal.
      expect(container.querySelector('[aria-label="Energiebedarf"]')!.textContent).toMatch(/ca\. 2\.890–3\.090 kcal/);

      await click('Ohne Hilfsmittel');
      const stages = container.querySelectorAll('[aria-label="Welches Bild passt am ehesten?"] button');
      expect(stages).toHaveLength(6);
      expect(container.querySelectorAll('[aria-label="Welches Bild passt am ehesten?"] svg')).toHaveLength(6); // own drawings, no images
      await act(async () => (stages[1] as HTMLButtonElement).click()); // 11–14 %
      expect(store.getState().onboarding!.body.bodyFat).toMatchObject({ value: { method: 'visual', percent: 13, range: [8, 18] }, source: 'estimated' });
      expect(container.querySelector('[aria-label="Körperfett"]')!.textContent).toContain('ca. 13 % (8–18 %)');
    });
  });

  describe('area A (Prompt 3): health check and goal', () => {
    const AT = '2026-10-01T07:00:00.000Z';
    const f = <T,>(value: T, source = 'user') => ({ value, source, updatedAt: AT });
    /** A stored onboarding at a step with the answers of section A. */
    const seed = (step: string, body: Record<string, unknown>, extra: Record<string, unknown> = {}, core: Record<string, unknown> = {}) => {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          schemaVersion: 3,
          ...core,
          onboarding: { version: 1, mode: 'full', progress: { step, active: true, completed: {}, skipped: [] }, body, health: {}, goal: {}, food: {}, training: {}, ...extra },
        }),
      );
    };
    const man = { weightKg: f(90), heightCm: f(180), birthYear: f(1990), sex: f('male'), trainingExperience: f('3to5'), activity: f('moderate') };

    it('health: the pregnancy question only for "weiblich" / "keine Angabe", the number-free option for everyone, a note on medical advice', async () => {
      seed('health', { ...man, sex: f('female') });
      let store = await startApp();
      expect(title()).toBe('Gesundheit');
      expect(text()).toContain('Bist du schwanger oder stillst du?');
      await click('Ja, ich stille');
      expect(store.getState().onboarding!.health.pregnancy).toMatchObject({ value: 'breastfeeding', source: 'user' });
      expect(text()).toContain('Hebamme');
      expect(text()).toContain('LifeFit ersetzt keinen ärztlichen Rat.');
      await click('Ohne Kalorienzahlen');
      expect(store.getState().onboarding!.health.numberFree).toMatchObject({ value: true });

      await act(async () => root?.unmount());
      seed('health', man);
      store = await startApp();
      expect(text()).not.toContain('Bist du schwanger oder stillst du?');
      expect(text()).toContain('Möchtest du lieber ohne Kalorienzahlen arbeiten?');
    });

    it('under 18: no question – the rule applies automatically and only "Halten & Gesundheit" is offered', async () => {
      seed('health', { ...man, sex: f('female'), birthYear: f(2010) });
      await startApp();
      expect(text()).not.toContain('Bist du schwanger oder stillst du?');
      expect(text()).toContain('Unter 18 plant LifeFit automatisch kein Kaloriendefizit');
      await click('Weiter');
      expect(title()).toBe('Dein Ziel');
      expect(container.querySelector('[aria-label="Empfehlung"]')!.textContent).toMatch(/Dein Ziel\s*Halten & Gesundheit/);
      expect(container.querySelector('[aria-label="Ziel wählen"]')).toBeNull();
      expect(text()).not.toContain('Tempo');
    });

    it('goal: recommendation big with confidence and "Warum?", alternatives selectable without lecturing, pace, forecast as a period, the daily target', async () => {
      // 16 % (Navy) with 3–5 years → mid band, trained → "Fett verlieren"
      seed('goal', { ...man, bodyFat: f({ method: 'navy', percent: 16, range: [13, 20] }, 'estimated') });
      const store = await startApp();
      const card = container.querySelector('[aria-label="Empfehlung"]')!.textContent!;
      expect(card).toMatch(/Unsere Empfehlung\s*Fett verlieren/);
      expect(card).toContain('Sicherheit: hoch');
      expect(card).toContain('Körperfett ca. 16 %');
      const choices = [...container.querySelectorAll('[aria-label="Ziel wählen"] button')].map((b) => b.textContent);
      expect(choices[0]).toMatch(/^Fett verlieren \(empfohlen\)/);
      expect(choices).toHaveLength(4);
      // jsdom has no <dialog> modal support – the Sheet only needs open/close.
      HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
      };
      HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
        this.removeAttribute('open');
      };
      await click('Warum?');
      expect(document.body.textContent).toContain('Barakat et al. 2020');

      expect(text()).toContain('0,75 % pro Woche'); // normal pace
      await click('Sanft');
      expect(store.getState().onboarding!.goal.pace).toMatchObject({ value: 'gentle' });
      expect(text()).toContain('0,5 % pro Woche');
      await type('Zielgewicht (optional)', '85');
      expect(text()).toMatch(/Prognose für 85 kg: ca\. .+ bis .+ – ein Zeitraum/);
      const target = container.querySelector('[aria-label="Tagesziel"]')!.textContent!;
      expect(target).toMatch(/\d\.\d{3} kcal/);
      expect(target).toMatch(/Protein \d+ g · Kohlenhydrate \d+ g · Fett \d+ g/);

      await click('Muskelaufbau');
      expect(store.getState().onboarding!.goal.type).toMatchObject({ value: 'muscle_gain', source: 'user' });
      expect(text()).toContain('Passt – ein kleiner Überschuss reicht'); // respected, briefly placed
    });

    it('very lean or BMI < 18.5: "Fett verlieren" is not offered, with a friendly reason', async () => {
      seed('goal', { ...man, weightKg: f(58), bodyFat: f({ method: 'measured', percent: 7, range: [4, 10] }) });
      await startApp();
      const choices = [...container.querySelectorAll('[aria-label="Ziel wählen"] button')].map((b) => b.textContent);
      expect(choices.some((c) => c!.startsWith('Fett verlieren'))).toBe(false);
      expect(text()).toMatch(/Nicht angeboten: Fett verlieren\./);
    });

    it('an existing user takes the goal over as a new target version – only on confirmation, the old version stays', async () => {
      localStorage.setItem(KEY, JSON.stringify(completeState()));
      window.history.replaceState(null, '', '/#/profile');
      const store = await startApp();
      const before = JSON.stringify(store.getState().targets);
      await click('Körper & Ziel');
      // through weight … health with the primary footer button (on the analysis it reads 'Körperfett ergänzen')
      for (let i = 0; i < 15 && title() !== 'Dein Ziel'; i++) await act(async () => (container.querySelector('footer button') as HTMLButtonElement).click());
      expect(title()).toBe('Dein Ziel');
      expect(store.getState().targets).toHaveLength(1); // nothing changed by just looking
      await click('Als neues Tagesziel übernehmen');
      const after = store.getState().targets;
      expect(after).toHaveLength(2);
      expect(JSON.stringify([after.find((t) => t.id === 't1')])).toBe(before);
      expect(text()).toContain('Neues Tagesziel gespeichert'); // undo toast
    });

    it('number-free mode: Heute shows meals and rings instead of kcal', async () => {
      localStorage.setItem(KEY, JSON.stringify({ ...completeState(), onboarding: { version: 1, progress: { completed: {}, skipped: [], finishedAt: AT }, body: {}, health: { numberFree: f(true) }, goal: {}, food: {}, training: {} } }));
      window.history.replaceState(null, '', '/#/today');
      await startApp();
      expect(text()).toContain('Mahlzeiten');
      expect(text()).toMatch(/ca\. 0 von 3 Mahlzeiten/);
      expect(text()).not.toMatch(/kcal übrig/);
      expect(container.querySelector('[aria-label^="Kalorien:"]')!.textContent).toContain('0 / 3');
    });

    it('pregnancy: "Gilt das noch?" after about 3 months – one quiet card on Heute', async () => {
      const old = '2026-06-01T08:00:00.000Z';
      localStorage.setItem(KEY, JSON.stringify({ ...completeState(), onboarding: { version: 1, progress: { completed: {}, skipped: [], finishedAt: AT }, body: {}, health: { pregnancy: { value: 'pregnant', source: 'user', updatedAt: old } }, goal: {}, food: {}, training: {} } }));
      window.history.replaceState(null, '', '/#/today');
      const store = await startApp();
      expect(text()).toContain('Du hattest „Schwangerschaft“ angegeben. Gilt das noch?');
      await click('Nein, nicht mehr');
      expect(store.getState().onboarding!.health.pregnancy!.value).toBe('no');
      expect(text()).not.toContain('Gilt das noch?');
    });

    it('meal prep (E18): existing users are asked once whether to keep the leftovers; the answer sticks', async () => {
      const ask = 'Möchtest du das beibehalten?';
      localStorage.setItem(KEY, JSON.stringify(completeState()));
      window.history.replaceState(null, '', '/#/today');
      let store = await startApp();
      expect(store.getState().onboarding!.food.mealPrep).toMatchObject({ value: true, source: 'migrated' });
      expect(text()).toContain(ask);
      await click('Nein, lieber frisch');
      expect(store.getState().onboarding!.food.mealPrep).toMatchObject({ value: false, source: 'user' });
      expect(text()).not.toContain(ask);

      // Asked once: not again after a restart.
      await act(async () => root?.unmount());
      window.history.replaceState(null, '', '/#/today');
      store = await startApp();
      expect(store.getState().onboarding!.food.mealPrep).toMatchObject({ value: false, source: 'user' });
      expect(text()).not.toContain(ask);
    });
  });

  describe('area B (Prompt 4): diet, allergies, preferences, everyday life', () => {
    const planned = (date: string, slot: string, recipeId: string) => ({ id: `${date}-${slot}`, date, slot, recipeId, servings: 1, status: 'planned', source: 'suggest' });
    const open = async (patch: Record<string, unknown> = {}) => {
      localStorage.setItem(KEY, JSON.stringify({ ...completeState(), ...patch }));
      window.history.replaceState(null, '', '/#/profile');
      const store = await startApp();
      await click('Essen & Einkauf');
      return store;
    };
    const ingredientsOf = (store: Awaited<ReturnType<typeof startApp>>) =>
      store
        .getState()
        .plannedMeals.filter((m) => m.date >= '2026-10-01' && m.status === 'planned')
        .flatMap((m) => getRecipe(m.recipeId)!.ingredients.map((i) => i.foodId));
    const pressed = (label: string) => [...container.querySelectorAll('main button[aria-pressed="true"]')].some((b) => b.textContent!.includes(label));

    it('diet and allergies are hard exclusions at once: forbidden planned meals are replaced, traces and free text count', async () => {
      const store = await open({ plannedMeals: [planned('2026-10-02', 'dinner', 'tofu-stir-fry'), planned('2026-10-03', 'lunch', 'chicken-rice-bowl')] });
      expect(title()).toBe('Ernährungsform');
      await click('Pescetarisch');
      expect(store.getState().nutritionProfile!.diet).toBe('pescatarian');
      expect(ingredientsOf(store)).not.toContain('chicken'); // replaced right away

      await click('Weiter');
      expect(title()).toBe('Allergien & Unverträglichkeiten');
      await click('Soja');
      expect(store.getState().nutritionProfile!.allergens).toEqual(['soy']);
      for (const id of ingredientsOf(store)) expect(getFood(id)!.tags!.allergens, id).not.toContain('soy');
      await click('Spuren von Soja okay');
      expect(store.getState().nutritionProfile!.tracesOk).toEqual(['soy']);

      await type('Was isst du sonst nicht?', 'Zwiebel');
      await click('Hinzufügen');
      expect(text()).toContain('Zwiebel – im Katalog: Zwiebeln');
      expect(store.getState().nutritionProfile!.excludedFoods).toEqual(['onion']);
      expect(store.getState().onboarding!.food.customExclusions).toMatchObject({ value: ['Zwiebel'], source: 'user' });
    });

    it('too few recipes: a hint with one suggestion that can be taken over', async () => {
      const store = await open();
      await click('Vegan');
      await click('Weiter');
      await click('Soja');
      const hint = () => container.querySelector('[aria-label="Machbarkeit"]')?.textContent ?? '';
      expect(hint()).toContain('Für das Frühstück bleibt kein Rezept');
      expect(hint()).toContain('Vorschlag: Ernährungsform „vegetarisch“ statt „vegan“');
      await click('Vorschlag übernehmen');
      expect(store.getState().nutritionProfile!.diet).toBe('vegetarian');
    });

    it('preferences: three states per food, excluded foods hidden, quick action per subgroup – weights, no filter', async () => {
      const store = await open({ nutritionProfile: { diet: 'omnivore', excluded: [], allergens: ['soy'], slots: ['breakfast', 'lunch', 'dinner'] } });
      await click('Weiter');
      await click('Weiter');
      expect(title()).toBe('Vorlieben');
      const chip = (name: string) => container.querySelector<HTMLButtonElement>(`button[aria-label^="${name}:"]`);
      expect(chip('Tofu natur')).toBeNull(); // soy is excluded – not shown at all
      expect(chip('Brokkoli')!.getAttribute('aria-label')).toBe('Brokkoli: neutral');
      await act(async () => chip('Brokkoli')!.click());
      expect(chip('Brokkoli')!.getAttribute('aria-label')).toBe('Brokkoli: mag ich');
      await act(async () => chip('Brokkoli')!.click());
      expect(chip('Brokkoli')!.getAttribute('aria-label')).toBe('Brokkoli: mag ich nicht');
      expect(store.getState().nutritionProfile!.dislikedFoods).toEqual(['broccoli']);
      await act(async () => chip('Brokkoli')!.click());
      expect(store.getState().nutritionProfile!.dislikedFoods).toBeUndefined();

      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Kühlregal & Eier (Protein): alle mag ich nicht"]')!.click());
      expect(store.getState().nutritionProfile!.dislikedFoods).toEqual(expect.arrayContaining(['egg', 'skyr', 'quark']));
    });

    it('everyday life: Snack 2 is planned, cooking time, household and budget are taken over', async () => {
      const store = await open();
      for (let i = 0; i < 3; i++) await click('Weiter');
      expect(title()).toBe('Dein Essalltag');
      await click('Snack 2');
      expect(store.getState().nutritionProfile!.slots).toEqual(['breakfast', 'lunch', 'snack2', 'dinner']);
      expect(store.getState().plannedMeals.some((m) => m.slot === 'snack2' && m.date >= '2026-10-01')).toBe(true);

      const segment = (group: string, label: string) => [...container.querySelectorAll(`[aria-label="${group}"] button`)].find((b) => b.textContent === label) as HTMLButtonElement;
      await act(async () => segment('Kochzeit unter der Woche', '≤ 15 min').click());
      expect(store.getState().plannerSettings.cookingTime).toEqual({ weekday: '15', weekend: 'any' });
      await click('Ich koche gern einmal für 2–3 Tage vor');
      expect(store.getState().onboarding!.food.mealPrep).toMatchObject({ value: false }); // existing user: was on (migrated)
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Wie viele Personen essen mit (du eingeschlossen)? erhöhen"]')!.click());
      expect(store.getState().plannerSettings.householdSize).toBe(2);
      await act(async () => segment('Budget', 'günstig').click());
      expect(store.getState().plannerSettings.priority).toBe('save');
      expect(pressed('Snack 2')).toBe(true);
    });
  });

  describe('area B (Prompt 5): the typical week', () => {
    const at = '2026-10-01T07:00:00.000Z';
    const withTemplate = (template: Record<string, unknown>) => {
      const s = completeState();
      return { ...s, nutritionProfile: { ...s.nutritionProfile, weekTemplate: template } };
    };

    it('the grid: tap cycles the four states with icon and text, quick action Mo–Fr, place of an out meal', async () => {
      localStorage.setItem(KEY, JSON.stringify(completeState()));
      window.history.replaceState(null, '', '/#/profile');
      const store = await startApp();
      await click('Essen & Einkauf');
      for (let i = 0; i < 4; i++) await click('Weiter');
      expect(title()).toBe('Deine typische Woche');
      const slot = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label^="${label}:"]`)!;
      expect(slot('Montag, Mittagessen').getAttribute('aria-label')).toBe('Montag, Mittagessen: Zuhause');
      expect(slot('Montag, Mittagessen').textContent).toContain('🏠 Zuhause'); // icon AND text, not only colour
      for (const state of ['Mitnehmen', 'Auswärts', 'Auslassen', 'Zuhause']) {
        await act(async () => slot('Montag, Mittagessen').click());
        expect(slot('Montag, Mittagessen').getAttribute('aria-label')).toBe(`Montag, Mittagessen: ${state}`);
      }

      await click('Mo–Fr Mittag auswärts');
      expect(slot('Freitag, Mittagessen').getAttribute('aria-label')).toBe('Freitag, Mittagessen: Auswärts');
      expect(store.getState().nutritionProfile!.weekTemplate![4]).toEqual({ lunch: { kind: 'out' } });
      expect(text()).toContain('Mo–Fr Mittag auswärts'); // undo toast
      const place = [...container.querySelectorAll('[aria-label="Freitag, Mittagessen: Art"] button')].find((b) => b.textContent === 'Restaurant') as HTMLButtonElement;
      await act(async () => place.click());
      expect(store.getState().onboarding!.food.weekTemplate!.value[4]).toEqual({ lunch: { kind: 'out', place: 'restaurant' } });
      // The template reached the plan: tomorrow (Friday) has no lunch to cook or buy.
      expect(store.getState().plannedMeals.some((m) => m.date === '2026-10-02' && m.slot === 'lunch' && m.status === 'planned')).toBe(false);
    });

    it('Heute: an out meal is a card – "Wie geplant gegessen" logs the reserved budget with one tap', async () => {
      // A planned day: breakfast and dinner at home, lunch out by the typical week.
      const meal = (slot: string, recipeId: string) => ({ id: slot, date: '2026-10-01', slot, recipeId, servings: 1, status: 'planned', source: 'suggest' });
      const s = { ...withTemplate({ 3: { lunch: { kind: 'out', place: 'canteen' } } }), plannedMeals: [meal('breakfast', 'overnight-oats'), meal('dinner', 'chili')] };
      localStorage.setItem(KEY, JSON.stringify({ ...s, onboarding: { version: 1, progress: { completed: {}, skipped: [], finishedAt: at }, body: {}, health: {}, goal: {}, food: {}, training: {} } }));
      window.history.replaceState(null, '', '/#/today');
      const store = await startApp();
      const card = () => container.querySelector('[aria-label="Mittagessen auswärts"]')!;
      expect(card().textContent).toContain('Auswärts · Kantine, normal');
      expect(card().textContent).toMatch(/ca\. [\d.]+ kcal reserviert/);
      await act(async () => [...card().querySelectorAll('button')].find((b) => b.textContent === 'Wie geplant gegessen')!.click());
      const entry = store.getState().logEntries.find((e) => e.slot === 'lunch' && e.date === '2026-10-01')!;
      expect(entry).toMatchObject({ name: 'Auswärts (Kantine)', method: 'quick' });
      expect(entry.macros.kcal).toBeGreaterThan(400);
      expect(card().textContent).toContain('Erfasst:');
    });

    it('the week plan: one day deviates, the typical week stays', async () => {
      const store = await (async () => {
        localStorage.setItem(KEY, JSON.stringify(withTemplate({ 4: { lunch: { kind: 'out' } } })));
        window.history.replaceState(null, '', '/#/nutrition?view=week');
        return startApp();
      })();
      // The smallest element holding Friday's link and its own deviation button = Friday's card.
      const friday = [...container.querySelectorAll('div, section, article')]
        .filter((el) => el.querySelector('a[aria-label^="Fr "]') && el.textContent!.includes('Diese Woche abweichen'))
        .sort((a, b) => a.textContent!.length - b.textContent!.length)[0]!;
      await act(async () => [...friday.querySelectorAll('button')].find((b) => b.textContent === 'Diese Woche abweichen')!.click());
      const select = friday.querySelector<HTMLSelectElement>('select[aria-label="Mittagessen diese Woche"]')!;
      expect(select.value).toBe('out');
      await act(async () => {
        select.value = 'home';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(store.getState().dayContexts['2026-10-02']!.slots).toEqual({ lunch: { kind: 'home' } });
      expect(store.getState().nutritionProfile!.weekTemplate).toEqual({ 4: { lunch: { kind: 'out' } } });
      expect(store.getState().plannedMeals.some((m) => m.date === '2026-10-02' && m.slot === 'lunch' && m.status === 'planned')).toBe(true);
    });
  });

  describe('area B (Prompt 6): what is at home', () => {
    it('checklist with fill level and "leer", then a scan: offline → later → looked up → into the pantry with MHD', async () => {
      localStorage.setItem(KEY, JSON.stringify(completeState()));
      window.history.replaceState(null, '', '/#/profile');
      const store = await startApp();
      const lookup = await import('./services/productLookup');
      // The lookup is asynchronous – let it settle before looking at the screen.
      const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)));
      await click('Essen & Einkauf');
      for (let i = 0; i < 5; i++) await click('Weiter');
      expect(title()).toBe('Was hast du schon zu Hause?');

      // 1. Checklist: tick = there (full), then a fill level; salt is a staple – "leer" puts it on the list.
      await click('Couscous');
      expect(store.getState().pantry.couscous).toMatchObject({ quantityG: 500, level: 'full' });
      const level = (food: string, label: string) => [...container.querySelectorAll(`[aria-label="${food}: Füllstand"] button`)].find((b) => b.textContent === label) as HTMLButtonElement;
      await act(async () => level('Couscous', 'halb').click());
      expect(store.getState().pantry.couscous).toMatchObject({ quantityG: 250, level: 'half' });
      await click('Salz');
      expect(text()).toContain('Grundvorrat – auf der Einkaufsliste nur, wenn „leer“');
      await act(async () => level('Salz', 'leer').click());
      expect(store.getState().pantry.salt!.quantityG).toBe(0);

      // 2. Scan offline → keep for later.
      lookup.setProductSource({ name: 'Mock', lookup: async () => ({ status: 'error', message: 'offline' }) });
      await type('Barcode-Nummer', '7610000000001');
      await click('Nachschlagen');
      await settle();
      expect(text()).toContain('7610000000001 – gerade keine Verbindung.');
      await click('Später auflösen');
      expect(store.getState().pendingScans).toHaveLength(1);

      // Back online: resolve, the category suggests the catalog food, MHD optional, into the pantry.
      lookup.setProductSource({
        name: 'Mock',
        lookup: async () => ({ status: 'found', product: { barcode: '7610000000001', name: 'Penne Rigate', per100: { kcal: 350 }, micros100: {}, unit: 'g', packageSize: 500, categories: ['en:pastas'], source: 'openfoodfacts', fetchedAt: '2026-10-01T08:00:00Z' } }),
      });
      await click('Jetzt nachschlagen');
      await settle();
      expect(store.getState().pendingScans).toBeUndefined();
      expect(text()).toContain('Penne Rigate · 500 g');
      await type('Mindestens haltbar bis (optional)', '2027-03-01');
      await click('In den Vorrat: Vollkornnudeln');
      expect(store.getState().pantry.pasta).toMatchObject({ quantityG: 500, bestBefore: '2027-03-01' });
      expect(store.getState().products['7610000000001']).toMatchObject({ foodId: 'pasta' });
      expect(text()).toContain('Penne Rigate – im Vorrat als Vollkornnudeln');
    });
  });

  describe('area C (Prompt 7): experience, frame, cardio, focus', () => {
    const openTraining = async () => {
      localStorage.setItem(KEY, JSON.stringify(completeState()));
      window.history.replaceState(null, '', '/#/profile');
      const store = await startApp();
      await click('Training');
      return store;
    };
    const pressed = (label: string) => [...container.querySelectorAll('main button[aria-pressed="true"]')].some((b) => b.textContent!.includes(label));
    const segment = (group: string, label: string) => [...container.querySelectorAll(`[aria-label="${group}"] button`)].find((b) => b.textContent === label) as HTMLButtonElement;

    it('experience: the estimate is pre-selected, one tap overrides it; working weights become start weights', async () => {
      const store = await openTraining();
      expect(title()).toBe('Deine Erfahrung');
      expect(container.querySelector('[aria-label="Empfehlung"]')!.textContent).toMatch(/Unsere Einschätzung\s*Anfänger/);
      expect(pressed('Anfänger (empfohlen)')).toBe(true);
      expect(text()).not.toContain('Aktuelle Arbeitsgewichte'); // only for advanced levels
      await click('Fortgeschritten');
      expect(store.getState().profile!.experience).toBe('intermediate');
      expect(store.getState().onboarding!.training.level).toMatchObject({ value: 'intermediate', source: 'user' });
      expect(text()).toContain('Aktuelle Arbeitsgewichte (optional)');
      await type('Bankdrücken: kg', '100');
      await type('Bankdrücken: Wdh.', '5');
      expect(store.getState().training!.workingWeights).toEqual({ 'bench-press': { kg: 100, reps: 5 } });
    });

    it('frame: days, length, places → equipment, complaints with level, the gap hint and the medical note', async () => {
      const store = await openTraining();
      await click('Weiter');
      expect(title()).toBe('Dein Rahmen');
      await act(async () => segment('Dauer pro Einheit', '45 min').click());
      expect(store.getState().training!.sessionMinutes).toBe(45);
      await click('Zuhause mit Kurzhanteln');
      expect(store.getState().training!.equipmentItems).toEqual(['dumbbells', 'bench']);
      await click('Knie');
      expect(store.getState().training!.limitations).toMatchObject({ areas: ['knee'], severity: { knee: 'mild' } });
      expect(text()).toContain('Bei akuten Schmerzen lass das bitte ärztlich abklären.');
      await act(async () => segment('Knie: Stärke', 'deutlich').click());
      expect(store.getState().training!.limitations!.severity).toEqual({ knee: 'clear' });
      expect(text()).toMatch(/keine schonende Alternative für denselben Muskel/); // a gap is shown, not hidden
    });

    it('cardio: the recommendation for the goal with "Warum?", the choice changes the surcharge', async () => {
      const store = await openTraining();
      await click('Weiter');
      await click('Weiter');
      expect(title()).toBe('Ausdauer');
      // completeState: muscle gain → light cardio
      expect(container.querySelector('[aria-label="Cardio-Empfehlung"]')!.textContent).toContain('Schrittziel');
      HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
      };
      HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
        this.removeAttribute('open');
      };
      await click('Warum?');
      expect(document.body.textContent).toMatch(/nicht direkt vor dem Beintraining/i);
      await click('Zone 2');
      expect(store.getState().training!.cardio).toEqual({ kind: 'zone2', types: ['walking'] });
      expect(text()).toMatch(/erhöhen deinen Gesamtumsatz um ca\. \d+ kcal pro Tag/);
      expect(text()).toMatch(/Tagesziel anpassen \([\d']+ kcal\)/); // a new target only on confirmation (E10)
      expect(store.getState().targets).toHaveLength(1);
    });

    it('focus: at most two muscle groups, by body map or list', async () => {
      const store = await openTraining();
      for (let i = 0; i < 3; i++) await click('Weiter');
      expect(title()).toBe('Fokus');
      expect(text()).toContain('Fokus heißt etwas mehr Volumen für diese Muskeln, der Rest wird weiter trainiert.');
      await act(async () => (container.querySelector('rect[data-group="glutes"]') as SVGRectElement).dispatchEvent(new MouseEvent('click', { bubbles: true })));
      const chips = '[aria-label="Fokus-Muskelgruppen"] button';
      await act(async () => [...container.querySelectorAll<HTMLButtonElement>(chips)].find((b) => b.textContent!.includes('Schultern'))!.click());
      await act(async () => [...container.querySelectorAll<HTMLButtonElement>(chips)].find((b) => b.textContent!.includes('Brust'))!.click()); // a third is not taken
      expect(store.getState().training!.musclePriorities).toEqual(['glutes', 'shoulders']);
      expect(container.querySelector('rect[data-group="glutes"]')!.getAttribute('data-state')).toBe('on');
      expect(text()).toContain('Zwei sind gewählt');
    });
  });

  describe('area C (Prompt 8): your training plan', () => {
    it('week overview: 7 days, swap with a live hint, switch the split, "Warum?", adopt into the rotation', async () => {
      localStorage.setItem(KEY, JSON.stringify(completeState()));
      window.history.replaceState(null, '', '/#/profile');
      const store = await startApp();
      await click('Training');
      for (let i = 0; i < 4; i++) await click('Weiter');
      expect(title()).toBe('Dein Trainingsplan');
      const days = () => [...container.querySelectorAll('[aria-label="Deine Woche"] > li')];
      expect(days()).toHaveLength(7);
      expect(days()[0]!.textContent).toContain('Ganzkörper A'); // beginner, Mo/Mi/Fr → A/B/C
      expect(days()[1]!.textContent).toContain('Ruhe');

      // Swap Monday with Tuesday (the accessible way): Tue A + Wed B = full body two days in a row → a hint, never a block.
      const select = container.querySelector<HTMLSelectElement>('select[aria-label="Montag tauschen mit"]')!;
      await act(async () => {
        select.value = '1';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(days()[1]!.textContent).toContain('Ganzkörper A');
      expect(container.querySelector('[aria-label="Hinweise zum Plan"]')!.textContent).toMatch(/Di und Mi: .* an zwei Tagen hintereinander schwer/);
      expect(store.getState().onboarding!.training.planDraft!.value.week[1]).toMatchObject({ kind: 'strength', session: 0 });

      // Exercises of a session, with the catalog's alternatives.
      await act(async () => [...days()[1]!.querySelectorAll('button')].find((b) => b.textContent === 'Übungen ansehen')!.click());
      expect(days()[1]!.textContent).toMatch(/\d × \d+–\d+ /);

      // Switch the split.
      await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Split wechseln"] button')].find((b) => b.querySelector('strong')?.textContent === 'Ganzkörper A/B')!.click());
      expect(store.getState().onboarding!.training.planDraft!.value.split).toBe('fb2');

      HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
      };
      HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
        this.removeAttribute('open');
      };
      await click('Warum dieser Plan?');
      expect(document.body.textContent).toContain('Schoenfeld, Ogborn & Krieger 2016');

      await click('Plan übernehmen');
      const s = store.getState();
      expect(s.training!.programId).toMatch(/^program:plan-/);
      // A/B on three chosen days: strength Mo and Fr (most rest between), cardio on Wednesday – all three in the rotation, in weekday order.
      const routines = s.customPrograms[s.training!.programId]!.routineIds.map((id) => s.routines[id]!.name);
      expect(routines).toEqual(['Ganzkörper A', 'Lockeres Cardio', 'Ganzkörper B']);
      expect(text()).toContain('Plan übernommen – er steht ab heute in deinem Training und auf Heute.');
    });
  });
  describe('Prompt 9: "Dein Plan", the Heute card, Vorher / Nachher', () => {
    const toPlan = async () => {
      for (let i = 0; i < 20 && title() !== 'Dein Plan'; i++) await click('Weiter');
      expect(title()).toBe('Dein Plan');
    };
    beforeEach(() => {
      HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
      };
      HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
        this.removeAttribute('open');
      };
    });

    it('summary cards; "Ändern" jumps into the step and back; "Los geht’s" plans the week, the shopping list and the training → Heute', async () => {
      const store = await startApp();
      await click('Schnellstart (ca. 1 Minute)');
      await toPlan();
      const cards = [...container.querySelectorAll('main [aria-label]')].map((c) => c.getAttribute('aria-label'));
      for (const t of ['Körper', 'Ziel & Tempo', 'Kalorien & Makros', 'Essensrahmen', 'Trainingswoche']) expect(cards).toContain(t);
      expect(text()).toContain('geschätzt – ergänzen?'); // Schnellstart: defaults are marked
      expect(text()).toContain('LifeFit ersetzt keine ärztliche oder ernährungswissenschaftliche Beratung.');

      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Körper ändern"]')!.click());
      expect(title()).toBe('Körperfett'); // no body fat yet → the step that makes the body card more precise
      await click('Zurück zur Zusammenfassung');
      expect(title()).toBe('Dein Plan');
      expect(store.getState().onboarding!.progress.returnTo).toBeUndefined();

      await click('Los geht’s');
      const s = store.getState();
      const { weekStart } = await import('./domain/dates');
      const { weekShopping } = await import('./domain/week');
      const week = weekStart('2026-10-01');
      expect(s.plannedMeals.filter((m) => m.date >= week).length).toBeGreaterThan(0);
      expect(weekShopping(s, week, '2026-10-01').length).toBeGreaterThan(0);
      expect(s.training!.programId).toMatch(/^program:plan-/);
      expect(s.onboarding!.training.plan).toBeTruthy();
      expect(text()).toMatch(/Guten Morgen/);
    });

    it('Heute: one quiet card for the most effective missing answer; "Später" → 14 days of rest; "Ergänzen" opens the step', async () => {
      localStorage.setItem(KEY, JSON.stringify(completeState()));
      let store = await startApp();
      const card = () => container.querySelector('[aria-label="Angabe ergänzen"]');
      // A user of the old onboarding answers the one-time meal-prep question first (E18) – one card at a time.
      expect(card()).toBeNull();
      expect(container.querySelector('[aria-label="Kurze Frage"]')).not.toBeNull();
      await click('Ja, beibehalten');
      expect(container.querySelector('[aria-label="Kurze Frage"]')).toBeNull();
      expect(card()!.textContent).toContain('Körperfett'); // no body fat yet → the first priority
      expect(container.querySelectorAll('[aria-label="Angabe ergänzen"]')).toHaveLength(1);
      await click('Später');
      expect(card()).toBeNull();
      expect(store.getState().onboarding!.notices!.completeCard!.dismissedUntil).toBe('2026-10-15');

      vi.setSystemTime(new Date(2026, 9, 14, 9, 0));
      store = await restart();
      expect(card()).toBeNull(); // still quiet on day 13
      vi.setSystemTime(new Date(2026, 9, 15, 9, 0));
      store = await restart();
      expect(card()).not.toBeNull();
      await click('Ergänzen');
      expect(title()).toBe('Körperfett');
    });

    it('E5: a stricter reading of an old exclusion ("Nüsse") is offered once on Heute – "Ja, passt" confirms, the meal-prep question follows', async () => {
      localStorage.setItem(KEY, JSON.stringify({ ...completeState(), nutritionProfile: { diet: 'omnivore', excluded: ['nuts'], slots: ['breakfast', 'lunch', 'dinner'] } }));
      const store = await startApp();
      const confirm = () => container.querySelector('[aria-label="Ausschlüsse bestätigen"]');
      expect(confirm()!.textContent).toMatch(/Erdnüsse.*Schalenfrüchte/);
      expect(container.querySelector('[aria-label="Kurze Frage"]')).toBeNull(); // one card at a time
      await click('Ja, passt');
      expect(confirm()).toBeNull();
      expect(store.getState().onboarding!.food.allergens).toMatchObject({ value: ['peanuts', 'tree_nuts'], source: 'user' });
      expect(store.getState().onboarding!.food.allergens!.confirmedAt).toBeTruthy();
      expect(container.querySelector('[aria-label="Kurze Frage"]')).not.toBeNull();
    });

    it('profile: body data show Vorher / Nachher; confirming writes a new target version (older ones untouched), undo restores', async () => {
      localStorage.setItem(KEY, JSON.stringify(completeState()));
      window.history.replaceState(null, '', '/#/profile');
      const store = await startApp();
      const before = structuredClone(store.getState().targets);
      await click('Körperdaten');
      await act(async () => [...container.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find((b) => b.textContent === 'Sehr')!.click());
      const preview = container.querySelector('[aria-label="Vorher und Nachher"]')!;
      expect(preview.textContent).toMatch(/Kalorien: 2\.700 → [\d.]+ kcal \(\+\d+/);
      expect(store.getState().targets).toEqual(before); // nothing saved yet
      await clickInDialog('Speichern und Tagesziele übernehmen');
      const s = store.getState();
      expect(s.targets).toHaveLength(2);
      expect(s.targets[0]).toEqual(before[0]); // the old version stays byte-identical (E10)
      expect(s.targets[1]!.kcal).toBeGreaterThan(2700);
      expect(s.profile!.activity).toBe('active');
      expect(s.onboarding!.body.activity).toMatchObject({ value: 'active', source: 'user' });
      await click('Rückgängig');
      expect(store.getState().targets).toEqual(before);
      expect(store.getState().profile!.activity).toBe('moderate');
    });

    it('number-free mode (E14): no kcal number on Heute, Ernährung, Fortschritt, Einkauf, Training, Profil and "Dein Plan"', async () => {
      localStorage.setItem(KEY, JSON.stringify({ ...completeState(), weights: [{ id: 'w', date: '2026-09-28', kg: 80 }] }));
      window.history.replaceState(null, '', '/#/today');
      const store = await startApp();
      const actions = await import('./store/actions');
      const ob = await import('./store/onboardingActions');
      await act(async () => {
        actions.suggestMealsForWeek('2026-09-28');
        const first = store.getState().plannedMeals.find((m) => m.date === '2026-10-01');
        if (first) actions.markEaten(first.id);
        ob.setOnboardingAnswer('health', 'numberFree', true);
      });
      const KCAL_NUMBER = /\d[\d.’']*\s*(kcal|Kilokalorien)/;
      for (const route of ['today', 'nutrition', 'progress', 'shopping', 'training', 'profile']) {
        await go(route);
        expect(text().length, route).toBeGreaterThan(100);
        expect(text(), route).not.toMatch(KCAL_NUMBER);
      }
      await go('progress');
      expect(text()).toContain('Ø Essen pro Tag');
      // The food sheet: suggestions and catalog search.
      await go('nutrition');
      await click('Lebensmittel hinzufügen');
      expect(text()).toContain('Portion:');
      expect(text()).not.toMatch(KCAL_NUMBER);
      await click('Suchen');
      const input = container.querySelector<HTMLInputElement>('input[placeholder^="z. B. Birne"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Hafer');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => new Promise((r) => setTimeout(r, 400)));
      expect(text()).toContain('Haferflocken');
      expect(text()).not.toMatch(KCAL_NUMBER);
      // "Dein Plan" in the number-free mode: portions.
      const { summaryOf } = await import('./domain/onboarding/summary');
      const energy = summaryOf(store.getState(), '2026-10-01').find((c) => c.id === 'energy')!;
      expect(energy.lines.join(' ')).not.toMatch(KCAL_NUMBER);
    });

    it('profile: "Nur Körperdaten speichern" keeps the target', async () => {
      localStorage.setItem(KEY, JSON.stringify(completeState()));
      window.history.replaceState(null, '', '/#/profile');
      const store = await startApp();
      await click('Körperdaten');
      await act(async () => [...container.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find((b) => b.textContent === 'Sitzend')!.click());
      await clickInDialog('Nur Körperdaten speichern');
      expect(store.getState().targets).toHaveLength(1);
      expect(store.getState().profile!.activity).toBe('sedentary');
    });
  });

});
