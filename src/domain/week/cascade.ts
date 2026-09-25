import { getFood } from '../../data/foods';
import { getRecipe } from '../../data/recipes';
import { newId } from '../../lib/id';
import { weekdayLong, weekdayShort } from '../../lib/format';
import { addDays, toISODate, weekDays, weekStart, weekdayIndex } from '../dates';
import { logFromMeal, plannedMealMacros, recipeMacros, roundServings, sumMacros } from '../nutrition';
import { effectivePrepMin, seededRandom, SLOT_ORDER, suggestWeek } from '../planner';
import { TIME_BUDGETS } from '../timeBudget';
import { estimateMinutes, resolveWorkouts } from '../training';
import type { AppState, DayContext, ISODate, MealSlot, PlanSlotId, PlannedMeal, ShoppingWeekState } from '../types';
import { dayTargetFor } from './dayTargets';
import { addToPantry, pantryEstimate, purchaseAmount, setPantryQuantity } from './pantry';
import { DEFAULT_DAY_CONTEXT, dayContextFor, weekShopping } from './weekPlan';

/**
 * Cascade: the ONE place where the week changes.
 *
 *   change → mutate the sources of truth → recompute dependent values
 *          → diff old vs. new derived week → summary
 *
 * Pure: returns a new state, the caller commits it and keeps the old one for undo.
 * Recipes are never exchanged automatically – only servings follow the day target.
 */

export type WeekChange =
  | { type: 'moveWorkout'; slotId: PlanSlotId; toDate: ISODate }
  | { type: 'skipWorkout'; slotId: PlanSlotId }
  | { type: 'restoreWorkout'; slotId: PlanSlotId }
  | { type: 'setDayContext'; date: ISODate; context: Partial<DayContext> }
  | { type: 'addMeal'; date: ISODate; slot: MealSlot; recipeId: string; servings: number; id?: string }
  | { type: 'replaceMeal'; mealId: string; recipeId: string; servings?: number }
  | { type: 'removeMeal'; mealId: string }
  | { type: 'setServings'; mealId: string; servings: number }
  | { type: 'purchase'; week: ISODate; foodId: string; grams?: number }
  | { type: 'undoPurchase'; week: ISODate; foodId: string }
  | { type: 'haveAtHome'; week: ISODate; foodId: string }
  | { type: 'notAtHome'; week: ISODate; foodId: string }
  | { type: 'setPantry'; foodId: string; quantityG: number | null };

export interface ChangeSummary {
  title: string;
  /** Short lines for the toast / change log, e.g. "Einkauf: 1 neu, 2 geändert". */
  details: string[];
  week: ISODate;
  targetChanges: { date: ISODate; fromKcal: number; toKcal: number }[];
  rebalanced: { mealId: string; date: ISODate; from: number; to: number }[];
  shopping: { added: string[]; removed: string[]; changed: string[] };
  /** Meals exchanged because they did not fit the day (F5). */
  replaced: Replacement[];
}

export type CascadeResult = { ok: true; state: AppState; summary: ChangeSummary } | { ok: false; reason: string };

type Replacement = { from: string; to: string };
type Mutation = { ok: true; title: string; trainingChanged?: boolean; replaced?: Replacement[] } | { ok: false; reason: string };

const fail = (reason: string): Mutation => ({ ok: false, reason });

