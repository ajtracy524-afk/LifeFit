import { getFood } from '../../data/foods';
import { getRecipe } from '../../data/recipes';
import { newId } from '../../lib/id';
import { SLOT_LABEL, weekdayLong, weekdayShort } from '../../lib/format';
import { addDays, toISODate, weekDays, weekStart, weekdayIndex } from '../dates';
import { logFromMeal, plannedMealMacros, recipeAllowed, recipeMacros, roundServings, sumMacros } from '../nutrition';
import { effectivePrepMin, SLOT_ORDER, slotShare } from '../planner';
import { DAY_MODE_LABEL, EATING_OUT_SLOTS, effectiveTimeBudget, excludedSlots, maxPrepFor, TIME_BUDGETS } from '../timeBudget';
import { activeWorkouts, estimateMinutes, resolveWorkouts, trainingWeekdays } from '../training';
import type { AppState, DayContext, ISODate, MealSlot, PlanSlotId, PlannedMeal, Recipe, ShoppingWeekState, TimeBudget } from '../types';
import { closeCompletedDays, dayTargetFor } from './dayTargets';
import { minutesOf } from '../schedule';
import { recordEvent } from '../learning';
import { addToPantry, purchaseAmount, setPantryQuantity } from './pantry';
import { mealAlternatives, mealPrepEnabled, planMeals, weekMeals } from './planning';
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
  /** `eaten: true` = "I ate this" today (e.g. a suggestion or "Anders gegessen → Gericht") – logged and learned right away. */
  | { type: 'addMeal'; date: ISODate; slot: MealSlot; recipeId: string; servings: number; id?: string; eaten?: boolean }
  /** `learn: false` for replacements the user did not choose themselves (accepted suggestions). */
  | { type: 'replaceMeal'; mealId: string; recipeId: string; servings?: number; learn?: boolean }
  | { type: 'removeMeal'; mealId: string }
  | { type: 'setServings'; mealId: string; servings: number }
  | { type: 'purchase'; week: ISODate; foodId: string; grams?: number }
  | { type: 'undoPurchase'; week: ISODate; foodId: string }
  | { type: 'haveAtHome'; week: ISODate; foodId: string }
  | { type: 'notAtHome'; week: ISODate; foodId: string }
  | { type: 'setPantry'; foodId: string; quantityG: number | null }
  /** F8: do not restock this basic this week ("Hab ich noch genug"). */
  | { type: 'skipRestock'; week: ISODate; foodId: string }
  /** Explicit "mag ich nicht" (hard filter) – future planner meals with it are re-planned. */
  | { type: 'setDislike'; foodId: string; disliked: boolean }
  /**
   * F1 weekly check-in: training days and day contexts of one week, then the
   * week is (re)planned from today on. One change → one undo.
   */
  | { type: 'planWeek'; week: ISODate; trainingDays: number[]; days: Record<ISODate, DayContext> };

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
type Mutation =
  /** `replacedInNotes`: the notes already describe the replacements (no generic line). */
  | { ok: true; title: string; trainingChanged?: boolean; replaced?: Replacement[]; notes?: string[]; replacedInNotes?: boolean }
  | { ok: false; reason: string };

const fail = (reason: string): Mutation => ({ ok: false, reason });

/**
 * The lived week is never rewritten: days before today are closed for planning
 * changes (contexts, re-planning). Today and the future may change. Completed
 * workouts are never touched, whatever the day.
 */
export function isClosedDay(date: ISODate, today: ISODate): boolean {
  return date < today;
}
const PAST_DAY = 'Vergangene Tage lassen sich nicht mehr umplanen.';

