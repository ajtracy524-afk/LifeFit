import { FROM_GRAMS, NUTRIENTS } from '../data/nutrients';
import { consistentMicros, roundMicro, VITAL_NUTRIENTS } from '../domain/nutrition';
import type { Allergen, Micros, Product } from '../domain/types';

/** Open Food Facts allergen tags → the exclusions LifeFit knows (others are not mapped, never guessed). */
const OFF_ALLERGEN: Record<string, Allergen> = {
  'en:milk': 'lactose',
  'en:gluten': 'gluten',
  'en:nuts': 'nuts',
  'en:peanuts': 'nuts',
  'en:fish': 'fish',
};

/**
 * Barcode → ProductLookupService → source (Open Food Facts) → normalized Product.
 *
 * The ONLY place LifeFit talks to a network, and only when the user asks for
 * a product. The planner never calls this. The source is swappable
 * (setProductSource); screens and actions only see `Product`.
 *
 * Privacy: the request contains nothing but the barcode – no account, no
 * user data. Logged entries stay on the device.
 */

export type LookupResult =
  | { status: 'found'; product: Product }
  | { status: 'not_found' }
  /** Network down, timeout, server error or an unusable answer. */
  | { status: 'error'; message: string };

export interface ProductSource {
  name: string;
  lookup(barcode: string, signal?: AbortSignal): Promise<LookupResult>;
}

/** EAN-8, UPC-A (12), EAN-13 and GTIN-14 – digits only. */
export function normalizeBarcode(input: string): string | undefined {
  const digits = input.replace(/[\s-]/g, '');
  return /^\d{8}$|^\d{12,14}$/.test(digits) ? digits : undefined;
}

// ---------- Open Food Facts ----------

/**
 * Open Food Facts: a free, open database (ODbL) with a public read API – no
 * key, no cost, CORS enabled. Product data is crowd-sourced: we take only
 * fields that are present and never fill gaps. It has NO prices, so none are
 * ever derived from it.
 */
const OFF_URL = 'https://world.openfoodfacts.org/api/v2/product/';
const OFF_FIELDS = [
  'code',
  'product_name',
  'product_name_de',
  'brands',
  'nutriments',
  'nutrition_data_per',
  'serving_size',
  'serving_quantity',
  'serving_quantity_unit',
  'product_quantity',
  'product_quantity_unit',
  // Without it OFF sometimes omits product_quantity; also the text fallback below.
  'quantity',
  'image_front_small_url',
  // Declared allergens and OFF's ingredient analysis – for hard exclusions (only definite values are used).
  'allergens_tags',
  'ingredients_analysis_tags',
  'labels_tags',
].join(',');

interface OffNutriments {
  [key: string]: number | string | undefined;
}

export interface OffProduct {
  code?: string;
  product_name?: string;
  product_name_de?: string;
  brands?: string;
  nutriments?: OffNutriments;
  nutrition_data_per?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  serving_quantity_unit?: string;
  product_quantity?: number | string;
  product_quantity_unit?: string;
  quantity?: string;
  image_front_small_url?: string;
  allergens_tags?: string[];
  ingredients_analysis_tags?: string[];
  labels_tags?: string[];
}

/** "400.0 g", "1,5 l", "30 g" → value + unit. Anything less clear ("2 x 125 g") is not guessed. */
function parseQuantity(text: string | undefined): { value: number; unit: string } | undefined {
  const m = text?.trim().match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|cl|l)$/i);
  return m ? { value: Number(m[1]!.replace(',', '.')), unit: m[2]!.toLowerCase() } : undefined;
}

/** A finite, non-negative number – or nothing. OFF sometimes sends numbers as strings. */
function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

const round1 = (n: number | undefined) => (n === undefined ? undefined : Math.round(n * 10) / 10);

/**
 * OFF → Product. Returns undefined if the answer has no usable name.
 * Nutrients: only `*_100g` values (per 100 g / 100 ml). kcal falls back to
 * the kJ value converted (same measurement, other unit) – never estimated
 * from macros.
 */
