import type { Allergen, AnimalKind, Food, FoodTags, Micros, ShoppingCategory } from '../domain/types';
import { FOOD_MICROS } from './foodMicros';
import { personalFood } from './personal';
import { consistentMicros, SALT_PER_SODIUM } from './nutrients';

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

/** Tags as written in the table below: allergens and animal kinds default to none. */
type TagInput = Partial<FoodTags>;

type FoodInput = [
  id: string,
  name: string,
  category: ShoppingCategory,
  kcal: number,
  protein: number,
  carbs: number,
  fat: number,
  tags: TagInput,
  extra?: Partial<Pick<Food, 'pieceG' | 'pieceLabel' | 'packageG'>>,
];

// Shorthands for the table – the review (docs/CATALOG_TAGS_REVIEW.md) is the source of every tag.
const VEG: TagInput = { groups: ['veg'] };
const DAIRY: TagInput = { allergens: ['milk'], lactose: 'yes', kinds: ['milk'] };
const CONDIMENT: TagInput = { groups: [], basic: true, staple: true };

// Values per 100 g (cooked products: as sold; grains/pasta/legumes: dry unless noted).
const RAW: FoodInput[] = [
  // Obst & Gemüse
  ['broccoli', 'Brokkoli', 'produce', 35, 2.8, 2.7, 0.4, VEG, { packageG: 500 }],
  ['bell-pepper', 'Paprika', 'produce', 31, 1, 6, 0.3, VEG, { pieceG: 150, pieceLabel: 'Stück' }],
  ['zucchini', 'Zucchini', 'produce', 19, 1.6, 2.2, 0.4, VEG, { pieceG: 250, pieceLabel: 'Stück' }],
  ['tomato', 'Tomaten', 'produce', 18, 0.9, 2.6, 0.2, VEG, { pieceG: 80, pieceLabel: 'Stück' }],
  ['cucumber', 'Gurke', 'produce', 12, 0.6, 1.8, 0.2, VEG, { pieceG: 400, pieceLabel: 'Stück' }],
  // Fructans rather than free fructose – not tagged for fructose intolerance (review: unsicher).
  ['onion', 'Zwiebeln', 'produce', 40, 1.2, 7.6, 0.2, VEG, { pieceG: 100, pieceLabel: 'Stück' }],
  ['potato', 'Kartoffeln', 'produce', 72, 2, 15.4, 0.1, {}, { packageG: 1500 }],
  ['sweet-potato', 'Süßkartoffeln', 'produce', 86, 1.6, 20, 0.1, {}, { packageG: 1000 }],
  ['banana', 'Bananen', 'produce', 93, 1.2, 20, 0.2, { groups: ['veg', 'carbs'] }, { pieceG: 120, pieceLabel: 'Stück' }],
  ['apple', 'Äpfel', 'produce', 54, 0.3, 11.4, 0.2, { groups: ['veg'], fructose: true }, { pieceG: 150, pieceLabel: 'Stück' }],
  ['avocado', 'Avocado', 'produce', 160, 2, 3.6, 15, {}, { pieceG: 140, pieceLabel: 'Stück' }],
  ['lettuce', 'Blattsalat / Rucola', 'produce', 25, 2.6, 2, 0.7, VEG, { packageG: 125 }],

  // Brot, Getreide & Nudeln
  // Oats are themselves a gluten-containing cereal under LMIV Annex II (not only contaminated).
  ['oats', 'Haferflocken', 'bakery_grains', 372, 13.5, 58.7, 7, { allergens: ['gluten'], basic: true }, { packageG: 500 }],
  ['rice', 'Basmatireis', 'bakery_grains', 350, 8, 77, 0.6, { basic: true }, { packageG: 1000 }],
  ['pasta', 'Vollkornnudeln', 'bakery_grains', 350, 13, 64, 2.5, { allergens: ['gluten'], basic: true }, { packageG: 500 }],
  ['couscous', 'Couscous', 'bakery_grains', 360, 12, 70, 1.5, { allergens: ['gluten'], basic: true }, { packageG: 500 }],
  ['quinoa', 'Quinoa', 'bakery_grains', 360, 14, 60, 6, { celiacRisk: true, basic: true }, { packageG: 500 }],
  // Wholegrain bread often contains seeds / sesame – tagged in doubt.
  ['bread', 'Vollkornbrot', 'bakery_grains', 215, 7, 39, 1.5, { allergens: ['gluten', 'sesame'] }, { pieceG: 50, pieceLabel: 'Scheibe', packageG: 500 }],
  ['wrap', 'Weizen-Wraps', 'bakery_grains', 310, 8.5, 52, 7, { allergens: ['gluten'] }, { pieceG: 60, pieceLabel: 'Wrap', packageG: 360 }],
  // Often made on lines with spelt / wheat waffles.
  ['rice-cakes', 'Reiswaffeln', 'bakery_grains', 390, 8, 81, 3, { celiacRisk: true }, { pieceG: 8, pieceLabel: 'Stück', packageG: 100 }],

  // Fleisch & Fisch
  ['chicken', 'Hähnchenbrust', 'meat_fish', 110, 23.5, 0, 1.5, { kinds: ['meat'] }, { packageG: 400 }],
  ['beef-mince', 'Rinderhack (5 % Fett)', 'meat_fish', 125, 21.2, 0, 4.5, { kinds: ['meat'] }, { packageG: 400 }],
  ['salmon', 'Lachsfilet', 'meat_fish', 200, 20, 0, 13, { allergens: ['fish'], kinds: ['fish'], groups: ['protein', 'fat'] }, { pieceG: 125, pieceLabel: 'Filet', packageG: 250 }],

  // Kühlregal & Eier
  ['egg', 'Eier', 'dairy', 143, 12.6, 0.7, 9.5, { allergens: ['eggs'], kinds: ['egg'], groups: ['protein'] }, { pieceG: 60, pieceLabel: 'Ei', packageG: 600 }],
  ['milk', 'Milch 1,5 %', 'dairy', 47, 3.4, 4.8, 1.5, { ...DAIRY, groups: ['protein'], basic: true }, { packageG: 1000 }],
  ['skyr', 'Skyr natur', 'dairy', 63, 11, 4, 0.2, DAIRY, { packageG: 450 }],
  ['quark', 'Magerquark', 'dairy', 67, 12, 4, 0.2, DAIRY, { packageG: 500 }],
  ['cottage', 'Körniger Frischkäse', 'dairy', 98, 12.3, 1.5, 4.3, DAIRY, { packageG: 200 }],
  // Ripened, but 0.5–1 g lactose per 100 g – stays excluded for lactose intolerance (E20).
  ['feta', 'Feta', 'dairy', 260, 16, 0.5, 21, { ...DAIRY, groups: ['protein'] }, { packageG: 200 }],
  ['mozzarella', 'Mozzarella light', 'dairy', 160, 19, 1, 9, { ...DAIRY, groups: ['protein'] }, { packageG: 125 }],
  ['tofu', 'Tofu natur', 'dairy', 130, 14, 1.5, 7.5, { allergens: ['soy'], groups: ['protein'] }, { packageG: 200 }],

  // Konserven & Hülsenfrüchte
  ['tuna', 'Thunfisch naturell (abgetropft)', 'canned', 110, 25, 0, 1, { allergens: ['fish'], kinds: ['fish'] }, { packageG: 130 }],
  ['kidney', 'Kidneybohnen (abgetropft)', 'canned', 90, 6.6, 11, 0.5, { groups: ['protein', 'carbs'] }, { packageG: 250 }],
  ['chickpeas', 'Kichererbsen (abgetropft)', 'canned', 118, 6.9, 14.5, 2.4, { groups: ['protein', 'carbs'] }, { packageG: 265 }],
  ['corn', 'Mais (abgetropft)', 'canned', 80, 2.9, 13, 1.2, { basic: true }, { packageG: 140 }],
  ['canned-tomato', 'Gehackte Tomaten', 'canned', 24, 1.2, 3.5, 0.2, { ...VEG, basic: true }, { packageG: 400 }],
  // Can contain cereal grains from the harvest.
  ['lentils', 'Rote Linsen', 'canned', 340, 24, 48, 1.5, { groups: ['protein', 'carbs'], celiacRisk: true, basic: true }, { packageG: 500 }],

  // Tiefkühl
  ['berries', 'Beerenmischung (TK)', 'frozen', 45, 1, 9, 0.4, VEG, { packageG: 500 }],
  ['spinach', 'Blattspinat (TK)', 'frozen', 23, 2.5, 0.6, 0.3, VEG, { packageG: 450 }],
  ['edamame', 'Edamame (TK)', 'frozen', 120, 11, 7, 5, { allergens: ['soy'], groups: ['protein'] }, { packageG: 400 }],

  // Vorrat & Sonstiges
  // Soy lecithin is common and must be declared (E23).
  ['whey', 'Whey Protein', 'pantry', 380, 78, 6, 5, { ...DAIRY, allergens: ['milk', 'soy'] }, { packageG: 1000 }],
  // A staple like salt and pepper (Prompt 6): on the list only when marked empty.
  ['olive-oil', 'Olivenöl', 'pantry', 884, 0, 0, 100, { basic: true, staple: true }, { packageG: 500 }],
  ['peanut-butter', 'Erdnussbutter', 'pantry', 600, 25, 12, 48, { allergens: ['peanuts'], traces: ['tree_nuts'], groups: ['fat'], basic: true }, { packageG: 350 }],
  ['almonds', 'Mandeln', 'pantry', 600, 21, 5.7, 52, { allergens: ['tree_nuts'] }, { packageG: 200 }],
  ['honey', 'Honig', 'pantry', 320, 0.4, 80, 0, { kinds: ['honey'], fructose: true, basic: true }, { packageG: 500 }],
  // Naturally brewed: 1–3 % alcohol from fermentation (E17).
  ['soy-sauce', 'Sojasauce', 'pantry', 60, 8, 6, 0, { allergens: ['soy', 'gluten'], alcohol: 'fermentation', groups: [], basic: true }, { packageG: 150 }],
  // Generic entry without a recipe: the most common ingredients, nuts as traces (E15), sugar alcohols (E23).
  [
    'protein-bar',
    'Proteinriegel',
    'pantry',
    360,
    33,
    30,
    12,
    { ...DAIRY, allergens: ['milk', 'soy', 'gluten'], traces: ['peanuts', 'tree_nuts'], fructose: true },
    { pieceG: 60, pieceLabel: 'Riegel' },
  ],
  // Salt and pepper: assumed at home, as ingredients where a recipe needs them (E19).
  ['salt', 'Salz', 'pantry', 0, 0, 0, 0, CONDIMENT, { packageG: 500 }],
  ['pepper', 'Pfeffer', 'pantry', 250, 10, 64, 3, CONDIMENT, { packageG: 50 }],
  // Curry powder usually contains mustard and celery seed – tagged in doubt.
  ['curry-powder', 'Currypulver', 'pantry', 325, 14, 25, 14, { ...CONDIMENT, allergens: ['mustard', 'celery'] }, { packageG: 50 }],
  // White-wine / herb vinegar: sulphites in doubt. Residual alcohol is not tagged (review, Phase 2).
  ['vinegar', 'Essig', 'pantry', 20, 0, 0.6, 0, { ...CONDIMENT, allergens: ['sulphites'] }, { packageG: 500 }],

  // Häufig ungeplant geloggt
  // Industrial toast: sesame and soy as traces (E15).
  ['toast', 'Vollkorntoast', 'bakery_grains', 250, 9, 43, 4, { allergens: ['gluten'], traces: ['sesame', 'soy'] }, { pieceG: 28, pieceLabel: 'Scheibe', packageG: 500 }],
  // Long-ripened: practically lactose-free (< 0.1 g / 100 g) → allowed for lactose intolerance (E20).
  // The same rule applies to any ripened hard cheese added later: lactose 'low'.
  ['gouda', 'Gouda', 'dairy', 356, 25, 0, 27.4, { ...DAIRY, lactose: 'low', groups: ['protein'] }, { pieceG: 20, pieceLabel: 'Scheibe' }],
  ['greek-yogurt', 'Griechischer Joghurt 2 %', 'dairy', 73, 9, 4, 2, DAIRY, { packageG: 500 }],
  ['orange', 'Orange', 'produce', 47, 0.9, 9, 0.1, VEG, { pieceG: 150, pieceLabel: 'Stück' }],
];

