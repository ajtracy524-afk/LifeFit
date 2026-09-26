import { getFood } from './foods';
import { RECIPES } from './recipes';
import type { MealStyle, Recipe } from '../domain/types';

/**
 * "Was würdest du gern häufiger essen?" – the choices of the onboarding and
 * the profile. Each taste is defined by what really is in a recipe (a main
 * ingredient, a recipe, a title word), so the planner can use it and the
 * "Warum?" explanation can name it truthfully.
 */
export interface Taste {
  id: string;
  label: string;
  emoji: string;
  group: 'breakfast' | 'main';
  /** A recipe matches if one of these foods is a main ingredient (≥ minG per serving). */
  foods?: string[];
  minG?: number;
  recipes?: string[];
  test?: (recipe: Recipe) => boolean;
}

const hasMeatOrFish = (r: Recipe) => r.ingredients.some((i) => getFood(i.foodId)?.vegetarian === false);

export const TASTES: Taste[] = [
  { id: 'oats', label: 'Haferflocken / Porridge', emoji: '🥣', group: 'breakfast', foods: ['oats'], minG: 50 },
  { id: 'eggs', label: 'Eier', emoji: '🍳', group: 'breakfast', foods: ['egg'], minG: 60 },
  { id: 'bread', label: 'Brot / Brötchen', emoji: '🍞', group: 'breakfast', foods: ['bread', 'toast'] },
  { id: 'yogurt', label: 'Joghurt / Skyr', emoji: '🥛', group: 'breakfast', foods: ['skyr', 'greek-yogurt', 'quark'], minG: 100 },
  { id: 'muesli', label: 'Müsli', emoji: '🌾', group: 'breakfast', recipes: ['skyr-bowl', 'overnight-oats'] },
  { id: 'pancakes', label: 'Protein-Pancakes', emoji: '🥞', group: 'breakfast', recipes: ['protein-pancakes'] },
  { id: 'smoothie', label: 'Shake / Smoothie', emoji: '🥤', group: 'breakfast', recipes: ['protein-shake'] },
  { id: 'fruit', label: 'Früchte', emoji: '🍓', group: 'breakfast', foods: ['banana', 'apple', 'berries', 'orange'], minG: 80 },

  { id: 'pasta', label: 'Pasta', emoji: '🍝', group: 'main', foods: ['pasta', 'couscous'] },
  { id: 'rice', label: 'Reisgerichte', emoji: '🍚', group: 'main', foods: ['rice'] },
  { id: 'potatoes', label: 'Kartoffeln', emoji: '🥔', group: 'main', foods: ['potato', 'sweet-potato'] },
  { id: 'chicken', label: 'Chicken', emoji: '🍗', group: 'main', foods: ['chicken'] },
  { id: 'beef', label: 'Rind', emoji: '🥩', group: 'main', foods: ['beef-mince'] },
  { id: 'fish', label: 'Fisch', emoji: '🐟', group: 'main', foods: ['salmon', 'tuna'] },
  { id: 'veggie', label: 'Vegetarische Gerichte', emoji: '🥦', group: 'main', test: (r) => (r.slots.includes('lunch') || r.slots.includes('dinner')) && !hasMeatOrFish(r) },
  { id: 'legumes', label: 'Hülsenfrüchte', emoji: '🫘', group: 'main', foods: ['lentils', 'chickpeas', 'kidney', 'edamame'] },
  { id: 'salad', label: 'Salate', emoji: '🥗', group: 'main', foods: ['lettuce'], minG: 30, test: (r) => /salat/i.test(r.title) },
  { id: 'wraps', label: 'Wraps', emoji: '🌯', group: 'main', foods: ['wrap'] },
  { id: 'bowls', label: 'Bowls', emoji: '🥙', group: 'main', test: (r) => /bowl/i.test(r.title) },
];

export function tasteMatches(taste: Taste, recipe: Recipe): boolean {
  if (taste.recipes?.includes(recipe.id)) return true;
  if (taste.foods && recipe.ingredients.some((i) => taste.foods!.includes(i.foodId) && i.grams >= (taste.minG ?? 40))) return true;
  return !!taste.test?.(recipe);
}

/** Taste id → recipes it matches. The catalog is static, so this is built once. */
export const TASTE_RECIPES: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  TASTES.map((t) => [t.id, new Set(RECIPES.filter((r) => tasteMatches(t, r)).map((r) => r.id))]),
);

export function getTaste(id: string): Taste | undefined {
  return TASTES.find((t) => t.id === id);
}

/** Kinds of meals – described by what they are, never as better or worse. */
export const MEAL_STYLES: { id: MealStyle; label: string; description: string }[] = [
  { id: 'light', label: 'Leicht & voluminös', description: 'Viel auf dem Teller für wenig Kalorien – Gemüse, Protein, große Bowls.' },
  { id: 'balanced', label: 'Ausgewogen', description: 'Normale, gemischte Mahlzeiten ohne Schwerpunkt.' },
  { id: 'hearty', label: 'Energiereich', description: 'Mehr Energie in kleineren Portionen – Reis, Pasta, Nüsse, Porridge.' },
];

/** kcal per 100 g of a serving: ≤ 105 counts as light and voluminous, ≥ 130 as energy-dense (catalog tertiles). */
export const STYLE_DENSITY = { lightMax: 105, heartyMin: 130 } as const;