export function applyWeekChange(state: AppState, change: WeekChange, now: Date = new Date()): CascadeResult {
  const today = toISODate(now);
  const week = weekOf(state, change, today);
  const next = structuredClone(state);

  const result = mutate(next, change, today, now.toISOString());
  if (!result.ok) return result;

  const { targetChanges, rebalanced } = result.trainingChanged ? rebalanceWeek(state, next, week, today) : { targetChanges: [], rebalanced: [] };
  const shopping = diffShopping(state, next, week, today);
  const training = diffTraining(state, next, week);

  const details: string[] = [];
  if (result.replaced?.length) {
    const r = result.replaced;
    details.push(`${r.length} ${r.length === 1 ? 'Mahlzeit' : 'Mahlzeiten'} ersetzt: ${r.map((x) => `${x.from} → ${x.to}`).join(', ')}`);
  }
  details.push(...training);
  if (targetChanges.length) {
    details.push(`Tagesziele: ${targetChanges.map((t) => `${weekdayShort(weekdayIndex(t.date))} ${signed(t.toKcal - t.fromKcal)} kcal`).join(', ')}`);
  }
  if (rebalanced.length) details.push(`${rebalanced.length} ${rebalanced.length === 1 ? 'Portion' : 'Portionen'} angepasst`);
  const shopParts = [
    shopping.added.length && `${shopping.added.length} neu`,
    shopping.removed.length && `${shopping.removed.length} entfällt`,
    shopping.changed.length && `${shopping.changed.length} geändert`,
  ].filter(Boolean);
  if (shopParts.length) details.push(`Einkauf: ${shopParts.join(', ')}`);

  return { ok: true, state: next, summary: { title: result.title, details, week, targetChanges, rebalanced, shopping, replaced: result.replaced ?? [] } };
}

// ---------- Mutations of the sources of truth ----------