/**
 * E20 – swap instead of exclude: lactose-free variants with the nutrients of
 * the original. They are no recipe ingredients; with lactose intolerance the
 * recipe stays allowed and the shopping list buys the variant (see
 * domain/catalogTags.substituteFood). The milk allergen stays.
 */
export const LACTOSE_FREE_VARIANT: Record<string, string> = {
  milk: 'milk-lf',
  quark: 'quark-lf',
  skyr: 'skyr-lf',
  'greek-yogurt': 'greek-yogurt-lf',
};

function lactoseFreeVariants(rows: FoodInput[]): FoodInput[] {
  return Object.entries(LACTOSE_FREE_VARIANT).map(([baseId, id]) => {
    const [, name, category, kcal, protein, carbs, fat, tags, extra] = rows.find((r) => r[0] === baseId)!;
    const { lactose: _lactose, basic: _basic, ...rest } = tags;
    return [id, `${name} laktosefrei`, category, kcal, protein, carbs, fat, { ...rest, lactoseFree: true }, extra];
  });
}

const ROWS: FoodInput[] = [...RAW, ...lactoseFreeVariants(RAW)];

/** The variant's nutrients are those of its original. */
const MICROS_OF: Record<string, string> = Object.fromEntries(Object.entries(LACTOSE_FREE_VARIANT).map(([base, id]) => [id, base]));

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
  'milk-lf': 2.3, 'quark-lf': 7.0, 'skyr-lf': 8.5, 'greek-yogurt-lf': 9.0,
  tuna: 20.0, kidney: 4.0, chickpeas: 4.0, corn: 6.0, 'canned-tomato': 3.0, lentils: 6.0,
  berries: 10.0, spinach: 5.0, edamame: 12.0,
  'olive-oil': 16.0, 'peanut-butter': 12.0, almonds: 20.0, honey: 16.0, 'soy-sauce': 12.0,
  salt: 1.5, pepper: 40.0, 'curry-powder': 40.0, vinegar: 3.0,
};

