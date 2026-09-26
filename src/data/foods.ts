import type { Allergen, Food, Micros, ShoppingCategory } from '../domain/types';
import { FOOD_MICROS } from './foodMicros';
import { SALT_PER_SODIUM } from './nutrients';

/** Supermarket walking order, used to sort the shopping list. */
export const CATEGORIES: { id: ShoppingCategory; label: string }[] = [
  { id: 'produce', label: 'Obst & Gemüse' },
  { id: 'bakery_grains', label: 'Brot, Getreide & Nudeln' },
  { id: 'meat_fish', label: 'Fleisch & Fisch' },
  { id: 'dairy', label: 'Kühlregal & Eier' },
  { id: 'canned', label: 'Konserven & Hülsenfrüchte' },
  { id: 'frozen', label: 'Tiefkühl' },
  { id: 'pantry', label: 'Vorrat & Sonstiges' },
];

type FoodInput = [
  id: string,
  name: string,
  category: ShoppingCategory,
  kcal: number,
  protein: number,
  carbs: number,
  fat: number,
  diet: 'vegan' | 'vegetarian' | 'meat',
  allergens?: Allergen[],
  extra?: Partial<Pick<Food, 'pieceG' | 'pieceLabel' | 'packageG'>>,
];

// Values per 100 g (cooked products: as sold; grains/pasta/legumes: dry unless noted).
const RAW: FoodInput[] = [
  // Obst & Gemüse
  ['broccoli', 'Brokkoli', 'produce', 35, 2.8, 2.7, 0.4, 'vegan', [], { packageG: 500 }],
  ['bell-pepper', 'Paprika', 'produce', 31, 1, 6, 0.3, 'vegan', [], { pieceG: 150, pieceLabel: 'Stück' }],
  ['zucchini', 'Zucchini', 'produce', 19, 1.6, 2.2, 0.4, 'vegan', [], { pieceG: 250, pieceLabel: 'Stück' }],
  ['tomato', 'Tomaten', 'produce', 18, 0.9, 2.6, 0.2, 'vegan', [], { pieceG: 80, pieceLabel: 'Stück' }],
  ['cucumber', 'Gurke', 'produce', 12, 0.6, 1.8, 0.2, 'vegan', [], { pieceG: 400, pieceLabel: 'Stück' }],
  ['onion', 'Zwiebeln', 'produce', 40, 1.2, 7.6, 0.2, 'vegan', [], { pieceG: 100, pieceLabel: 'Stück' }],
  ['potato', 'Kartoffeln', 'produce', 72, 2, 15.4, 0.1, 'vegan', [], { packageG: 1500 }],
  ['sweet-potato', 'Süßkartoffeln', 'produce', 86, 1.6, 20, 0.1, 'vegan', [], { packageG: 1000 }],
  ['banana', 'Bananen', 'produce', 93, 1.2, 20, 0.2, 'vegan', [], { pieceG: 120, pieceLabel: 'Stück' }],
  ['apple', 'Äpfel', 'produce', 54, 0.3, 11.4, 0.2, 'vegan', [], { pieceG: 150, pieceLabel: 'Stück' }],
  ['avocado', 'Avocado', 'produce', 160, 2, 3.6, 15, 'vegan', [], { pieceG: 140, pieceLabel: 'Stück' }],
  ['lettuce', 'Blattsalat / Rucola', 'produce', 25, 2.6, 2, 0.7, 'vegan', [], { packageG: 125 }],

  // Brot, Getreide & Nudeln
  ['oats', 'Haferflocken', 'bakery_grains', 372, 13.5, 58.7, 7, 'vegan', ['gluten'], { packageG: 500 }],
  ['rice', 'Basmatireis', 'bakery_grains', 350, 8, 77, 0.6, 'vegan', [], { packageG: 1000 }],
  ['pasta', 'Vollkornnudeln', 'bakery_grains', 350, 13, 64, 2.5, 'vegan', ['gluten'], { packageG: 500 }],
  ['couscous', 'Couscous', 'bakery_grains', 360, 12, 70, 1.5, 'vegan', ['gluten'], { packageG: 500 }],
  ['quinoa', 'Quinoa', 'bakery_grains', 360, 14, 60, 6, 'vegan', [], { packageG: 500 }],
  ['bread', 'Vollkornbrot', 'bakery_grains', 215, 7, 39, 1.5, 'vegan', ['gluten'], { pieceG: 50, pieceLabel: 'Scheibe', packageG: 500 }],
  ['wrap', 'Weizen-Wraps', 'bakery_grains', 310, 8.5, 52, 7, 'vegan', ['gluten'], { pieceG: 60, pieceLabel: 'Wrap', packageG: 360 }],
  ['rice-cakes', 'Reiswaffeln', 'bakery_grains', 390, 8, 81, 3, 'vegan', [], { pieceG: 8, pieceLabel: 'Stück', packageG: 100 }],

  // Fleisch & Fisch
  ['chicken', 'Hähnchenbrust', 'meat_fish', 110, 23.5, 0, 1.5, 'meat', [], { packageG: 400 }],
  ['beef-mince', 'Rinderhack (5 % Fett)', 'meat_fish', 125, 21.2, 0, 4.5, 'meat', [], { packageG: 400 }],
  ['salmon', 'Lachsfilet', 'meat_fish', 200, 20, 0, 13, 'meat', ['fish'], { pieceG: 125, pieceLabel: 'Filet', packageG: 250 }],

  // Kühlregal & Eier
  ['egg', 'Eier', 'dairy', 143, 12.6, 0.7, 9.5, 'vegetarian', [], { pieceG: 60, pieceLabel: 'Ei', packageG: 600 }],
  ['milk', 'Milch 1,5 %', 'dairy', 47, 3.4, 4.8, 1.5, 'vegetarian', ['lactose'], { packageG: 1000 }],
  ['skyr', 'Skyr natur', 'dairy', 63, 11, 4, 0.2, 'vegetarian', ['lactose'], { packageG: 450 }],
  ['quark', 'Magerquark', 'dairy', 67, 12, 4, 0.2, 'vegetarian', ['lactose'], { packageG: 500 }],
  ['cottage', 'Körniger Frischkäse', 'dairy', 98, 12.3, 1.5, 4.3, 'vegetarian', ['lactose'], { packageG: 200 }],
  ['feta', 'Feta', 'dairy', 260, 16, 0.5, 21, 'vegetarian', ['lactose'], { packageG: 200 }],
  ['mozzarella', 'Mozzarella light', 'dairy', 160, 19, 1, 9, 'vegetarian', ['lactose'], { packageG: 125 }],
  ['tofu', 'Tofu natur', 'dairy', 130, 14, 1.5, 7.5, 'vegan', [], { packageG: 200 }],

  // Konserven & Hülsenfrüchte
  ['tuna', 'Thunfisch naturell (abgetropft)', 'canned', 110, 25, 0, 1, 'meat', ['fish'], { packageG: 130 }],
  ['kidney', 'Kidneybohnen (abgetropft)', 'canned', 90, 6.6, 11, 0.5, 'vegan', [], { packageG: 250 }],
  ['chickpeas', 'Kichererbsen (abgetropft)', 'canned', 118, 6.9, 14.5, 2.4, 'vegan', [], { packageG: 265 }],
  ['corn', 'Mais (abgetropft)', 'canned', 80, 2.9, 13, 1.2, 'vegan', [], { packageG: 140 }],
  ['canned-tomato', 'Gehackte Tomaten', 'canned', 24, 1.2, 3.5, 0.2, 'vegan', [], { packageG: 400 }],
  ['lentils', 'Rote Linsen', 'canned', 340, 24, 48, 1.5, 'vegan', [], { packageG: 500 }],

  // Tiefkühl
  ['berries', 'Beerenmischung (TK)', 'frozen', 45, 1, 9, 0.4, 'vegan', [], { packageG: 500 }],
  ['spinach', 'Blattspinat (TK)', 'frozen', 23, 2.5, 0.6, 0.3, 'vegan', [], { packageG: 450 }],
  ['edamame', 'Edamame (TK)', 'frozen', 120, 11, 7, 5, 'vegan', [], { packageG: 400 }],

  // Vorrat & Sonstiges
  ['whey', 'Whey Protein', 'pantry', 380, 78, 6, 5, 'vegetarian', ['lactose'], { packageG: 1000 }],
  ['olive-oil', 'Olivenöl', 'pantry', 884, 0, 0, 100, 'vegan', [], { packageG: 500 }],
  ['peanut-butter', 'Erdnussbutter', 'pantry', 600, 25, 12, 48, 'vegan', ['nuts'], { packageG: 350 }],
  ['almonds', 'Mandeln', 'pantry', 600, 21, 5.7, 52, 'vegan', ['nuts'], { packageG: 200 }],
  ['honey', 'Honig', 'pantry', 320, 0.4, 80, 0, 'vegetarian', [], { packageG: 500 }],
  ['soy-sauce', 'Sojasauce', 'pantry', 60, 8, 6, 0, 'vegan', ['gluten'], { packageG: 150 }],
  ['protein-bar', 'Proteinriegel', 'pantry', 360, 33, 30, 12, 'vegetarian', ['lactose'], { pieceG: 60, pieceLabel: 'Riegel' }],

  // Häufig ungeplant geloggt
  ['toast', 'Vollkorntoast', 'bakery_grains', 250, 9, 43, 4, 'vegan', ['gluten'], { pieceG: 28, pieceLabel: 'Scheibe', packageG: 500 }],
  ['gouda', 'Gouda', 'dairy', 356, 25, 0, 27.4, 'vegetarian', ['lactose'], { pieceG: 20, pieceLabel: 'Scheibe' }],
  ['greek-yogurt', 'Griechischer Joghurt 2 %', 'dairy', 73, 9, 4, 2, 'vegetarian', ['lactose'], { packageG: 500 }],
  ['orange', 'Orange', 'produce', 47, 0.9, 9, 0.1, 'vegan', [], { pieceG: 150, pieceLabel: 'Stück' }],
];

