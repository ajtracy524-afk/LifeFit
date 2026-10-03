import { findTemplate } from '../data/exercises';
import { toISODate, weekStart } from '../domain/dates';
import { buildShoppingList, shoppingRange } from '../domain/shopping';
import { EATING_OUT_SLOTS } from '../domain/timeBudget';
import { isSetupComplete, migrateOnboarding } from '../domain/onboarding/migrate';
import type { AppState, PantryItem, ShoppingWeekState } from '../domain/types';

const KEY = 'lifefit:v1';
const BACKUP_KEY = 'lifefit:corrupt-backup';

export function emptyState(): AppState {
  return {
    schemaVersion: 3,
    profile: null,
    goal: null,
    nutritionProfile: null,
    targets: [],
    training: null,
    plannedMeals: [],
    logEntries: [],
    workouts: [],
    weights: [],
    shopping: {},
    coach: { dismissed: {} },
    dayContexts: {},
    workoutOverrides: {},
    pantry: {},
    closedDayTargets: {},
    learning: { preferences: {} },
    plannerSettings: defaultPlannerSettings(),
    products: {},
    water: {},
    customDishes: {},
    routines: {},
    customPrograms: {},
    activity: {},
    measurements: [],
  };
}

export function defaultPlannerSettings(): AppState['plannerSettings'] {
  return {
    priority: 'balanced',
    mealTimes: { breakfast: '07:30', snack: '10:30', lunch: '12:30', snack2: '16:00', dinner: '19:00' },
  };
}

/** Shape of a v1 shopping week: binary status per food, no amounts. */
interface ShoppingWeekV1 {
  status?: Record<string, 'checked' | 'have'>;
  manual?: ShoppingWeekState['manual'];
}

/**
 * v1 → v2: shopping status becomes amounts.
 * For the current and later weeks, "gekauft" / "hab ich schon" means the
 * plan's need is at home – it goes into the pantry with exactly that amount
 * (no invented package leftovers); "gekauft" is also kept as a purchase.
 * Past weeks only keep their manual items. Everything else is untouched.
 */
export function migrateV1(parsed: Record<string, unknown>, now: Date = new Date()): AppState {
  const base = { ...emptyState(), ...parsed, schemaVersion: 3 } as AppState;
  const today = toISODate(now);
  const thisWeek = weekStart(today);
  const pantry: Record<string, PantryItem> = {};
  const shopping: Record<string, ShoppingWeekState> = {};

  for (const [week, raw] of Object.entries((parsed.shopping ?? {}) as Record<string, ShoppingWeekV1>)) {
    const purchased: Record<string, number> = {};
    const status = raw.status ?? {};
    if (week >= thisWeek && Object.keys(status).length > 0) {
      const { from, to } = shoppingRange(week, today);
      for (const item of buildShoppingList(base.plannedMeals, from, to)) {
        const s = status[item.foodId];
        if (!s) continue;
        const grams = Math.round(item.grams);
        pantry[item.foodId] = { foodId: item.foodId, quantityG: (pantry[item.foodId]?.quantityG ?? 0) + grams, updatedAt: now.toISOString() };
        if (s === 'checked') purchased[item.foodId] = grams;
      }
    }
    shopping[week] = { purchased, manual: raw.manual ?? [] };
  }

  return { ...base, shopping, pantry: { ...pantry, ...(base.pantry ?? {}) } };
}

/**
 * A user counts as set up only if everything the regular app needs exists.
 * These fields are all written by onboarding and can never be emptied later.
 * Weights and planned meals are deliberately NOT required – users may delete them.
 */
/** One definition (domain/onboarding/migrate.ts) – re-exported here for the app shell. */
export { isSetupComplete };

export type LoadResult = { state: AppState; notice?: 'recovered' | 'unavailable' };

export function loadState(): LoadResult {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return { state: emptyState(), notice: 'unavailable' };
  }
  if (!raw) return { state: emptyState() };

  try {
    // Migrated state is only written on the next change – loading never writes.
    return { state: migrateStored(JSON.parse(raw) as Record<string, unknown>) };
  } catch {
    // Never silently discard user data: keep a copy for recovery.
    try {
      localStorage.setItem(BACKUP_KEY, raw);
    } catch {
      /* storage full – nothing more we can do */
    }
    return { state: emptyState(), notice: 'recovered' };
  }
}

/** Stored data of any known schema version → the current state. Throws on anything else. */
function migrateStored(parsed: Record<string, unknown>): AppState {
  if (!parsed || typeof parsed !== 'object') throw new Error('Not an object');
  if (parsed.schemaVersion === 1) return migrateLegacy(migrateV1(parsed));
  // v2 → v3 adds only the onboarding record (derived from the core data, nothing else changes).
  if (parsed.schemaVersion !== 2 && parsed.schemaVersion !== 3) throw new Error('Unknown schema version');
  // Merge onto defaults so newly added fields always exist.
  return migrateLegacy({ ...emptyState(), ...parsed, schemaVersion: 3 } as AppState);
}

export type BackupResult = { ok: true; state: AppState; exportedAt?: string } | { ok: false; reason: string };

/**
 * A file from "Daten exportieren" (or a raw stored state) → a complete state,
 * migrated like stored data. Nothing is written here.
 */
export function parseBackup(text: string): BackupResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'Die Datei ist keine LifeFit-Sicherung (kein gültiges JSON).' };
  }
  const wrapper = parsed as { app?: unknown; data?: unknown; exportedAt?: unknown } | null;
  const data = wrapper && wrapper.app === 'LifeFit' ? wrapper.data : parsed;
  let state: AppState;
  try {
    state = migrateStored(data as Record<string, unknown>);
  } catch {
    return { ok: false, reason: 'Die Datei ist keine LifeFit-Sicherung oder stammt aus einer unbekannten Version.' };
  }
  if (!isSetupComplete(state)) return { ok: false, reason: 'Die Sicherung enthält keine vollständigen LifeFit-Daten.' };
  return { ok: true, state, ...(typeof wrapper?.exportedAt === 'string' ? { exportedAt: wrapper.exportedAt } : {}) };
}

