import type { Food, Recipe } from '../domain/types';

/**
 * Personal registry: the user's own products (and database ingredients of own
 * dishes) as foods, and own dishes as recipes – so getFood / getRecipe and the
 * planner's candidate list know them like catalog entries. Filled only by
 * domain/personal.ts (syncPersonal) from the state; nothing is stored here.
 */
let foods = new Map<string, Food>();
let recipes = new Map<string, Recipe>();
let candidates: Recipe[] = [];

export function setPersonal(nextFoods: Map<string, Food>, nextRecipes: Map<string, Recipe>, nextCandidates: Recipe[]): void {
  foods = nextFoods;
  recipes = nextRecipes;
  candidates = nextCandidates;
}

export const personalFood = (id: string): Food | undefined => foods.get(id);
export const personalRecipe = (id: string): Recipe | undefined => recipes.get(id);
/** Own dishes the planner may suggest (with meal slots and complete values, not archived). */
export const personalCandidates = (): Recipe[] => candidates;

/** Ids of personal foods carry their origin – catalog ids never contain a colon. */
export const isPersonalFoodId = (id: string): boolean => id.includes(':');
