import type { MicroNutrient } from '../domain/types';

/**
 * Vitamins, minerals, fiber and sugar of the catalog foods, per 100 g.
 *
 * Source: USDA FoodData Central, "SR Legacy" (April 2018) – public domain
 * (CC0 1.0), a finished, stable dataset of analysed generic foods. It was
 * chosen over live APIs because the catalog only needs generic foods: no API
 * key, no rate limit, no network, no data leaves the device. Scanned products
 * keep their label values from Open Food Facts (see services/productLookup).
 *
 * Rules for this table:
 * - Values are copied, not estimated; `fdc` is the FoodData Central id of the
 *   entry used, so every number can be traced back.
 * - A nutrient the source does not list is left OUT (unknown) – never 0. A 0
 *   here is a 0 in the source (e.g. vitamin B12 in vegetables).
 * - No entry for foods without a fitting unfortified generic entry: wraps (US
 *   flour is enriched), whey and protein bars (brand-dependent) and the berry
 *   mix (no mix in the source). Their micronutrients stay unknown.
 * - Units as in NUTRIENTS (g, mg, µg). Salt is not stored: it follows from
 *   sodium by definition (see SALT_PER_SODIUM).
 */
export type FoodMicros = { fdc: number } & Partial<Record<MicroNutrient, number>>;