function mutate(s: AppState, change: WeekChange, today: ISODate, nowIso: string): Mutation {
  switch (change.type) {
    case 'moveWorkout': {
      const { plan, session } = findSession(s, change.slotId);
      if (!session) return fail('Diese Einheit gibt es nicht.');
      if (session.completedWorkoutId) return fail('Die Einheit ist schon erledigt.');
      const ws = weekOfSlot(change.slotId);
      if (change.toDate < ws || change.toDate > addDays(ws, 6)) return fail('Training lässt sich nur innerhalb derselben Woche verschieben.');
      if (change.toDate < today) return fail('In die Vergangenheit lässt sich nicht verschieben.');
      if (session.status !== 'skipped' && session.date === change.toDate) return fail('Die Einheit liegt schon auf diesem Tag.');
      if (plan.some((p) => p.id !== session.id && p.status !== 'skipped' && p.date === change.toDate)) return fail('An diesem Tag ist schon Training geplant.');

      if (change.toDate === session.originalDate) delete s.workoutOverrides[change.slotId];
      else s.workoutOverrides[change.slotId] = { slotId: change.slotId, status: 'moved', date: change.toDate };
      return { ok: true, title: `${session.template.name} auf ${weekdayLong(weekdayIndex(change.toDate))} verschoben`, trainingChanged: true };
    }

    case 'skipWorkout': {
      const { session } = findSession(s, change.slotId);
      if (!session) return fail('Diese Einheit gibt es nicht.');
      if (session.completedWorkoutId) return fail('Die Einheit ist schon erledigt.');
      if (session.status === 'skipped') return fail('Die Einheit fällt bereits aus.');
      s.workoutOverrides[change.slotId] = { slotId: change.slotId, status: 'skipped' };
      return { ok: true, title: `${session.template.name} fällt diese Woche aus`, trainingChanged: true };
    }

    case 'restoreWorkout': {
      const { session } = findSession(s, change.slotId);
      if (!session || !s.workoutOverrides[change.slotId]) return fail('Die Einheit ist bereits wie geplant.');
      if (session.originalDate < today) return fail('Der ursprüngliche Tag ist schon vorbei.');
      delete s.workoutOverrides[change.slotId];
      return { ok: true, title: `${session.template.name} wieder wie geplant`, trainingChanged: true };
    }

    case 'setDayContext': {
      const before = dayContextFor(s, change.date);
      const merged = { ...before, ...change.context };
      if (merged.timeBudget === DEFAULT_DAY_CONTEXT.timeBudget && merged.mode === DEFAULT_DAY_CONTEXT.mode) delete s.dayContexts[change.date];
      else s.dayContexts[change.date] = merged;
      // Training follows automatically (resolveWorkouts reads the context); meals are re-planned here.
      const replaced = merged.timeBudget !== before.timeBudget ? replanForTimeBudget(s, change.date, today) : [];
      return { ok: true, title: `${weekdayLong(weekdayIndex(change.date))}: ${TIME_BUDGETS[merged.timeBudget].label}`, replaced };
    }

    case 'addMeal': {
      if (!getRecipe(change.recipeId)) return fail('Rezept nicht gefunden.');
      // Adding to a past day means "I ate this" – logged right away.
      const isPast = change.date < today;
      const meal: PlannedMeal = {
        id: change.id ?? newId(),
        date: change.date,
        slot: change.slot,
        recipeId: change.recipeId,
        servings: change.servings,
        status: isPast ? 'eaten' : 'planned',
        source: 'user',
      };
      s.plannedMeals.push(meal);
      if (isPast) s.logEntries.push(logFromMeal(meal, nowIso));
      return { ok: true, title: isPast ? 'Mahlzeit erfasst' : 'Mahlzeit eingeplant' };
    }

    case 'replaceMeal': {
      const meal = s.plannedMeals.find((m) => m.id === change.mealId);
      const recipe = getRecipe(change.recipeId);
      if (!meal || !recipe) return fail('Mahlzeit nicht gefunden.');
      // Same calories as before unless servings are given.
      const servings = change.servings ?? roundServings(plannedMealMacros(meal).kcal / (recipeMacros(recipe).kcal || 1));
      meal.recipeId = recipe.id;
      meal.servings = servings;
      meal.source = 'swap';
      syncLog(s, meal);
      return { ok: true, title: 'Mahlzeit getauscht' };
    }

    case 'removeMeal': {
      if (!s.plannedMeals.some((m) => m.id === change.mealId)) return fail('Mahlzeit nicht gefunden.');
      s.plannedMeals = s.plannedMeals.filter((m) => m.id !== change.mealId);
      s.logEntries = s.logEntries.filter((e) => e.plannedMealId !== change.mealId);
      return { ok: true, title: 'Mahlzeit entfernt' };
    }

    case 'setServings': {
      const meal = s.plannedMeals.find((m) => m.id === change.mealId);
      if (!meal) return fail('Mahlzeit nicht gefunden.');
      meal.servings = change.servings;
      // The user decided – automatic rebalancing leaves this meal alone from now on.
      meal.servingsLocked = true;
      syncLog(s, meal);
      return { ok: true, title: 'Portionen geändert' };
    }

    case 'purchase': {
      const food = getFood(change.foodId);
      if (!food) return fail('Lebensmittel nicht gefunden.');
      const item = weekShopping(s, change.week, today).find((i) => i.foodId === change.foodId);
      const grams = change.grams ?? purchaseAmount(food, item ? item.remainingG || item.neededG : 0);
      if (grams <= 0) return fail('Keine Menge zum Einkaufen.');
      addToPantry(s, food.id, grams, nowIso);
      const w = shoppingWeek(s, change.week);
      w.purchased[food.id] = (w.purchased[food.id] ?? 0) + grams;
      return { ok: true, title: `${food.name} gekauft` };
    }

    case 'undoPurchase': {
      const w = shoppingWeek(s, change.week);
      const grams = w.purchased[change.foodId];
      if (!grams) return fail('Nichts zum Zurücknehmen.');
      addToPantry(s, change.foodId, -grams, nowIso);
      delete w.purchased[change.foodId];
      return { ok: true, title: `${getFood(change.foodId)?.name ?? 'Artikel'} wieder auf der Liste` };
    }

    case 'haveAtHome': {
      const item = weekShopping(s, change.week, today).find((i) => i.foodId === change.foodId);
      // The pantry now covers the week's need.
      if (item && item.remainingG > 0) addToPantry(s, change.foodId, item.remainingG, nowIso);
      return { ok: true, title: `${getFood(change.foodId)?.name ?? 'Artikel'}: hast du schon` };
    }

    case 'notAtHome': {
      setPantryQuantity(s, change.foodId, null, nowIso);
      return { ok: true, title: `${getFood(change.foodId)?.name ?? 'Artikel'} wieder auf der Liste` };
    }

    case 'setPantry': {
      const food = getFood(change.foodId);
      if (!food) return fail('Lebensmittel nicht gefunden.');
      setPantryQuantity(s, food.id, change.quantityG, nowIso);
      return { ok: true, title: change.quantityG ? `Vorrat: ${food.name} aktualisiert` : `Vorrat: ${food.name} leer` };
    }
  }
}