/**
 * ESTIMATED supermarket prices in CHF per kg – Switzerland (Aldi/Lidl Suisse
 * to Migros/Coop, standard ranges, 2025 level). Own estimates, not converted
 * from other currencies. The UI always says "geschätzt" / "ca."; a price the
 * user enters for a scanned product always wins. Foods whose price varies too
 * much (whey, protein bars) have none and are treated as neutral by the planner.
 */
const EST_PRICE_PER_KG: Record<string, number> = {
  broccoli: 5.0, 'bell-pepper': 6.5, zucchini: 4.5, tomato: 5.0, cucumber: 3.5, onion: 2.5, potato: 2.5,
  'sweet-potato': 5.5, banana: 2.9, apple: 4.0, avocado: 12.0, lettuce: 18.0, orange: 3.8,
  oats: 2.4, rice: 3.5, pasta: 4.0, couscous: 5.0, quinoa: 12.0, bread: 6.0, wrap: 9.0, 'rice-cakes': 14.0, toast: 5.0,
  chicken: 28.0, 'beef-mince': 22.0, salmon: 40.0,
  egg: 10.0, milk: 1.7, skyr: 6.5, quark: 5.0, cottage: 8.0, feta: 16.0, mozzarella: 10.0, tofu: 12.0, gouda: 16.0, 'greek-yogurt': 7.0,
  tuna: 20.0, kidney: 4.0, chickpeas: 4.0, corn: 6.0, 'canned-tomato': 3.0, lentils: 6.0,
  berries: 10.0, spinach: 5.0, edamame: 12.0,
  'olive-oil': 16.0, 'peanut-butter': 12.0, almonds: 20.0, honey: 16.0, 'soy-sauce': 12.0,
};