export function applyWeekChange(state: AppState, change: WeekChange, now: Date = new Date()): CascadeResult {
  const today = toISODate(now);
  // Completed days are frozen BEFORE anything changes – no change can rewrite them.
  state = closeCompletedDays(state, today);
  const week = weekOf(state, change, today);
  const next = structuredClone(state);

  const result = mutate(next, change, today, now.toISOString());
  if (!result.ok) return result;

  const { targetChanges, rebalanced } = result.trainingChanged ? rebalanceWeek(state, next, week, today) : { targetChanges: [], rebalanced: [] };
  const shopping = diffShopping(state, next, week, today);
  const training = diffTraining(state, next, week);

  const details: string[] = [...(result.notes ?? [])];
  if (result.replaced?.length && !result.replacedInNotes) {
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
      recordEvent(s, { type: 'workout_moved', from: session.date, to: change.toDate }, nowIso);
      return { ok: true, title: `${session.template.name} auf ${weekdayLong(weekdayIndex(change.toDate))} verschoben`, trainingChanged: true };
    }

    case 'skipWorkout': {
      const { session } = findSession(s, change.slotId);
      if (!session) return fail('Diese Einheit gibt es nicht.');
      if (session.completedWorkoutId) return fail('Die Einheit ist schon erledigt.');
      if (session.status === 'skipped') return fail('Die Einheit fällt bereits aus.');
      s.workoutOverrides[change.slotId] = { slotId: change.slotId, status: 'skipped' };
      recordEvent(s, { type: 'workout_skipped', date: session.date }, nowIso);
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
      if (isClosedDay(change.date, today)) return fail(PAST_DAY);
      const before = dayContextFor(s, change.date);
      const merged: DayContext = { ...before, ...change.context };
      // Back to "Zuhause" means dinner at home is planned again – a removed dinner opens again too.
      if (before.mode === 'eating_out' && merged.mode === 'normal' && merged.removedSlots) merged.removedSlots = merged.removedSlots.filter((slot) => !EATING_OUT_SLOTS.includes(slot));
      storeDayContext(s, change.date, merged);
      // Training follows automatically (resolveWorkouts reads the context); meals are adapted here.
      const notes = applyModeToMeals(s, change.date, before, merged, today);
      const retimed = effectiveTimeBudget(merged) !== effectiveTimeBudget(before) ? retimeDay(s, change.date, today, nowIso, effectiveTimeBudget(before)) : undefined;
      if (retimed) notes.push(...retimed.notes);
      const label = merged.mode !== before.mode ? DAY_MODE_LABEL[merged.mode] : TIME_BUDGETS[merged.timeBudget].label;
      return { ok: true, title: `${weekdayLong(weekdayIndex(change.date))}: ${label}`, replaced: retimed?.replaced ?? [], notes, replacedInNotes: true };
    }

    case 'planWeek':
      return planWeek(s, change, today);

    case 'addMeal': {
      if (!getRecipe(change.recipeId)) return fail('Rezept nicht gefunden.');
      // Adding to a past day means "I ate this" – logged right away.
      const isPast = change.date < today;
      if (change.eaten && change.date > today) return fail('Essen in der Zukunft lässt sich noch nicht erfassen.');
      const eaten = isPast || !!change.eaten;
      if (change.id && s.plannedMeals.some((m) => m.id === change.id)) return fail('Diese Mahlzeit ist schon erfasst.');
      const meal: PlannedMeal = {
        id: change.id ?? newId(),
        date: change.date,
        slot: change.slot,
        recipeId: change.recipeId,
        servings: change.servings,
        status: eaten ? 'eaten' : 'planned',
        source: 'user',
      };
      s.plannedMeals.push(meal);
      // Planning something into a removed slot opens it again.
      if (dayContextFor(s, meal.date).removedSlots?.includes(meal.slot)) setSlotRemoved(s, meal.date, meal.slot, false);
      if (eaten) s.logEntries.push(logFromMeal(meal, nowIso));
      if (change.eaten) {
        const timeBudget = effectiveTimeBudget(dayContextFor(s, meal.date));
        recordEvent(s, { type: 'meal_eaten', recipeId: meal.recipeId, slot: meal.slot, timeBudget }, nowIso);
      }
      return { ok: true, title: eaten ? 'Mahlzeit erfasst' : 'Mahlzeit eingeplant' };
    }

    case 'replaceMeal': {
      const meal = s.plannedMeals.find((m) => m.id === change.mealId);
      const recipe = getRecipe(change.recipeId);
      if (!meal || !recipe) return fail('Mahlzeit nicht gefunden.');
      // Same calories as before unless servings are given.
      const servings = change.servings ?? roundServings(plannedMealMacros(meal).kcal / (recipeMacros(recipe).kcal || 1));
      if (change.learn !== false && meal.recipeId !== recipe.id) {
        const timeBudget = effectiveTimeBudget(dayContextFor(s, meal.date));
        recordEvent(s, { type: 'meal_swapped', fromRecipeId: meal.recipeId, toRecipeId: recipe.id, slot: meal.slot, timeBudget }, nowIso);
        meal.replacedRecipeId = meal.recipeId;
      }
      meal.recipeId = recipe.id;
      meal.servings = servings;
      meal.source = 'swap';
      syncLog(s, meal);
      return { ok: true, title: 'Mahlzeit getauscht' };
    }

    case 'removeMeal': {
      const meal = s.plannedMeals.find((m) => m.id === change.mealId);
      if (!meal) return fail('Mahlzeit nicht gefunden.');
      s.plannedMeals = s.plannedMeals.filter((m) => m.id !== change.mealId);
      s.logEntries = s.logEntries.filter((e) => e.plannedMealId !== change.mealId);
      // Removing is a decision about the slot: it stays closed for the day (no open task, no re-planning)
      // as long as nothing else is planned there.
      if (meal.date >= today && !s.plannedMeals.some((m) => m.date === meal.date && m.slot === meal.slot && m.status !== 'skipped')) setSlotRemoved(s, meal.date, meal.slot, true);
      return { ok: true, title: `${SLOT_LABEL[meal.slot]} entfernt` };
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

    case 'setDislike': {
      const food = getFood(change.foodId);
      if (!food || !s.nutritionProfile) return fail('Lebensmittel nicht gefunden.');
      const current = new Set(s.nutritionProfile.dislikedFoods ?? []);
      if (change.disliked) current.add(food.id);
      else current.delete(food.id);
      s.nutritionProfile = { ...s.nutritionProfile, dislikedFoods: [...current] };
      const replaced: Replacement[] = [];
      if (change.disliked) {
        const dates = [...new Set(s.plannedMeals.filter((m) => m.date >= today && m.status === 'planned').map((m) => m.date))].sort();
        for (const date of dates) replaced.push(...replanMealsOn(s, date, today, `${date}:no-${food.id}`, (r) => r.ingredients.some((i) => i.foodId === food.id)));
      }
      return { ok: true, title: change.disliked ? `${food.name} wird nicht mehr eingeplant` : `${food.name} wieder erlaubt`, replaced };
    }

    case 'skipRestock': {
      const w = shoppingWeek(s, change.week);
      w.restockSkipped = [...new Set([...(w.restockSkipped ?? []), change.foodId])];
      return { ok: true, title: `${getFood(change.foodId)?.name ?? 'Artikel'}: diese Woche nicht nachkaufen` };
    }

    case 'setPantry': {
      const food = getFood(change.foodId);
      if (!food) return fail('Lebensmittel nicht gefunden.');
      setPantryQuantity(s, food.id, change.quantityG, nowIso);
      return { ok: true, title: change.quantityG ? `Vorrat: ${food.name} aktualisiert` : `Vorrat: ${food.name} aufgebraucht` };
    }
  }
}

