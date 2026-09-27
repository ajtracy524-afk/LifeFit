import type { DbFood } from '../data/foodDb';
import type { Product } from '../domain/types';
import { normalizeOffProduct, type OffProduct } from './productLookup';

/**
 * Where "Suchen" finds food – in this order, never merged into one value:
 *
 *   1. Own dishes and products scanned before (the user's own, exact data)
 *   2. The curated catalog (data/foods.ts) – planner, pantry and prices know it
 *   3. The extended database (FoodData Central, CC0) – generic foods, loaded
 *      on demand as its own chunk, works offline once loaded
 *   4. Open Food Facts text search – branded products, ONLY when the user
 *      taps "online suchen" (network, rate-limited by OFF)
 *
 * The same food from two sources is shown as two results with their source;
 * values are never blended.
 */

let dbPromise: Promise<DbFood[]> | undefined;

/** Loads the extended database once (a separate chunk – not in the main bundle). */
export function loadFoodDb(): Promise<DbFood[]> {
  dbPromise ??= import('../data/foodDb').then((m) => m.FOOD_DB).catch((e) => {
    dbPromise = undefined; // allow a retry, e.g. after being offline on first use
    throw e;
  });
  return dbPromise;
}

/** Lower case, without accents/umlauts ("Rüebli" ≈ "ruebli" ≈ "rubli"). */
export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ue/g, 'u')
    .replace(/ae/g, 'a')
    .replace(/oe/g, 'o');
}

/** Every word of the query must appear in the name; names starting with the query come first. */
export function matchesQuery(name: string, query: string): boolean {
  const n = normalizeSearch(name);
  return normalizeSearch(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => n.includes(w));
}

export function searchFoodDb(foods: DbFood[], query: string, limit = 25): DbFood[] {
  const q = normalizeSearch(query.trim());
  if (q.length < 2) return [];
  return foods
    .filter((f) => matchesQuery(f.name, query))
    .sort((a, b) => Number(normalizeSearch(b.name).startsWith(q)) - Number(normalizeSearch(a.name).startsWith(q)) || a.name.localeCompare(b.name, 'de'))
    .slice(0, limit);
}

// ---------- Open Food Facts text search ----------

export type ProductSearchResult = { status: 'ok'; products: Product[] } | { status: 'error'; message: string };

const OFF_SEARCH_URL = 'https://world.openfoodfacts.org/cgi/search.pl';
const SEARCH_FIELDS = 'code,product_name,product_name_de,brands,nutriments,nutrition_data_per,serving_size,serving_quantity,serving_quantity_unit,product_quantity,product_quantity_unit,quantity,countries_tags';
export const SEARCH_TIMEOUT_MS = 10000;

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
let fetcher: Fetcher = (url, init) => fetch(url, init);

/** Tests replace the network. */
export function setSearchFetcher(next: Fetcher | undefined): void {
  fetcher = next ?? ((url, init) => fetch(url, init));
}

/**
 * Branded products by name. Only the search words leave the device. Products
 * sold in Switzerland first; only products with calories are returned (the
 * others could not be logged without typing values). No prices – OFF has none.
 */
export async function searchProducts(query: string, timeoutMs = SEARCH_TIMEOUT_MS): Promise<ProductSearchResult> {
  const q = query.trim();
  if (q.length < 2) return { status: 'ok', products: [] };
  const url = `${OFF_SEARCH_URL}?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=24&fields=${SEARCH_FIELDS}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { signal: controller.signal });
    if (!res.ok) return { status: 'error', message: 'Die Online-Suche ist gerade nicht erreichbar.' };
    const body = (await res.json()) as { products?: (OffProduct & { countries_tags?: string[] })[] };
    const now = new Date();
    const products = (body.products ?? [])
      .map((raw) => ({ swiss: raw.countries_tags?.includes('en:switzerland') ?? false, product: raw.code ? normalizeOffProduct(raw.code, raw, now) : undefined }))
      .filter((x): x is { swiss: boolean; product: Product } => !!x.product && x.product.per100.kcal !== undefined)
      .sort((a, b) => Number(b.swiss) - Number(a.swiss))
      .map((x) => x.product);
    return { status: 'ok', products };
  } catch {
    return { status: 'error', message: 'Keine Verbindung – die Online-Suche braucht Internet. Lokale Treffer funktionieren weiterhin.' };
  } finally {
    clearTimeout(timer);
  }
}
