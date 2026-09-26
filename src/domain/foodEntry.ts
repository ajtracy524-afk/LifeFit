import { FOODS } from '../data/foods';
import { SALT_PER_SODIUM } from '../data/nutrients';
import { BASIC_NUTRIENTS, roundMacros, scaleMicros } from './nutrition';
import type { Food, FoodUnit, LogEntry, MacroKey, Macros, Micros, Product } from './types';

/**
 * Logged food that is not a planned meal: scanned products and manual
 * entries. Pure functions only – the network lives in services/, state
 * changes in store/actions. Nothing here invents a value: what the source or
 * the user did not provide stays unknown.
 */

const MACRO_KEYS: MacroKey[] = ['protein', 'carbs', 'fat'];

/** Fields of a log entry that describe WHAT was eaten (id, date, slot, time are added by the action). */
export type EntryContent = Pick<LogEntry, 'name' | 'method' | 'macros' | 'micros' | 'unknown' | 'amount' | 'unit' | 'grams' | 'barcode' | 'brand' | 'foodId' | 'costChf'>;

export interface ProductNutrients {
  macros: Macros;
  micros: Micros;
  unknown: MacroKey[];
}

/**
 * Nutrients of `amount` (in the product's unit) – a plain rule of three on the
 * per-100 values. Returns undefined without calories: then the product cannot
 * be logged automatically and the user completes it by hand.
 */
export function productNutrients(product: Product, amount: number): ProductNutrients | undefined {
  const kcal = product.per100.kcal;
  if (kcal === undefined || !(amount > 0)) return undefined;
  const f = amount / 100;
  const unknown = MACRO_KEYS.filter((k) => product.per100[k] === undefined);
  const macros = roundMacros({
    kcal: kcal * f,
    protein: (product.per100.protein ?? 0) * f,
    carbs: (product.per100.carbs ?? 0) * f,
    fat: (product.per100.fat ?? 0) * f,
  });
  return { macros, micros: scaleMicros(product.micros100, f), unknown };
}

export interface AmountOption {
  label: string;
  amount: number;
}

/** Quick amounts: 100 g, one serving and the whole package – only those the product states. */
export function productAmountOptions(product: Product): AmountOption[] {
  const u = product.unit;
  const options: AmountOption[] = [{ label: `100 ${u}`, amount: 100 }];
  if (product.servingSize) options.push({ label: `1 Portion (${fmtAmount(product.servingSize)} ${u})`, amount: product.servingSize });
  // A package that is exactly one portion (a yoghurt cup) is offered once, as the portion.
  if (product.packageSize && product.packageSize !== 100 && product.packageSize !== product.servingSize) options.push({ label: `Packung (${fmtAmount(product.packageSize)} ${u})`, amount: product.packageSize });
  return options;
}