// ---------- Day modes & weekly check-in (F1) ----------

function storeDayContext(s: AppState, date: ISODate, context: DayContext) {
  const removed = context.removedSlots?.length ? { removedSlots: [...context.removedSlots] } : {};
  if (context.timeBudget === DEFAULT_DAY_CONTEXT.timeBudget && context.mode === DEFAULT_DAY_CONTEXT.mode && !removed.removedSlots) delete s.dayContexts[date];
  else s.dayContexts[date] = { timeBudget: context.timeBudget, mode: context.mode, ...removed };
}

/** Opens or closes a meal slot of a day (see DayContext.removedSlots). */
function setSlotRemoved(s: AppState, date: ISODate, slot: MealSlot, removed: boolean) {
  const context = dayContextFor(s, date);
  const rest = (context.removedSlots ?? []).filter((x) => x !== slot);
  storeDayContext(s, date, { ...context, removedSlots: removed ? [...rest, slot] : rest });
}

/**
 * "Auswärts": the planned dinner is marked skipped – it leaves the shopping
 * list, stays visible, and comes back when the exception is removed.
 */
function applyModeToMeals(s: AppState, date: ISODate, before: DayContext, after: DayContext, today: ISODate): string[] {
  if (date < today) return [];
  const wasOut = excludedSlots(before);
  const isOut = excludedSlots(after);
  const notes: string[] = [];

  const leaving = s.plannedMeals.filter((m) => m.date === date && isOut.includes(m.slot) && !wasOut.includes(m.slot) && m.status === 'planned');
  for (const m of leaving) {
    m.status = 'skipped';
    m.skippedFor = 'eating_out';
  }
  if (leaving.length) notes.push(`${leaving.map((m) => SLOT_LABEL[m.slot]).join(', ')} auswärts – aus dem Plan genommen`);

  const back = wasOut.filter((slot) => !isOut.includes(slot));
  if (back.length) {
    // Only what "Auswärts" took out comes back – an own "Anders gegessen" stays as the user left it.
    const restored = s.plannedMeals.filter((m) => m.date === date && back.includes(m.slot) && m.status === 'skipped' && m.skippedFor === 'eating_out' && !s.logEntries.some((e) => e.replacedMealId === m.id));
    for (const m of restored) {
      m.status = 'planned';
      delete m.skippedFor;
    }
    const missing = back.filter((slot) => !s.plannedMeals.some((m) => m.date === date && m.slot === slot && m.status !== 'skipped'));
    if (missing.length) s.plannedMeals.push(...planMeals(s, { dates: [date], today, seed: `${date}:${after.mode}`, slots: missing }));
    notes.push(`${back.map((slot) => SLOT_LABEL[slot]).join(', ')} wieder eingeplant`);
  }
  return notes;
}