export function normalizeOffProduct(barcode: string, raw: OffProduct, now: Date = new Date()): Product | undefined {
  const name = (raw.product_name_de || raw.product_name || '').trim();
  if (!name) return undefined;
  const n = raw.nutriments ?? {};
  const kcal = num(n['energy-kcal_100g']) ?? (num(n['energy-kj_100g']) !== undefined ? num(n['energy-kj_100g'])! / 4.184 : undefined);
  const per100: Product['per100'] = {};
  if (kcal !== undefined) per100.kcal = Math.round(kcal);
  const protein = round1(num(n['proteins_100g']));
  const carbs = round1(num(n['carbohydrates_100g']));
  const fat = round1(num(n['fat_100g']));
  if (protein !== undefined) per100.protein = protein;
  if (carbs !== undefined) per100.carbs = carbs;
  if (fat !== undefined) per100.fat = fat;

  const micros100: Micros = {};
  const fiber = round1(num(n['fiber_100g']));
  const sugar = round1(num(n['sugars_100g']));
  const salt = num(n['salt_100g']);
  if (fiber !== undefined) micros100.fiber = fiber;
  if (sugar !== undefined) micros100.sugar = sugar;
  if (salt !== undefined) micros100.salt = Math.round(salt * 100) / 100;
  // Vitamins and minerals: only those the product declares (OFF keeps them in grams per 100 g).
  for (const key of VITAL_NUTRIENTS) {
    const info = NUTRIENTS[key];
    const grams = info.off?.map((k) => num(n[`${k}_100g`])).find((v) => v !== undefined);
    if (grams !== undefined) micros100[key] = roundMicro(key, grams * FROM_GRAMS[info.unit]);
  }

  const quantityText = parseQuantity(raw.quantity);
  const servingText = parseQuantity(raw.serving_size);
  // Liquids are declared per 100 ml. Unit of amounts follows the product.
  const unit: Product['unit'] = /^(ml|cl|l)$/i.test(raw.product_quantity_unit ?? quantityText?.unit ?? '') || /ml/i.test(raw.nutrition_data_per ?? '') ? 'ml' : 'g';
  // Amounts in the product's unit; exact conversions only (kg → g, l/cl → ml), anything else is dropped.
  const inUnit = (value: unknown, u: string | undefined) => {
    const v = num(value);
    const f = !u || u.toLowerCase() === unit ? 1 : ({ kg: unit === 'g' ? 1000 : 0, l: unit === 'ml' ? 1000 : 0, cl: unit === 'ml' ? 10 : 0 } as Record<string, number>)[u.toLowerCase()];
    return v !== undefined && f ? v * f : undefined;
  };
  const servingSize = inUnit(raw.serving_quantity, raw.serving_quantity_unit) ?? (servingText && inUnit(servingText.value, servingText.unit));
  const packageSize = inUnit(raw.product_quantity, raw.product_quantity_unit) ?? (quantityText && inUnit(quantityText.value, quantityText.unit));

  // Allergens as declared, mapped to the app's exclusions; diet only where OFF is definite ("maybe-…" stays unknown).
  const allergens = [...new Set((raw.allergens_tags ?? []).map((t) => OFF_ALLERGEN[t]).filter((a): a is Allergen => !!a))];
  const tags = new Set([...(raw.ingredients_analysis_tags ?? []), ...(raw.labels_tags ?? [])]);
  const diet: NonNullable<Product['diet']> = {};
  if (tags.has('en:vegan')) diet.vegan = true;
  else if (tags.has('en:non-vegan')) diet.vegan = false;
  if (tags.has('en:vegetarian') || diet.vegan) diet.vegetarian = true;
  else if (tags.has('en:non-vegetarian')) diet.vegetarian = false;
  // Crowd data: a sugar value above the declared carbs is a data error → unknown.
  const checked = consistentMicros(per100, micros100) ?? {};
  return {
    barcode,
    name,
    ...(raw.brands ? { brand: raw.brands.split(',')[0]!.trim() } : {}),
    per100,
    micros100: checked,
    unit,
    ...(servingSize ? { servingSize, ...(raw.serving_size ? { servingLabel: raw.serving_size } : {}) } : {}),
    ...(packageSize ? { packageSize } : {}),
    ...(raw.image_front_small_url?.startsWith('https://') ? { imageUrl: raw.image_front_small_url } : {}),
    ...(allergens.length ? { allergens } : {}),
    ...(Object.keys(diet).length ? { diet } : {}),
    source: 'openfoodfacts',
    fetchedAt: now.toISOString(),
  };
}

export const openFoodFacts: ProductSource = {
  name: 'Open Food Facts',
  async lookup(barcode, signal) {
    let res: Response;
    try {
      // A plain GET without custom headers: no CORS preflight, nothing but the barcode leaves the device.
      res = await fetch(`${OFF_URL}${encodeURIComponent(barcode)}.json?fields=${OFF_FIELDS}`, { signal });
    } catch {
      return { status: 'error', message: 'Produkt konnte nicht geladen werden.' };
    }
    // OFF answers an unknown barcode with 404 + { status: 0 }.
    if (res.status === 404) return { status: 'not_found' };
    if (!res.ok) return { status: 'error', message: 'Produkt konnte nicht geladen werden.' };
    let body: { status?: number; product?: OffProduct };
    try {
      body = await res.json();
    } catch {
      return { status: 'error', message: 'Produkt konnte nicht geladen werden.' };
    }
    if (body.status !== 1 || !body.product) return { status: 'not_found' };
    const product = normalizeOffProduct(barcode, body.product);
    return product ? { status: 'found', product } : { status: 'not_found' };
  },
};

// ---------- Service ----------

let source: ProductSource = openFoodFacts;

/** Swaps the data source (tests, or a different database later). */
export function setProductSource(next: ProductSource): void {
  source = next;
}

export function productSourceName(): string {
  return source.name;
}

export const LOOKUP_TIMEOUT_MS = 8000;

/**
 * Looks a barcode up: the local cache first (works offline, no request),
 * then the source – with a timeout, so a slow API never blocks the app.
 */
export async function lookupProduct(input: string, cache: Record<string, Product> = {}, timeoutMs = LOOKUP_TIMEOUT_MS): Promise<LookupResult> {
  const barcode = normalizeBarcode(input);
  if (!barcode) return { status: 'error', message: 'Das ist keine gültige Barcode-Nummer (8 oder 12–14 Ziffern).' };
  const cached = cache[barcode];
  if (cached) return { status: 'found', product: cached };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await source.lookup(barcode, controller.signal);
  } catch {
    return { status: 'error', message: 'Produkt konnte nicht geladen werden.' };
  } finally {
    clearTimeout(timer);
  }
}
