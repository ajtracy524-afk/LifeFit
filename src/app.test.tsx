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

async function completeOnboardingFlow() {
  await click('Los geht');
  await click('Weiter'); // goal
  await type('Alter', '30');
  await type('Größe', '180');
  await type('Gewicht', '80');
  await click('Weiter'); // body
  await click('Weiter'); // training
  await click('Weiter'); // nutrition
  await click('Haferflocken / Porridge'); // favourite
  await click('Weiter'); // tastes
  await click('Weiter'); // meal style
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
    // Monday's session is part of "Dein Plan".
    expect(text()).toMatch(/Dein Plan[\s\S]*Ganzkörper/);

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
    expect(text()).toMatch(/2 Gerichte angepasst: /);
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
    await act(async () => tab('Ausnahme Mi 23.', 'Auswärts').click());
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

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Nächste Aktion"] button')!.click());
    expect(store.getState().plannedMeals.find((m) => m.id === 'm0')!.status).toBe('eaten');
    // Monday is a training day → training is next.
    expect(card()).toMatch(/Training starten/);
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
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), nutritionProfile: { ...completeState().nutritionProfile, waterGoalMl: 2500 } }));
    window.history.replaceState(null, '', '/#/today');
    const store = await startApp();
    const water = () => container.querySelector('[aria-label^="Wasser: 250 ml pro Glas"]')!;
    // 2.5 L goal → 10 glasses of 250 ml.
    expect(water().querySelectorAll('button[aria-label^="Wasser auf"]')).toHaveLength(10);
    expect(text()).toMatch(/Noch 2,5 L/);
    // Tapping the 2nd glass fills up to it: +500 ml in one tap.
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Wasser auf 0,5 L"]')!.click());
    expect(store.getState().water['2026-09-21']).toBe(500);
    expect(text()).toMatch(/0,5 L\s*\/ 2,5 L/);
    expect(text()).toMatch(/Noch 2 L/);
    // The last full glass takes 250 ml back; "+250" adds one.
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="250 ml weniger"]')!.click());
    expect(store.getState().water['2026-09-21']).toBe(250);
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="250 ml Wasser hinzufügen"]')!.click());
    expect(store.getState().water['2026-09-21']).toBe(500);
    // Same control, same data on "Ernährung".
    await act(async () => window.location.assign('#/nutrition'));
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(text()).toMatch(/0,5 L\s*\/ 2,5 L/);
  });

  it('Heute: water without a goal shows a neutral scale and asks for a goal – nothing invented', async () => {
    localStorage.setItem(KEY, JSON.stringify(completeState()));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    expect(container.querySelectorAll('button[aria-label^="Wasser auf"]')).toHaveLength(8);
    expect(text()).toContain('Tagesziel festlegen');
    expect(text()).not.toMatch(/Noch \d/);
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
    expect(text()).toMatch(/Tagesziel erreicht ✓ · 0,5 L darüber/);
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
    expect(text()).toMatch(/Diese Woche ca\. [\d.]+–[\d.]+ CHF von 55 CHF/);
    expect(text()).not.toMatch(/€/);
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
      await act(async () => open(/Mikronährstoffe anzeigen/).click());
      const list = container.querySelector('[aria-label="Mikronährstoffe"]')!.textContent!;
      expect(list).toMatch(/Calcium\s*275 mg\s*\/ 800 mg/);
      expect(text()).toMatch(/Werte aus 1 von 2 Einträgen – die übrigen haben keine Angabe \(nicht 0\)/);
      expect(list).toMatch(/Natrium\s*90 mg/);
      expect(list).not.toMatch(/Vitamin C/);
      expect(text()).toMatch(/Keine Daten: Vitamin A, Vitamin C/);
      expect(text()).not.toMatch(/Vitamin C\s*0/);
      expect(text()).toMatch(/Referenz = Nährstoffbezugswert/);
    });
  }

  it('Heute: large mg values read as g – value and reference in the same unit (Kalium 1,8 / 2 g)', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), logEntries: [{ ...scanned, micros: { potassium: 1800, calcium: 275 } }] }));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    await act(async () => open(/Mikronährstoffe anzeigen/).click());
    const list = container.querySelector('[aria-label="Mikronährstoffe"]')!.textContent!;
    expect(list).toMatch(/Kalium\s*1,8 g\s*\/ 2 g/);
    expect(list).toMatch(/Calcium\s*275 mg\s*\/ 800 mg/);
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
    expect(items[0]).toMatch(/Frühstück · gegessen[\s\S]*Skyr[\s\S]*2\.50 CHF · statt Protein Overnight Oats/);
    expect(items[1]).toMatch(/Mittagessen · als Nächstes[\s\S]*ca\. [\d.]+–[\d.]+ CHF/);
    expect(items[2]).toMatch(/Abendessen · später/);
    expect(text()).not.toMatch(/0\.00 CHF|€/);
  });

  it('Heute: a day without micronutrient data says so instead of showing zeros', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...completeState(), logEntries: [planEntry] }));
    window.history.replaceState(null, '', '/#/today');
    await startApp();
    await act(async () => open(/Mikronährstoffe anzeigen/).click());
    expect(text()).toMatch(/Für heute liegen keine Angaben vor/);
    expect(container.querySelector('[aria-label="Mikronährstoffe"]')).toBeNull();
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
    expect(text()).toMatch(/Deine Menge \(200 g\) ≈ 2\.48 CHF/);
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
    expect(text()).toContain('Bitte einen Preis zwischen 0.05 und 1000 CHF angeben.');
    expect([...container.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find((b) => b.textContent?.trim() === 'Hinzufügen')!.disabled).toBe(true);
    await act(async () => window.location.assign('#/nutrition?view=week'));
    await settle();
    expect(text()).toMatch(/Diese Woche ca\. [\d.]+–[\d.]+ CHF von 55 CHF/);
  });
});