/**
 * Weekly check-in. Only what the check-in owns is replaced: training days of
 * this week, the day contexts and the planner's suggestions from today on.
 * Past days, eaten meals and meals the user picked or sized stay.
 */
function planWeek(s: AppState, change: Extract<WeekChange, { type: 'planWeek' }>, today: ISODate): Mutation {
  const { week } = change;
  if (!s.training || !s.nutritionProfile || !dayTargetFor(s, week)) return fail('Bitte zuerst Ziel und Profil einrichten.');
  const dates = weekDays(week);
  const open = dates.filter((d) => !isClosedDay(d, today));
  if (open.length === 0) return fail('Diese Woche ist schon vorbei.');

  // 1. Training days of this week. Past days and days with a completed session
  //    stay as they were; only open days follow the check-in.
  const sessions = resolveWorkouts(s.training, s.workoutOverrides, s.workouts, week, s.dayContexts);
  const doneDays = new Set(sessions.filter((w) => w.completedWorkoutId).map((w) => weekdayIndex(w.originalDate)));
  const locked = (weekday: number) => isClosedDay(dates[weekday]!, today) || doneDays.has(weekday);
  const current = trainingWeekdays(s.training, week);
  const days = [...new Set([...current.filter(locked), ...change.trainingDays.filter((d) => !locked(d))])].sort((a, b) => a - b);
  s.training.weekOverrides = { ...(s.training.weekOverrides ?? {}) };
  if (days.join() === [...s.training.weekdays].sort((a, b) => a - b).join()) delete s.training.weekOverrides[week];
  else s.training.weekOverrides[week] = days;
  // Session ids of this week are re-numbered – moves/skips of open sessions no longer apply.
  const completed = new Set(s.workouts.filter((w) => w.status === 'completed' && w.plannedId).map((w) => w.plannedId));
  for (const id of Object.keys(s.workoutOverrides)) if (id.startsWith(`${week}#`) && !completed.has(id)) delete s.workoutOverrides[id];

  // 2. Day contexts; 3. meal exceptions of the chosen modes.
  const notes: string[] = [];
  for (const date of open) {
    const before = dayContextFor(s, date);
    // The check-in sets time and dinner place; meals the user removed stay removed.
    const after = { ...(change.days[date] ?? DEFAULT_DAY_CONTEXT), ...(before.removedSlots ? { removedSlots: before.removedSlots } : {}) };
    storeDayContext(s, date, after);
    applyModeToMeals(s, date, before, after, today);
  }

  // 4. Re-plan: planner suggestions are replaced, everything else is fixed input.
  const last = dates[6]!;
  s.plannedMeals = s.plannedMeals.filter(
    (m) => !(m.date >= today && m.date >= week && m.date <= last && m.status === 'planned' && m.source === 'suggest' && !m.servingsLocked),
  );
  const added = planMeals(s, { dates: open, today, seed: week });
  const slots = s.nutritionProfile.slots;
  const freeSlots = open.some((d) => slots.some((slot) => !excludedSlots(dayContextFor(s, d)).includes(slot) && !s.plannedMeals.some((m) => m.date === d && m.slot === slot)));
  if (added.length === 0 && freeSlots) return fail('Für diese Vorgaben gibt es keine passenden Rezepte. Deine bisherige Woche bleibt unverändert.');
  s.plannedMeals.push(...added);

  const planned = activeWorkouts(s.training, s.workoutOverrides, s.workouts, week, s.dayContexts).filter((w) => w.date >= today);
  const exceptions = open.filter((d) => dayContextFor(s, d).mode !== 'normal');
  notes.push(`${planned.length} ${planned.length === 1 ? 'Training' : 'Trainings'} · ${added.length} Mahlzeiten geplant`);
  if (exceptions.length) notes.push(exceptions.map((d) => `${weekdayShort(weekdayIndex(d))} ${DAY_MODE_LABEL[dayContextFor(s, d).mode]}`).join(', '));
  return { ok: true, title: 'Woche geplant', notes };
}