/**
 * Asks the browser to keep the data (otherwise it may be cleared under storage
 * pressure, or after a week without use in Safari). Asked once the app holds
 * real data; a browser that already granted it is not asked again.
 */
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (!navigator.storage?.persist || (await navigator.storage.persisted())) return;
    await navigator.storage.persist();
  } catch {
    /* not supported – the data stays in localStorage as before */
  }
}

/** All one-time clean-ups of older stored data, applied on load. */
function migrateLegacy(state: AppState): AppState {
  return migrateOnboarding(markEatingOutSkips(renameLegacyWorkouts(normalizeLegacyDayModes(addMissingMealTimes(dropLegacyEurBudget(state))))));
}

/** Slots added later ("Snack 2", E13) get their default time – stored times stay. */
export function addMissingMealTimes(state: AppState): AppState {
  const times = state.plannerSettings?.mealTimes;
  if (!times) return state;
  const defaults = defaultPlannerSettings().mealTimes;
  const missing = (Object.keys(defaults) as (keyof typeof defaults)[]).filter((slot) => !times[slot]);
  if (!missing.length) return state;
  return { ...state, plannerSettings: { ...state.plannerSettings, mealTimes: { ...defaults, ...times } } };
}

/**
 * One-time migration: dinners skipped by "Auswärts" before the reason was
 * stored get it now (skipped, on an eating-out day, nothing logged instead),
 * so switching back to "Zuhause" brings them back as before.
 */
export function markEatingOutSkips(state: AppState): AppState {
  const out = (m: AppState['plannedMeals'][number]) =>
    m.status === 'skipped' && !m.skippedFor && EATING_OUT_SLOTS.includes(m.slot) && state.dayContexts?.[m.date]?.mode === 'eating_out' && !state.logEntries?.some((e) => e.replacedMealId === m.id);
  if (!(state.plannedMeals ?? []).some(out)) return state;
  return { ...state, plannedMeals: state.plannedMeals.map((m) => (out(m) ? { ...m, skippedFor: 'eating_out' as const } : m)) };
}

/** Built-in session names before they described their content ("Training A" says nothing). */
const LEGACY_TEMPLATE_NAMES: Record<string, string> = {
  'fb-a': 'Ganzkörper A',
  'fb-b': 'Ganzkörper B',
  'ul-upper-a': 'Oberkörper A',
  'ul-lower-a': 'Unterkörper A',
  'ul-upper-b': 'Oberkörper B',
  'ul-lower-b': 'Unterkörper B',
  'ppl-push': 'Push',
  'ppl-pull': 'Pull',
  'ppl-legs': 'Beine',
};

/**
 * One-time migration: workouts saved under an old built-in name get the
 * current, descriptive name of the same session ("Ganzkörper A" →
 * "Ganzkörper – Kniebeuge & Bankdrücken"), keeping a "(kurz)" / "(reduziert)"
 * suffix. Only exact old names of that template id – nothing else changes.
 */
export function renameLegacyWorkouts(state: AppState): AppState {
  let changed = false;
  const workouts = (state.workouts ?? []).map((w) => {
    const old = LEGACY_TEMPLATE_NAMES[w.templateId];
    const current = findTemplate(w.templateId)?.name;
    if (!old || !current) return w;
    const m = w.name.match(/^(.*?)( \((kurz|reduziert)\))*$/);
    if (m?.[1] !== old) return w;
    changed = true;
    return { ...w, name: current + w.name.slice(old.length) };
  });
  return changed ? { ...state, workouts } : state;
}

/**
 * One-time migration: the day modes "Busy" and "Reise" only ever meant
 * "little time" (the planner treated them exactly like timeBudget 'low'). They
 * are stored as what they meant – timeBudget 'low', dinner at home – so the
 * app has one time model and no synonyms. Same plan as before, no replanning.
 */
export function normalizeLegacyDayModes(state: AppState): AppState {
  const contexts = state.dayContexts ?? {};
  const legacy = Object.entries(contexts).filter(([, c]) => (c.mode as string) === 'busy' || (c.mode as string) === 'travel');
  if (!legacy.length) return state;
  const dayContexts = { ...contexts };
  for (const [date] of legacy) dayContexts[date] = { timeBudget: 'low', mode: 'normal' };
  return { ...state, dayContexts };
}

/**
 * One-time migration – LifeFit is Swiss-only (CHF). Older data may contain a
 * budget stored as `weeklyBudgetEur`. It is NOT converted and NOT reused as
 * CHF (a euro amount is not a franc amount): it is dropped, and the budget is
 * back at its CHF default ("kein Budget") until the user enters one in CHF.
 * Afterwards the active model only knows `weeklyBudgetChf`.
 */
export function dropLegacyEurBudget(state: AppState): AppState {
  const settings = state.plannerSettings as AppState['plannerSettings'] & { weeklyBudgetEur?: unknown };
  if (!settings || !('weeklyBudgetEur' in settings)) return state;
  const { weeklyBudgetEur: _dropped, ...chfOnly } = settings;
  return { ...state, plannerSettings: chfOnly };
}

/** Returns false if the data could not be written (quota, private mode …). */
export function saveState(state: AppState): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** Removes everything LifeFit stores – app data and the recovery copy of corrupt data. */
export function clearState(): void {
  for (const key of [KEY, BACKUP_KEY]) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