export const FOOD_MICROS: Record<string, FoodMicros> = {
  // Broccoli, raw
  'broccoli': { fdc: 170379, fiber: 2.6, sugar: 1.7, sodium: 33, calcium: 47, iron: 0.73, magnesium: 21, phosphorus: 66, potassium: 316, zinc: 0.41, vitaminC: 89.2, vitaminB1: 0.071, vitaminB2: 0.117, vitaminB3: 0.639, vitaminB6: 0.175, vitaminB9: 63, vitaminB12: 0, vitaminA: 31, vitaminE: 0.78, vitaminD: 0, vitaminK: 102 },
  // Peppers, sweet, red, raw
  'bell-pepper': { fdc: 170108, fiber: 2.1, sugar: 4.2, sodium: 4, calcium: 7, iron: 0.43, magnesium: 12, phosphorus: 26, potassium: 211, zinc: 0.25, vitaminC: 128, vitaminB1: 0.054, vitaminB2: 0.085, vitaminB3: 0.979, vitaminB6: 0.291, vitaminB9: 46, vitaminB12: 0, vitaminA: 157, vitaminE: 1.58, vitaminD: 0, vitaminK: 4.9 },
  // Squash, summer, zucchini, includes skin, raw
  'zucchini': { fdc: 169291, fiber: 1, sugar: 2.5, sodium: 8, calcium: 16, iron: 0.37, magnesium: 18, phosphorus: 38, potassium: 261, zinc: 0.32, vitaminC: 17.9, vitaminB1: 0.045, vitaminB2: 0.094, vitaminB3: 0.451, vitaminB6: 0.163, vitaminB9: 24, vitaminB12: 0, vitaminA: 10, vitaminE: 0.12, vitaminD: 0, vitaminK: 4.3 },
  // Tomatoes, red, ripe, raw, year round average
  'tomato': { fdc: 170457, fiber: 1.2, sugar: 2.63, sodium: 5, calcium: 10, iron: 0.27, magnesium: 11, phosphorus: 24, potassium: 237, zinc: 0.17, vitaminC: 13.7, vitaminB1: 0.037, vitaminB2: 0.019, vitaminB3: 0.594, vitaminB6: 0.08, vitaminB9: 15, vitaminB12: 0, vitaminA: 42, vitaminE: 0.54, vitaminD: 0, vitaminK: 7.9 },
  // Cucumber, with peel, raw
  'cucumber': { fdc: 168409, fiber: 0.5, sugar: 1.67, sodium: 2, calcium: 16, iron: 0.28, magnesium: 13, phosphorus: 24, potassium: 147, zinc: 0.2, vitaminC: 2.8, vitaminB1: 0.027, vitaminB2: 0.033, vitaminB3: 0.098, vitaminB6: 0.04, vitaminB9: 7, vitaminB12: 0, vitaminA: 5, vitaminE: 0.03, vitaminD: 0, vitaminK: 16.4 },
  // Onions, raw
  'onion': { fdc: 170000, fiber: 1.7, sugar: 4.24, sodium: 4, calcium: 23, iron: 0.21, magnesium: 10, phosphorus: 29, potassium: 146, zinc: 0.17, vitaminC: 7.4, vitaminB1: 0.046, vitaminB2: 0.027, vitaminB3: 0.116, vitaminB6: 0.12, vitaminB9: 19, vitaminB12: 0, vitaminA: 0, vitaminE: 0.02, vitaminD: 0, vitaminK: 0.4 },
  // Potatoes, flesh and skin, raw
  'potato': { fdc: 170026, fiber: 2.1, sugar: 0.82, sodium: 6, calcium: 12, iron: 0.81, magnesium: 23, phosphorus: 57, potassium: 425, zinc: 0.3, vitaminC: 19.7, vitaminB1: 0.081, vitaminB2: 0.032, vitaminB3: 1.06, vitaminB6: 0.298, vitaminB9: 15, vitaminB12: 0, vitaminA: 0, vitaminE: 0.01, vitaminD: 0, vitaminK: 2 },
  // Sweet potato, raw, unprepared
  'sweet-potato': { fdc: 168482, fiber: 3, sugar: 4.18, sodium: 55, calcium: 30, iron: 0.61, magnesium: 25, phosphorus: 47, potassium: 337, zinc: 0.3, vitaminC: 2.4, vitaminB1: 0.078, vitaminB2: 0.061, vitaminB3: 0.557, vitaminB6: 0.209, vitaminB9: 11, vitaminB12: 0, vitaminA: 709, vitaminE: 0.26, vitaminD: 0, vitaminK: 1.8 },
  // Bananas, raw
  'banana': { fdc: 173944, fiber: 2.6, sugar: 12.2, sodium: 1, calcium: 5, iron: 0.26, magnesium: 27, phosphorus: 22, potassium: 358, zinc: 0.15, vitaminC: 8.7, vitaminB1: 0.031, vitaminB2: 0.073, vitaminB3: 0.665, vitaminB6: 0.367, vitaminB9: 20, vitaminB12: 0, vitaminA: 3, vitaminE: 0.1, vitaminD: 0, vitaminK: 0.5 },
  // Apples, raw, with skin
  'apple': { fdc: 171688, fiber: 2.4, sugar: 10.4, sodium: 1, calcium: 6, iron: 0.12, magnesium: 5, phosphorus: 11, potassium: 107, zinc: 0.04, vitaminC: 4.6, vitaminB1: 0.017, vitaminB2: 0.026, vitaminB3: 0.091, vitaminB6: 0.041, vitaminB9: 3, vitaminB12: 0, vitaminA: 3, vitaminE: 0.18, vitaminD: 0, vitaminK: 2.2 },
  // Avocados, raw, all commercial varieties
  'avocado': { fdc: 171705, fiber: 6.7, sugar: 0.66, sodium: 7, calcium: 12, iron: 0.55, magnesium: 29, phosphorus: 52, potassium: 485, zinc: 0.64, vitaminC: 10, vitaminB1: 0.067, vitaminB2: 0.13, vitaminB3: 1.74, vitaminB6: 0.257, vitaminB9: 81, vitaminB12: 0, vitaminA: 7, vitaminE: 2.07, vitaminD: 0, vitaminK: 21 },
  // Arugula, raw
  'lettuce': { fdc: 169387, fiber: 1.6, sugar: 2.05, sodium: 27, calcium: 160, iron: 1.46, magnesium: 47, phosphorus: 52, potassium: 369, zinc: 0.47, vitaminC: 15, vitaminB1: 0.044, vitaminB2: 0.086, vitaminB3: 0.305, vitaminB6: 0.073, vitaminB9: 97, vitaminB12: 0, vitaminA: 119, vitaminE: 0.43, vitaminD: 0, vitaminK: 109 },
  // Oats
  'oats': { fdc: 169705, fiber: 10.6, sodium: 2, calcium: 54, iron: 4.72, magnesium: 177, phosphorus: 523, potassium: 429, zinc: 3.97, vitaminC: 0, vitaminB1: 0.763, vitaminB2: 0.139, vitaminB3: 0.961, vitaminB6: 0.119, vitaminB9: 56, vitaminB12: 0, vitaminA: 0, vitaminD: 0 },
  // Rice, white, long-grain, regular, raw, unenriched
  'rice': { fdc: 169756, fiber: 1.3, sugar: 0.12, sodium: 5, calcium: 28, iron: 0.8, magnesium: 25, phosphorus: 115, potassium: 115, zinc: 1.09, vitaminC: 0, vitaminB1: 0.07, vitaminB2: 0.049, vitaminB3: 1.6, vitaminB6: 0.164, vitaminB9: 8, vitaminB12: 0, vitaminA: 0, vitaminE: 0.11, vitaminD: 0, vitaminK: 0.1 },
  // Pasta, whole-wheat, dry
  'pasta': { fdc: 169738, fiber: 9.2, sugar: 2.74, sodium: 6, calcium: 29, iron: 3.62, magnesium: 128, phosphorus: 343, potassium: 434, zinc: 2.97, vitaminB1: 0.407, vitaminB2: 0.218, vitaminB3: 8.69, vitaminB6: 0.283, vitaminB9: 69, vitaminB12: 0, vitaminE: 0.46, vitaminD: 0, vitaminK: 1.4 },
  // Couscous, dry
  'couscous': { fdc: 169699, fiber: 5, sodium: 10, calcium: 24, iron: 1.08, magnesium: 44, phosphorus: 170, potassium: 166, zinc: 0.83, vitaminC: 0, vitaminB1: 0.163, vitaminB2: 0.078, vitaminB3: 3.49, vitaminB6: 0.11, vitaminB9: 20, vitaminB12: 0, vitaminA: 0, vitaminD: 0 },
  // Quinoa, uncooked
  'quinoa': { fdc: 168874, fiber: 7, sodium: 5, calcium: 47, iron: 4.57, magnesium: 197, phosphorus: 457, potassium: 563, zinc: 3.1, vitaminB1: 0.36, vitaminB2: 0.318, vitaminB3: 1.52, vitaminB6: 0.487, vitaminB9: 184, vitaminB12: 0, vitaminA: 1, vitaminE: 2.44, vitaminD: 0, vitaminK: 0 },
  // Bread, whole-wheat, prepared from recipe
  'bread': { fdc: 172690, fiber: 6, sugar: 3.84, sodium: 346, calcium: 33, iron: 3.1, magnesium: 81, phosphorus: 187, potassium: 314, zinc: 1.5, vitaminC: 0, vitaminB1: 0.303, vitaminB2: 0.227, vitaminB3: 3.98, vitaminB6: 0.199, vitaminB9: 65, vitaminB12: 0, vitaminA: 0, vitaminE: 0.76, vitaminD: 0, vitaminK: 9.4 },
  // Snacks, rice cakes, brown rice, plain, unsalted
  'rice-cakes': { fdc: 170250, fiber: 4.2, sugar: 0.88, sodium: 26, calcium: 11, iron: 1.49, magnesium: 131, phosphorus: 360, potassium: 290, zinc: 3, vitaminC: 0, vitaminB1: 0.061, vitaminB2: 0.165, vitaminB3: 7.81, vitaminB6: 0.15, vitaminB9: 21, vitaminB12: 0, vitaminA: 0, vitaminE: 1.24, vitaminD: 0, vitaminK: 1.9 },
  // Bread, whole-wheat, prepared from recipe
  'toast': { fdc: 172690, fiber: 6, sugar: 3.84, sodium: 346, calcium: 33, iron: 3.1, magnesium: 81, phosphorus: 187, potassium: 314, zinc: 1.5, vitaminC: 0, vitaminB1: 0.303, vitaminB2: 0.227, vitaminB3: 3.98, vitaminB6: 0.199, vitaminB9: 65, vitaminB12: 0, vitaminA: 0, vitaminE: 0.76, vitaminD: 0, vitaminK: 9.4 },
  // Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw
  'chicken': { fdc: 171077, fiber: 0, sugar: 0, sodium: 45, calcium: 5, iron: 0.37, magnesium: 28, phosphorus: 213, potassium: 334, zinc: 0.68, vitaminC: 0, vitaminB1: 0.094, vitaminB2: 0.177, vitaminB3: 9.6, vitaminB6: 0.811, vitaminB9: 9, vitaminB12: 0.21, vitaminA: 9, vitaminE: 0.56, vitaminD: 0, vitaminK: 0 },
  // Beef, ground, 95% lean meat / 5% fat, raw
  'beef-mince': { fdc: 171790, fiber: 0, sugar: 0, sodium: 66, calcium: 9, iron: 2.38, magnesium: 22, phosphorus: 198, potassium: 346, zinc: 5.09, vitaminC: 0, vitaminB1: 0.041, vitaminB2: 0.151, vitaminB3: 5.49, vitaminB6: 0.392, vitaminB9: 5, vitaminB12: 2.24, vitaminA: 4, vitaminE: 0.17, vitaminD: 0.1, vitaminK: 0.3 },
  // Fish, salmon, Atlantic, farmed, raw
  'salmon': { fdc: 175167, fiber: 0, sugar: 0, sodium: 59, calcium: 9, iron: 0.34, magnesium: 27, phosphorus: 240, potassium: 363, zinc: 0.36, vitaminC: 3.9, vitaminB1: 0.207, vitaminB2: 0.155, vitaminB3: 8.67, vitaminB6: 0.636, vitaminB9: 26, vitaminB12: 3.23, vitaminA: 58, vitaminE: 3.55, vitaminD: 11, vitaminK: 0.5 },
  // Egg, whole, raw, fresh
  'egg': { fdc: 171287, fiber: 0, sugar: 0.37, sodium: 142, calcium: 56, iron: 1.75, magnesium: 12, phosphorus: 198, potassium: 138, zinc: 1.29, vitaminC: 0, vitaminB1: 0.04, vitaminB2: 0.457, vitaminB3: 0.075, vitaminB6: 0.17, vitaminB9: 47, vitaminB12: 0.89, vitaminA: 160, vitaminE: 1.05, vitaminD: 2, vitaminK: 0.3 },
  // Milk, reduced fat, fluid, 2% milkfat, without added vitamin A and vitamin D
  'milk': { fdc: 172205, fiber: 0, sugar: 5.06, sodium: 47, calcium: 120, iron: 0.02, magnesium: 11, phosphorus: 92, potassium: 140, zinc: 0.48, vitaminC: 0.2, vitaminB1: 0.039, vitaminB2: 0.185, vitaminB3: 0.092, vitaminB6: 0.038, vitaminB9: 5, vitaminB12: 0.53, vitaminA: 28, vitaminE: 0.03, vitaminD: 0, vitaminK: 0.2 },
  // Yogurt, Greek, plain, nonfat
  'skyr': { fdc: 170894, fiber: 0, sugar: 3.24, sodium: 36, calcium: 110, iron: 0.07, magnesium: 11, phosphorus: 135, potassium: 141, zinc: 0.52, vitaminC: 0, vitaminB1: 0.023, vitaminB2: 0.278, vitaminB3: 0.208, vitaminB6: 0.063, vitaminB9: 7, vitaminB12: 0.75, vitaminA: 1, vitaminE: 0.01, vitaminD: 0, vitaminK: 0 },
  // Cheese, cottage, nonfat, uncreamed, dry, large or small curd
  'quark': { fdc: 172181, fiber: 0, sugar: 1.85, sodium: 372, calcium: 86, iron: 0.15, magnesium: 11, phosphorus: 190, potassium: 137, zinc: 0.47, vitaminC: 0, vitaminB1: 0.023, vitaminB2: 0.226, vitaminB3: 0.144, vitaminB6: 0.016, vitaminB9: 9, vitaminB12: 0.46, vitaminA: 2, vitaminE: 0.01, vitaminD: 0, vitaminK: 0 },
  // Cheese, cottage, lowfat, 2% milkfat
  'cottage': { fdc: 172182, fiber: 0, sugar: 4, sodium: 308, calcium: 111, iron: 0.13, magnesium: 9, phosphorus: 150, potassium: 125, zinc: 0.51, vitaminC: 0, vitaminB1: 0.02, vitaminB2: 0.251, vitaminB3: 0.103, vitaminB6: 0.057, vitaminB9: 8, vitaminB12: 0.47, vitaminA: 68, vitaminE: 0.08, vitaminD: 0, vitaminK: 0 },
  // Cheese, feta
  'feta': { fdc: 173420, fiber: 0, sugar: 0, sodium: 1140, calcium: 493, iron: 0.65, magnesium: 19, phosphorus: 337, potassium: 62, zinc: 2.88, vitaminC: 0, vitaminB1: 0.154, vitaminB2: 0.844, vitaminB3: 0.991, vitaminB6: 0.424, vitaminB9: 32, vitaminB12: 1.69, vitaminA: 125, vitaminE: 0.18, vitaminD: 0.4, vitaminK: 1.8 },
  // Cheese, mozzarella, part skim milk
  'mozzarella': { fdc: 170847, fiber: 0, sugar: 1.13, sodium: 619, calcium: 782, iron: 0.22, magnesium: 23, phosphorus: 463, potassium: 84, zinc: 2.76, vitaminC: 0, vitaminB1: 0.018, vitaminB2: 0.303, vitaminB3: 0.105, vitaminB6: 0.07, vitaminB9: 9, vitaminB12: 0.82, vitaminA: 127, vitaminE: 0.14, vitaminD: 0.3, vitaminK: 1.6 },
  // Tofu, raw, firm, prepared with calcium sulfate
  'tofu': { fdc: 172475, fiber: 2.3, sodium: 14, calcium: 683, iron: 2.66, magnesium: 58, phosphorus: 190, potassium: 237, zinc: 1.57, vitaminC: 0.2, vitaminB1: 0.158, vitaminB2: 0.102, vitaminB3: 0.381, vitaminB6: 0.092, vitaminB9: 29, vitaminB12: 0, vitaminD: 0 },
  // Cheese, gouda
  'gouda': { fdc: 171241, fiber: 0, sugar: 2.22, sodium: 819, calcium: 700, iron: 0.24, magnesium: 29, phosphorus: 546, potassium: 121, zinc: 3.9, vitaminC: 0, vitaminB1: 0.03, vitaminB2: 0.334, vitaminB3: 0.063, vitaminB6: 0.08, vitaminB9: 21, vitaminB12: 1.54, vitaminA: 165, vitaminE: 0.24, vitaminD: 0.5, vitaminK: 2.3 },
  // Yogurt, Greek, plain, lowfat
  'greek-yogurt': { fdc: 170903, fiber: 0, sugar: 3.56, sodium: 34, calcium: 115, iron: 0.04, magnesium: 11, phosphorus: 137, potassium: 141, zinc: 0.6, vitaminC: 0.8, vitaminB1: 0.044, vitaminB2: 0.233, vitaminB3: 0.197, vitaminB6: 0.055, vitaminB9: 12, vitaminB12: 0.52, vitaminA: 90, vitaminE: 0.04, vitaminD: 0, vitaminK: 0.2 },
  // Fish, tuna, light, canned in water, drained solids
  'tuna': { fdc: 173709, fiber: 0, sugar: 0, sodium: 247, calcium: 17, iron: 1.63, magnesium: 23, phosphorus: 139, potassium: 179, zinc: 0.69, vitaminC: 0, vitaminB1: 0.03, vitaminB2: 0.084, vitaminB3: 10.1, vitaminB6: 0.319, vitaminB9: 4, vitaminB12: 2.55, vitaminA: 17, vitaminE: 0.33, vitaminD: 1.2, vitaminK: 0.2 },
  // Beans, kidney, red, mature seeds, canned, drained solids
  'kidney': { fdc: 174285, fiber: 5.5, sugar: 3.8, sodium: 231, calcium: 57, iron: 1.5, magnesium: 30, phosphorus: 121, potassium: 277, zinc: 0.75, vitaminC: 0.2, vitaminB1: 0.067, vitaminB2: 0.016, vitaminB3: 0.46, vitaminB9: 28, vitaminB12: 0, vitaminD: 0 },
  // Chickpeas (garbanzo beans, bengal gram), mature seeds, canned, drained solids
  'chickpeas': { fdc: 173800, fiber: 6.4, sugar: 4.01, sodium: 246, calcium: 45, iron: 1.07, magnesium: 26, phosphorus: 85, potassium: 126, zinc: 0.63, vitaminC: 0.1, vitaminB1: 0.027, vitaminB2: 0.015, vitaminB3: 0.14, vitaminB6: 0.116, vitaminB9: 48, vitaminB12: 0, vitaminA: 1, vitaminE: 0.29, vitaminD: 0, vitaminK: 3.4 },
  // Corn, sweet, yellow, canned, whole kernel, drained solids
  'corn': { fdc: 169214, fiber: 2, sugar: 4.44, sodium: 205, calcium: 3, iron: 0.27, magnesium: 13, phosphorus: 46, potassium: 132, zinc: 0.32, vitaminC: 1.8, vitaminB1: 0.039, vitaminB2: 0.089, vitaminB3: 1, vitaminB6: 0.037, vitaminB9: 39, vitaminB12: 0, vitaminA: 2, vitaminE: 0.09, vitaminD: 0, vitaminK: 0 },
  // Tomatoes, red, ripe, canned, packed in tomato juice
  'canned-tomato': { fdc: 170051, fiber: 1.9, sugar: 2.55, sodium: 115, calcium: 33, iron: 0.57, magnesium: 10, phosphorus: 17, potassium: 191, zinc: 0.12, vitaminC: 12.6, vitaminB1: 0.575, vitaminB2: 0.055, vitaminB3: 0.712, vitaminB6: 0.111, vitaminB9: 8, vitaminB12: 0, vitaminA: 20, vitaminE: 0.59, vitaminD: 0, vitaminK: 2.6 },
  // Lentils, pink or red, raw
  'lentils': { fdc: 174284, fiber: 10.8, sodium: 7, calcium: 48, iron: 7.39, magnesium: 59, phosphorus: 294, potassium: 668, zinc: 3.6, vitaminC: 1.7, vitaminB1: 0.51, vitaminB2: 0.106, vitaminB3: 1.5, vitaminB6: 0.403, vitaminB9: 204, vitaminB12: 0, vitaminA: 3, vitaminD: 0 },
  // Spinach, frozen, chopped or leaf, unprepared
  'spinach': { fdc: 169287, fiber: 2.9, sugar: 0.65, sodium: 74, calcium: 129, iron: 1.89, magnesium: 75, phosphorus: 49, potassium: 346, zinc: 0.56, vitaminC: 5.5, vitaminB1: 0.094, vitaminB2: 0.224, vitaminB3: 0.507, vitaminB6: 0.172, vitaminB9: 145, vitaminB12: 0, vitaminA: 586, vitaminE: 2.9, vitaminD: 0, vitaminK: 372 },
  // Edamame, frozen, unprepared
  'edamame': { fdc: 168410, fiber: 4.8, sugar: 2.48, sodium: 6, calcium: 60, iron: 2.11, magnesium: 61, phosphorus: 161, potassium: 482, zinc: 1.32, vitaminC: 9.7, vitaminB1: 0.15, vitaminB2: 0.265, vitaminB3: 0.925, vitaminB6: 0.135, vitaminB9: 303, vitaminE: 0.72, vitaminK: 31.4 },
  // Oil, olive, salad or cooking
  'olive-oil': { fdc: 171413, fiber: 0, sugar: 0, sodium: 2, calcium: 1, iron: 0.56, magnesium: 0, phosphorus: 0, potassium: 1, zinc: 0, vitaminC: 0, vitaminB1: 0, vitaminB2: 0, vitaminB3: 0, vitaminB6: 0, vitaminB9: 0, vitaminB12: 0, vitaminA: 0, vitaminE: 14.4, vitaminD: 0, vitaminK: 60.2 },
  // Peanut butter, smooth style, without salt
  'peanut-butter': { fdc: 172470, fiber: 5, sugar: 10.5, sodium: 17, calcium: 49, iron: 1.74, magnesium: 168, phosphorus: 335, potassium: 558, zinc: 2.51, vitaminC: 0, vitaminB1: 0.15, vitaminB2: 0.192, vitaminB3: 13.1, vitaminB6: 0.441, vitaminB9: 87, vitaminB12: 0, vitaminA: 0, vitaminE: 9.1, vitaminD: 0, vitaminK: 0.3 },
  // Nuts, almonds
  'almonds': { fdc: 170567, fiber: 12.5, sugar: 4.35, sodium: 1, calcium: 269, iron: 3.71, magnesium: 270, phosphorus: 481, potassium: 733, zinc: 3.12, vitaminC: 0, vitaminB1: 0.205, vitaminB2: 1.14, vitaminB3: 3.62, vitaminB6: 0.137, vitaminB9: 44, vitaminB12: 0, vitaminA: 0, vitaminE: 25.6, vitaminD: 0, vitaminK: 0 },
  // Honey
  'honey': { fdc: 169640, fiber: 0.2, sugar: 82.1, sodium: 4, calcium: 6, iron: 0.42, magnesium: 2, phosphorus: 4, potassium: 52, zinc: 0.22, vitaminC: 0.5, vitaminB1: 0, vitaminB2: 0.038, vitaminB3: 0.121, vitaminB6: 0.024, vitaminB9: 2, vitaminB12: 0, vitaminA: 0, vitaminE: 0, vitaminD: 0, vitaminK: 0 },
  // Soy sauce made from soy and wheat (shoyu)
  'soy-sauce': { fdc: 174277, fiber: 0.8, sugar: 0.4, sodium: 5490, calcium: 33, iron: 1.45, magnesium: 74, phosphorus: 166, potassium: 435, zinc: 0.87, vitaminC: 0, vitaminB1: 0.033, vitaminB2: 0.165, vitaminB3: 2.2, vitaminB6: 0.148, vitaminB9: 14, vitaminB12: 0, vitaminA: 0, vitaminE: 0, vitaminD: 0, vitaminK: 0 },
  // Oranges, raw, all commercial varieties
  'orange': { fdc: 169097, fiber: 2.4, sugar: 9.35, sodium: 0, calcium: 40, iron: 0.1, magnesium: 10, phosphorus: 14, potassium: 181, zinc: 0.07, vitaminC: 53.2, vitaminB1: 0.087, vitaminB2: 0.04, vitaminB3: 0.282, vitaminB6: 0.06, vitaminB9: 30, vitaminB12: 0, vitaminA: 11, vitaminE: 0.18, vitaminD: 0, vitaminK: 0 },
};