// ---------- Recalculation ----------

/**
 * F5: meals of `date` that no longer fit the day's time budget are re-planned
 * through the week planner (same scoring: nutrition, variety, ingredient
 * overlap, pantry, time). Only planner suggestions are exchanged – meals the
 * user picked, sized or already ate stay. Calories of the day stay the same
 * because the new picks fill exactly the space of the old ones.
 */
function replanForTimeBudget(s: AppState, date: ISODate, today: ISODate): Replacement[] {
  const target = dayTargetFor(s, date);
  if (date < today || !target || !s.nutritionProfile) return [];
  const budget = dayContextFor(s, date).timeBudget;
  const ws = weekStart(date);
  const weekMeals = s.plannedMeals.filter((m) => m.date >= ws && m.date <= addDays(ws, 6) && m.status !== 'skipped');
  const cooked = new Map<string, ISODate[]>();
  for (const m of weekMeals) cooked.set(m.recipeId, [...(cooked.get(m.recipeId) ?? []), m.date]);

  const tooLong = weekMeals.filter((m) => {
    if (m.date !== date || m.status !== 'planned' || m.source !== 'suggest' || m.servingsLocked) return false;
    const recipe = getRecipe(m.recipeId);
    return !!recipe && effectivePrepMin(recipe, date, cooked) > TIME_BUDGETS[budget].maxPrepMin;
  });
  if (tooLong.length === 0) return [];

  const ids = new Set(tooLong.map((m) => m.id));
  // The new picks take exactly the calorie space of the replaced meals – the
  // day total does not change, only what is cooked.
  const others = weekMeals.filter((m) => m.date === date && !ids.has(m.id));
  const space = sumMacros(tooLong.map(plannedMealMacros)).kcal;
  const picks = suggestWeek({
    dates: [date],
    slots: SLOT_ORDER.filter((slot) => tooLong.some((m) => m.slot === slot)),
    target: { ...target, kcal: sumMacros(others.map(plannedMealMacros)).kcal + space },
    profile: s.nutritionProfile,
    existing: weekMeals.filter((m) => !ids.has(m.id)),
    pantry: pantryEstimate(s),
    timeBudgetFor: (d) => dayContextFor(s, d).timeBudget,
    random: seededRandom(`${date}:${budget}`),
  });

  s.plannedMeals = [...s.plannedMeals.filter((m) => !ids.has(m.id)), ...picks];
  return tooLong
    .map((old) => ({ from: getRecipe(old.recipeId)!.title, to: getRecipe(picks.find((p) => p.slot === old.slot)?.recipeId ?? '')?.title ?? '' }))
    .filter((r) => r.to && r.to !== r.from);
}

/** "Training: Push (kurz) ~30 min" when a session's length changed. */
function diffTraining(before: AppState, after: AppState, week: ISODate): string[] {
  const resolve = (s: AppState) => resolveWorkouts(s.training, s.workoutOverrides, s.workouts, week, s.dayContexts);
  const old = new Map(resolve(before).map((w) => [w.id, w]));
  return resolve(after)
    .filter((w) => w.status !== 'skipped' && !w.completedWorkoutId)
    .filter((w) => {
      const prev = old.get(w.id);
      return prev && prev.status !== 'skipped' && estimateMinutes(prev.template) !== estimateMinutes(w.template);
    })
    .map((w) => `Training: ${w.template.name} ~${estimateMinutes(w.template)} min`);
}

/**
 * Applies changed day targets to the plan: only days from today on, only
 * still planned meals the user did not size manually. The day's delta is
 * spread proportionally, so the existing fit of the plan is preserved.
 */