// ---------- Recalculation ----------

/**
 * Minimum improvement of the planner's week score for an automatic exchange
 * after the time budget changed. Below it the meal stays – the plan does not
 * jump back and forth for marginal differences. (For scale: 10 min beyond the
 * budget cost 0.4, the "viel Zeit" bonus is 0.05.)
 */
export const RETIME_MIN_GAIN = 0.03;

/**
 * F5, both directions: after the time budget of a day changed, every planner
 * meal of that day is re-evaluated with the planner's own score under the new
 * budget (time, protein, variety, pantry, budget, preferences, training). A
 * meal is exchanged only if the best alternative is better by at least
 * RETIME_MIN_GAIN. Never touched: eaten or skipped meals, meals the user
 * chose or sized, and today's meals whose time has passed. The replacement
 * keeps the meal's calories and id (servings scaled).
 */
/**
 * All feedback of a time-budget change in one place. Kept meals are explained
 * as a decision ("no clearly better alternative"), never as something missed.
 */
export const RETIME_TEXT = {
  adapted: (r: Replacement[]) => `${r.length} ${r.length === 1 ? 'Gericht' : 'Gerichte'} angepasst: ${r.map((x) => `${x.from} → ${x.to}`).join(', ')}`,
  /** Less time, nothing to change: everything already fits. */
  fits: 'Alle geplanten Gerichte passen bereits zu deiner verfügbaren Zeit.',
  /** More time, nothing clearly better: the (quick) meals stay – on purpose. */
  kept: (count: number, quick: boolean) =>
    `${count === 1 ? `Dein ${quick ? 'schnelles ' : ''}Gericht bleibt` : `Deine ${quick ? 'schnellen ' : ''}Gerichte bleiben`} geplant – aktuell gibt es keine deutlich passendere Alternative.`,
  own: (count: number) => `${count} selbst gewählte${count === 1 ? 's Gericht blieb' : ' Gerichte blieben'} unverändert`,
};

const BUDGET_RANK: Record<TimeBudget, number> = { low: 0, normal: 1, high: 2 };

function retimeDay(s: AppState, date: ISODate, today: ISODate, nowIso: string, previous: TimeBudget): { replaced: Replacement[]; notes: string[] } {
  const now = new Date(nowIso);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const planned = s.plannedMeals
    .filter((m) => m.date === date && m.status === 'planned')
    .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  const own = planned.filter((m) => m.source !== 'suggest' || m.servingsLocked);
  const isPast = (m: PlannedMeal) => date === today && minutesOf(s.plannerSettings.mealTimes[m.slot]) <= nowMin;
  const candidates = planned.filter((m) => !own.includes(m) && !isPast(m));

  const maxPrep = maxPrepFor(s.plannerSettings, dayContextFor(s, date), date);
  const replaced: Replacement[] = [];
  for (const meal of candidates) {
    // Meal-prep leftovers of the previous days count as quick (same rule as the planner).
    const cooked = new Map<string, ISODate[]>();
    for (const m of weekMeals(s, date)) if (m.id !== meal.id) cooked.set(m.recipeId, [...(cooked.get(m.recipeId) ?? []), m.date]);
    const fits = (r: Recipe) => effectivePrepMin(r, date, cooked, mealPrepEnabled(s)) <= maxPrep;
    const options = mealAlternatives(s, meal, today, { includeCurrent: true, limit: Number.POSITIVE_INFINITY });
    // The time budget is the reason for this re-evaluation: only meals that fit it are offered (if any exist).
    const fitting = options.filter((o) => fits(o.recipe));
    const best = (fitting.length ? fitting : options)[0];
    if (!best || best.recipe.id === meal.recipeId) continue;
    const current = options.find((o) => o.recipe.id === meal.recipeId);
    const currentFits = !!current && fits(current.recipe);
    // A meal that does not fit the time goes (if something fits); otherwise only a clearly better one replaces it.
    // A recipe that is no longer allowed (e.g. disliked) has no score – always exchanged.
    if (current && (currentFits || !fitting.length) && current.score - best.score < RETIME_MIN_GAIN) continue;
    replaced.push({ from: getRecipe(meal.recipeId)?.title ?? '', to: best.recipe.title });
    meal.recipeId = best.recipe.id;
    meal.servings = best.servings;
  }

  const notes: string[] = [];
  const moreTime = BUDGET_RANK[effectiveTimeBudget(dayContextFor(s, date))] > BUDGET_RANK[previous];
  if (replaced.length) notes.push(RETIME_TEXT.adapted(replaced));
  else if (candidates.length && moreTime) notes.push(RETIME_TEXT.kept(candidates.length, candidates.every((m) => (getRecipe(m.recipeId)?.prepMin ?? 99) <= TIME_BUDGETS.low.maxPrepMin)));
  else if (candidates.length) notes.push(RETIME_TEXT.fits);
  if (own.length) notes.push(RETIME_TEXT.own(own.length));
  return { replaced, notes };
}