const fmtAmount = (n: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(n);

/** Log entry content of a scanned product. Undefined if the product has no calories. */
export function productEntry(product: Product, amount: number, foodId = product.foodId): EntryContent | undefined {
  const n = productNutrients(product, amount);
  if (!n) return undefined;
  return {
    name: product.name,
    brand: product.brand,
    method: 'barcode',
    barcode: product.barcode,
    amount,
    unit: product.unit,
    // Millilitres are weighed like grams for the pantry – close enough for an estimate.
    grams: amount,
    macros: n.macros,
    ...(Object.keys(n.micros).length ? { micros: n.micros } : {}),
    ...(n.unknown.length ? { unknown: n.unknown } : {}),
    ...(foodId ? { foodId } : {}),
    ...(product.price && product.price.amount > 0 ? { costChf: toRappen((product.price.chf / product.price.amount) * amount) } : {}),
  };
}

/** Value of what was eaten, to the Rappen (5-Rappen rounding only applies when paying). */
const toRappen = (chf: number) => Math.round(chf * 100) / 100;

// ---------- Manual entry ----------

export interface ManualInput {
  name: string;
  amount: string;
  unit: FoodUnit;
  /** Values refer to the entered amount, or to 100 g / 100 ml (as printed on packages). */
  per: 'amount' | '100';
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
  fiber: string;
  sugar: string;
  salt: string;
  barcode?: string;
  brand?: string;
  foodId?: string;
}

export type ManualErrors = Partial<Record<'kcal' | 'amount' | MacroKey | 'fiber' | 'sugar' | 'salt', string>>;

export const EMPTY_MANUAL: ManualInput = { name: '', amount: '', unit: 'g', per: 'amount', kcal: '', protein: '', carbs: '', fat: '', fiber: '', sugar: '', salt: '' };

/** "12,5" and "12.5" both work; empty stays empty. */
function parse(value: string): number | undefined {
  const t = value.trim().replace(',', '.');
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * Validates a manual entry. Only calories are required; every other field is
 * optional and stays unknown when empty (never 0 by assumption).
 */
export function manualEntry(input: ManualInput): { ok: true; entry: EntryContent } | { ok: false; errors: ManualErrors } {
  const errors: ManualErrors = {};
  const kcal = parse(input.kcal);
  const amount = parse(input.amount);
  if (kcal === undefined || Number.isNaN(kcal) || kcal < 0 || kcal > 5000) errors.kcal = 'Bitte gib die Kalorien an (0–5000).';
  if (amount !== undefined && (Number.isNaN(amount) || amount <= 0 || amount > 5000)) errors.amount = 'Bitte prüfe die Menge.';
  const per100 = input.per === '100' && (input.unit === 'g' || input.unit === 'ml');
  if (per100 && amount === undefined) errors.amount = 'Für Werte pro 100 g brauchen wir die Menge.';

  const values: Partial<Record<MacroKey | 'fiber' | 'sugar' | 'salt', number>> = {};
  for (const key of [...MACRO_KEYS, ...BASIC_NUTRIENTS] as const) {
    const v = parse(input[key]);
    if (v === undefined) continue;
    if (Number.isNaN(v) || v < 0 || v > 1000) errors[key] = 'Bitte prüfe den Wert.';
    else values[key] = v;
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  const factor = per100 ? amount! / 100 : 1;
  const unknown = MACRO_KEYS.filter((k) => values[k] === undefined);
  // Only from a salt value the user actually typed (label value): salt is DEFINED as sodium × 2.5,
  // so this is exact. No salt typed → no sodium (unknown, not 0).
  const sodium = values.salt !== undefined ? (values.salt / SALT_PER_SODIUM) * 1000 : undefined;
  const micros = scaleMicros({ fiber: values.fiber, sugar: values.sugar, salt: values.salt, sodium }, factor);
  const measured = input.unit === 'g' || input.unit === 'ml';
  return {
    ok: true,
    entry: {
      name: input.name.trim() || 'Manueller Eintrag',
      method: 'manual',
      macros: roundMacros({ kcal: kcal! * factor, protein: (values.protein ?? 0) * factor, carbs: (values.carbs ?? 0) * factor, fat: (values.fat ?? 0) * factor }),
      ...(Object.keys(micros).length ? { micros } : {}),
      ...(unknown.length ? { unknown } : {}),
      ...(amount !== undefined ? { amount, unit: input.unit } : {}),
      // Only a weight can be taken from the pantry; "1 Portion" has none.
      ...(amount !== undefined && measured ? { grams: amount } : {}),
      ...(input.barcode ? { barcode: input.barcode } : {}),
      ...(input.brand ? { brand: input.brand } : {}),
      ...(input.foodId ? { foodId: input.foodId } : {}),
    },
  };
}

/** Pre-fills the manual form from a product (e.g. when its calories are missing). Only known values. */
export function manualFromProduct(product: Product): ManualInput {
  const v = (n: number | undefined) => (n === undefined ? '' : String(n).replace('.', ','));
  return {
    ...EMPTY_MANUAL,
    name: product.name,
    brand: product.brand,
    barcode: product.barcode,
    foodId: product.foodId,
    unit: product.unit,
    per: '100',
    amount: '100',
    kcal: v(product.per100.kcal),
    protein: v(product.per100.protein),
    carbs: v(product.per100.carbs),
    fat: v(product.per100.fat),
    fiber: v(product.micros100.fiber),
    sugar: v(product.micros100.sugar),
    salt: v(product.micros100.salt),
  };
}

// ---------- Catalog link ----------

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9 ]/g, ' ');

/** Words of a catalog name that identify it ("Skyr natur" → skyr, natur). Short filler words are ignored. */
const keywords = (name: string) => normalize(name.replace(/\(.*?\)/g, '')).split(/\s+/).filter((w) => w.length >= 4);
const FOOD_KEYWORDS = FOODS.map((f) => ({ food: f, words: keywords(f.name) }));

/**
 * Catalog foods a free-text name might be – only SUGGESTIONS for the user to
 * confirm (for pantry, shopping and learning). Never linked automatically.
 */
export function suggestCatalogFoods(name: string, limit = 3): Food[] {
  const words = normalize(name).split(/\s+/).filter((w) => w.length >= 3);
  if (words.length === 0) return [];
  return FOOD_KEYWORDS.map(({ food, words: fw }) => ({
    food,
    hits: fw.filter((k) => words.some((w) => k.startsWith(w) || w.startsWith(k))).length,
  }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit)
    .map((x) => x.food);
}