/**
 * Fiber (g per 100 g, standard food tables) for the few foods without an entry
 * in FOOD_MICROS. Foods in neither table have unknown fiber – never 0.
 */
const FIBER_ONLY: Record<string, number> = { wrap: 3.0, berries: 4.0 };

/** Known by definition: table salt is sodium chloride (39.3 g sodium per 100 g). */
const SODIUM_ONLY: Record<string, number> = { salt: 39300 };

/** Catalog micronutrients per 100 g: FoodData Central values, salt from sodium (salt = sodium × 2.5 by definition). */
function catalogMicros(id: string): Micros | undefined {
  if (SODIUM_ONLY[id] !== undefined) return { sodium: SODIUM_ONLY[id], salt: (SODIUM_ONLY[id] * SALT_PER_SODIUM) / 1000 };
  const entry = FOOD_MICROS[MICROS_OF[id] ?? id];
  if (!entry) return FIBER_ONLY[id] !== undefined ? { fiber: FIBER_ONLY[id] } : undefined;
  const { fdc: _source, ...micros } = entry;
  // Unrounded: rounding happens once, after scaling to the eaten amount.
  return micros.sodium !== undefined ? { ...micros, salt: (micros.sodium * SALT_PER_SODIUM) / 1000 } : micros;
}

const NOT_VEGETARIAN: AnimalKind[] = ['meat', 'pork', 'fish', 'crustaceans', 'molluscs'];
const NOT_VEGAN: AnimalKind[] = [...NOT_VEGETARIAN, 'egg', 'milk', 'honey'];

