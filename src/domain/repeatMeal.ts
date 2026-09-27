import { getRecipe } from '../data/recipes';
import type { EntryContent } from './foodEntry';
import { plannedMealMacros, sumMacros, ZERO_MACROS } from './nutrition';
import type { AppState, ISODate, LogEntry, Macros, MealSlot } from './types';

/**
 * "Wie gestern": what was really eaten in one meal slot of a day, ready to be
 * logged again with one tap. Eaten planned meals come back as their recipe
 * (same servings), everything logged outside the plan (products, own dishes,
 * manual and database foods, replacements) as a copy of its entry – the
 * values are the snapshot that was logged then, nothing is recomputed.
 */
export type RepeatItem =
  | { kind: 'recipe'; recipeId: string; servings: number; name: string; macros: Macros }
  | { kind: 'entry'; content: EntryContent & Pick<LogEntry, 'recipeId' | 'fromPantry'>; name: string; macros: Macros };

export interface SlotRepeat {
  items: RepeatItem[];
  macros: Macros;
}

/** The fields that describe WHAT was eaten – ids, day, slot and plan links are new for the copy. */
function contentOf(e: LogEntry): RepeatItem & { kind: 'entry' } {
  const { id: _id, date: _date, slot: _slot, loggedAt: _at, plannedMealId: _plan, replacedMealId: _replaced, ...content } = e;
  return { kind: 'entry', content, name: e.name, macros: e.macros };
}

export function slotRepeat(state: Pick<AppState, 'plannedMeals' | 'logEntries'>, date: ISODate, slot: MealSlot): SlotRepeat {
  const items: RepeatItem[] = [
    ...state.plannedMeals
      .filter((m) => m.date === date && m.slot === slot && m.status === 'eaten')
      .map((m): RepeatItem => ({ kind: 'recipe', recipeId: m.recipeId, servings: m.servings, name: getRecipe(m.recipeId)?.title ?? 'Mahlzeit', macros: plannedMealMacros(m) })),
    ...state.logEntries.filter((e) => e.date === date && e.slot === slot && !e.plannedMealId).map(contentOf),
  ];
  return { items, macros: items.length ? sumMacros(items.map((i) => i.macros)) : ZERO_MACROS };
}