/**
 * Re-plans the planner's own meals of one open day that match `replace`,
 * through the week planner (same scoring: nutrition, variety, overlap, pantry,
 * time, budget, preferences). Meals the user picked, sized or ate stay. The
 * new picks fill exactly the calorie space of the old ones – the day total
 * does not change, only what is cooked.
 */
function replanMealsOn(s: AppState, date: ISODate, today: ISODate, seed: string, replace: (recipe: Recipe) => boolean, includeFixed = false): Replacement[] {
  if (date < today || !dayTargetFor(s, date) || !s.nutritionProfile) return [];
  const week = weekMeals(s, date);
  const affected = week.filter((m) => {
    if (m.date !== date || m.status !== 'planned') return false;
    if (!includeFixed && (m.source !== 'suggest' || m.servingsLocked)) return false;
    const recipe = getRecipe(m.recipeId);
    return !!recipe && replace(recipe);
  });
  if (affected.length === 0) return [];

  const ids = new Set(affected.map((m) => m.id));
  const others = week.filter((m) => m.date === date && !ids.has(m.id));
  const dayKcal = sumMacros([...others, ...affected].map(plannedMealMacros)).kcal;
  const picks = planMeals(s, {
    dates: [date],
    today,
    seed,
    slots: SLOT_ORDER.filter((slot) => affected.some((m) => m.slot === slot)),
    existing: week.filter((m) => !ids.has(m.id)),
    targetKcalFor: () => dayKcal,
  });

  s.plannedMeals = [...s.plannedMeals.filter((m) => !ids.has(m.id)), ...picks];
  return affected
    .map((old) => ({ from: getRecipe(old.recipeId)!.title, to: getRecipe(picks.find((p) => p.slot === old.slot)?.recipeId ?? '')?.title ?? '' }))
    .filter((r) => r.to && r.to !== r.from);
}

/**
 * After the hard exclusions changed (Prompt 4): every planned meal from today on
 * that the filter forbids now is replaced – also meals the user chose, because an
 * allergen must never stay in the plan. Mutates the draft.
 */
export function replanForbidden(s: AppState, today: ISODate): Replacement[] {
  if (!s.nutritionProfile) return [];
  const profile = s.nutritionProfile;
  const dates = [...new Set(s.plannedMeals.filter((m) => m.date >= today && m.status === 'planned').map((m) => m.date))].sort();
  return dates.flatMap((date) => replanMealsOn(s, date, today, `${date}:allowed`, (r) => !recipeAllowed(r, profile), true));
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
    // On an eating-out day the dinner's share of the change belongs to the restaurant meal.
    const profileSlots = after.nutritionProfile?.slots ?? [];
    const out = excludedSlots(dayContextFor(after, date)).filter((sl) => profileSlots.includes(sl));
    const share = out.length ? 1 - slotShare(out, profileSlots) : 1;
    rebalanced.push(...rebalanceDay(after, date, (to - from) * share));
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
    case 'planWeek':
      return change.week;
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
    case 'skipRestock':
      return change.week;
    case 'setPantry':
    case 'setDislike':
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