/**
 * The four exclusions of the old profile, derived from the tags (traces
 * included – the stricter reading, E15). The old filter keeps working
 * unchanged until Prompt 4 switches to the tags themselves.
 */
function legacyAllergens(tags: FoodTags): Allergen[] {
  const all = new Set([...tags.allergens, ...(tags.traces ?? [])]);
  const out: Allergen[] = [];
  if (tags.lactose === 'yes') out.push('lactose');
  if (all.has('gluten')) out.push('gluten');
  if (all.has('peanuts') || all.has('tree_nuts')) out.push('nuts');
  if (all.has('fish')) out.push('fish');
  return out;
}

export const FOODS: Food[] = ROWS.map(([id, name, category, kcal, protein, carbs, fat, input, extra = {}]) => {
  const tags: FoodTags = { ...input, allergens: input.allergens ?? [], kinds: input.kinds ?? [] };
  return {
    id,
    name,
    category,
    per100: { kcal, protein, carbs, fat },
    vegan: !tags.kinds.some((k) => NOT_VEGAN.includes(k)),
    vegetarian: !tags.kinds.some((k) => NOT_VEGETARIAN.includes(k)),
    allergens: legacyAllergens(tags),
    tags,
    ...extra,
    ...(EST_PRICE_PER_KG[id] !== undefined ? { estPricePerKg: EST_PRICE_PER_KG[id] } : {}),
    ...(catalogMicros(id) ? { micros: consistentMicros({ carbs }, catalogMicros(id)) } : {}),
  };
});

const BY_ID = new Map(FOODS.map((f) => [f.id, f]));

/** Catalog food, or one of the user's own products / dish ingredients (data/personal.ts). */
export function getFood(id: string): Food | undefined {
  return BY_ID.get(id) ?? personalFood(id);
}

/** Assumed to be at home (E19): never a purchase in the plan, never a "new food". */
export const isStaple = (id: string): boolean => !!getFood(id)?.tags?.staple;