function rebalanceWeek(before: AppState, after: AppState, week: ISODate, today: ISODate) {
  const targetChanges: ChangeSummary['targetChanges'] = [];
  const rebalanced: ChangeSummary['rebalanced'] = [];
  for (const date of weekDays(week)) {
    if (date < today) continue;
    const from = dayTargetFor(before, date)?.kcal;
    const to = dayTargetFor(after, date)?.kcal;
    if (from === undefined || to === undefined || from === to) continue;
    targetChanges.push({ date, fromKcal: from, toKcal: to });
    rebalanced.push(...rebalanceDay(after, date, to - from));
  }
  return { targetChanges, rebalanced };
}

export function rebalanceDay(draft: AppState, date: ISODate, deltaKcal: number): ChangeSummary['rebalanced'] {
  const flexible = draft.plannedMeals.filter((m) => m.date === date && m.status === 'planned' && !m.servingsLocked);
  const flexKcal = flexible.reduce((sum, m) => sum + plannedMealMacros(m).kcal, 0);
  if (flexKcal <= 0 || deltaKcal === 0) return [];
  const factor = Math.max(0, (flexKcal + deltaKcal) / flexKcal);

  const changed: ChangeSummary['rebalanced'] = [];
  for (const meal of flexible) {
    const to = roundServings(meal.servings * factor);
    if (to !== meal.servings) {
      changed.push({ mealId: meal.id, date, from: meal.servings, to });
      meal.servings = to;
    }
  }
  return changed;
}

function diffShopping(before: AppState, after: AppState, week: ISODate, today: ISODate): ChangeSummary['shopping'] {
  const open = (s: AppState) => new Map(weekShopping(s, week, today).filter((i) => i.state === 'open').map((i) => [i.foodId, i]));
  const a = open(before);
  const b = open(after);
  return {
    added: [...b.values()].filter((i) => !a.has(i.foodId)).map((i) => i.name),
    removed: [...a.values()].filter((i) => !b.has(i.foodId)).map((i) => i.name),
    changed: [...b.values()].filter((i) => a.has(i.foodId) && a.get(i.foodId)!.quantity !== i.quantity).map((i) => i.name),
  };
}

// ---------- Helpers ----------

function weekOfSlot(slotId: PlanSlotId): ISODate {
  return slotId.split('#')[0]!;
}

function findSession(s: AppState, slotId: PlanSlotId) {
  const plan = resolveWorkouts(s.training, s.workoutOverrides, s.workouts, weekOfSlot(slotId), s.dayContexts);
  return { plan, session: plan.find((p) => p.id === slotId) };
}

/** Week whose derived values (targets, shopping) a change affects. */
function weekOf(state: AppState, change: WeekChange, today: ISODate): ISODate {
  switch (change.type) {
    case 'moveWorkout':
    case 'skipWorkout':
    case 'restoreWorkout':
      return weekOfSlot(change.slotId);
    case 'setDayContext':
    case 'addMeal':
      return weekStart(change.date);
    case 'replaceMeal':
    case 'removeMeal':
    case 'setServings': {
      const meal = state.plannedMeals.find((m) => m.id === change.mealId);
      return weekStart(meal?.date ?? today);
    }
    case 'purchase':
    case 'undoPurchase':
    case 'haveAtHome':
    case 'notAtHome':
      return change.week;
    case 'setPantry':
      return weekStart(today);
  }
}

function shoppingWeek(s: AppState, week: ISODate): ShoppingWeekState {
  s.shopping[week] ??= { purchased: {}, manual: [] };
  return s.shopping[week]!;
}

/** Keeps the log entry of an eaten meal in sync with the plan. */
function syncLog(s: AppState, meal: PlannedMeal) {
  const entry = s.logEntries.find((e) => e.plannedMealId === meal.id);
  if (entry) Object.assign(entry, logFromMeal(meal, entry.loggedAt), { id: entry.id });
}

/** Typographic minus, like the rest of the UI ("−150"). */
const signed = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);