/**
 * Fiber (g per 100 g, standard food tables) for the few foods without an entry
 * in FOOD_MICROS. Foods in neither table have unknown fiber – never 0.
 */
const FIBER_ONLY: Record<string, number> = { wrap: 3.0, berries: 4.0 };

/** Catalog micronutrients per 100 g: FoodData Central values, salt from sodium (salt = sodium × 2.5 by definition). */
function catalogMicros(id: string): Micros | undefined {
  const entry = FOOD_MICROS[id];
  if (!entry) return FIBER_ONLY[id] !== undefined ? { fiber: FIBER_ONLY[id] } : undefined;
  const { fdc: _source, ...micros } = entry;
  return micros.sodium !== undefined ? { ...micros, salt: Math.round((micros.sodium * SALT_PER_SODIUM) / 10) / 100 } : micros;
}

export const FOODS: Food[] = RAW.map(([id, name, category, kcal, protein, carbs, fat, diet, allergens = [], extra = {}]) => ({
  id,
  name,
  category,
  per100: { kcal, protein, carbs, fat },
  vegan: diet === 'vegan',
  vegetarian: diet !== 'meat',
  allergens,
  ...extra,
  ...(EST_PRICE_PER_KG[id] !== undefined ? { estPricePerKg: EST_PRICE_PER_KG[id] } : {}),
  ...(catalogMicros(id) ? { micros: catalogMicros(id) } : {}),
}));

const BY_ID = new Map(FOODS.map((f) => [f.id, f]));

export function getFood(id: string): Food | undefined {
  return BY_ID.get(id);
}
