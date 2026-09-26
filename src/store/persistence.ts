import { toISODate, weekStart } from '../domain/dates';
import { buildShoppingList, shoppingRange } from '../domain/shopping';
import type { AppState, PantryItem, ShoppingWeekState } from '../domain/types';

const KEY = 'lifefit:v1';
const BACKUP_KEY = 'lifefit:corrupt-backup';

export function emptyState(): AppState {
  return {
    schemaVersion: 2,
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
  };
}

export function defaultPlannerSettings(): AppState['plannerSettings'] {
  return {
    priority: 'balanced',
    mealTimes: { breakfast: '07:30', snack: '10:30', lunch: '12:30', dinner: '19:00' },
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
  const base = { ...emptyState(), ...parsed, schemaVersion: 2 } as AppState;
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
export function isSetupComplete(state: AppState): boolean {
  return !!(state.profile && state.goal && state.nutritionProfile && state.training && state.targets?.length > 0);
}

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
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Migrated state is only written on the next change – loading never writes.
    if (parsed.schemaVersion === 1) return { state: toChf(migrateV1(parsed)) };
    if (parsed.schemaVersion !== 2) throw new Error('Unknown schema version');
    // Merge onto defaults so newly added fields always exist.
    return { state: toChf({ ...emptyState(), ...parsed } as AppState) };
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

/**
 * LifeFit is Swiss-only: the weekly budget is CHF. Older data stored it as
 * `weeklyBudgetEur` – the number is taken over as it is (the user typed it),
 * never converted. Loading only; storage is updated on the next change.
 */
export function toChf(state: AppState): AppState {
  const settings = state.plannerSettings as AppState['plannerSettings'] & { weeklyBudgetEur?: number };
  if (!settings || settings.weeklyBudgetEur === undefined) return state;
  const { weeklyBudgetEur, ...rest } = settings;
  return { ...state, plannerSettings: { ...rest, weeklyBudgetChf: rest.weeklyBudgetChf ?? weeklyBudgetEur } };
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
