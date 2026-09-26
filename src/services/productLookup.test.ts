import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../domain/types';
import { lookupProduct, normalizeBarcode, normalizeOffProduct, openFoodFacts, setProductSource, type ProductSource } from './productLookup';

/**
 * Barcode → ProductLookupService → source → normalized Product.
 * Only data the source really has; errors never throw into the UI.
 */

const NUTELLA = {
  code: '3017624010701',
  product_name: 'Nutella',
  product_name_de: 'Nutella',
  brands: 'Ferrero, Nutella',
  nutriments: {
    'energy-kcal_100g': 539,
    proteins_100g: 6.3,
    carbohydrates_100g: 57.5,
    fat_100g: 30.9,
    sugars_100g: 56.3,
    salt_100g: 0.1075,
  },
  nutrition_data_per: '100g',
  product_quantity: 400,
  product_quantity_unit: 'g',
  serving_quantity: '15',
  serving_size: '15 g',
  image_front_small_url: 'https://images.openfoodfacts.org/x.jpg',
};

afterEach(() => {
  setProductSource(openFoodFacts);
  vi.restoreAllMocks();
});

describe('normalizing Open Food Facts data', () => {
  it('takes name, brand, per-100 nutrients, serving and package', () => {
    const p = normalizeOffProduct('3017624010701', NUTELLA)!;
    expect(p).toMatchObject({
      barcode: '3017624010701',
      name: 'Nutella',
      brand: 'Ferrero',
      per100: { kcal: 539, protein: 6.3, carbs: 57.5, fat: 30.9 },
      micros100: { sugar: 56.3, salt: 0.11 },
      unit: 'g',
      servingSize: 15,
      packageSize: 400,
      source: 'openfoodfacts',
    });
  });

  it('missing values stay missing – nothing is invented (no fiber, no protein)', () => {
    const p = normalizeOffProduct('1', { product_name: 'Limo', nutriments: { 'energy-kcal_100g': 42, sugars_100g: 10 } })!;
    expect(p.per100).toEqual({ kcal: 42 });
    expect(p.micros100).toEqual({ sugar: 10 });
    expect(p.micros100.fiber).toBeUndefined();
    expect(p.servingSize).toBeUndefined();
    expect(p.packageSize).toBeUndefined();
  });

  it('kcal from kJ is a unit conversion of a real value, never an estimate from macros', () => {
    expect(normalizeOffProduct('1', { product_name: 'X', nutriments: { 'energy-kj_100g': 418.4 } })!.per100.kcal).toBe(100);
    expect(normalizeOffProduct('1', { product_name: 'X', nutriments: { proteins_100g: 10, fat_100g: 5 } })!.per100.kcal).toBeUndefined();
  });

  it('drinks are per 100 ml; litres are converted exactly', () => {
    const p = normalizeOffProduct('1', { product_name: 'Milch', product_quantity: 1, product_quantity_unit: 'l', nutriments: { 'energy-kcal_100g': 47 } })!;
    expect(p.unit).toBe('ml');
    expect(p.packageSize).toBe(1000);
  });

  it('falls back to the quantity text when OFF omits the numbers – only unambiguous ones', () => {
    expect(normalizeOffProduct('1', { product_name: 'Nutella', quantity: '400.0 g', serving_size: '15 g', nutriments: {} })).toMatchObject({ unit: 'g', packageSize: 400, servingSize: 15 });
    expect(normalizeOffProduct('1', { product_name: 'Saft', quantity: '1,5 l', nutriments: {} })).toMatchObject({ unit: 'ml', packageSize: 1500 });
    expect(normalizeOffProduct('1', { product_name: 'Joghurt', quantity: '4 x 125 g', nutriments: {} })!.packageSize).toBeUndefined();
  });

  it('rejects answers without a name and ignores garbage numbers', () => {
    expect(normalizeOffProduct('1', { nutriments: { 'energy-kcal_100g': 100 } })).toBeUndefined();
    expect(normalizeOffProduct('1', { product_name: 'X', nutriments: { 'energy-kcal_100g': 'abc', proteins_100g: -3 } })!.per100).toEqual({});
  });
});

describe('barcode validation', () => {
  it('accepts EAN-8, UPC-A, EAN-13, GTIN-14 and strips spaces', () => {
    expect(normalizeBarcode('4012 3456 7890 1')).toBe('4012345678901');
    expect(normalizeBarcode('12345678')).toBe('12345678');
    expect(normalizeBarcode('123')).toBeUndefined();
    expect(normalizeBarcode('abc12345678')).toBeUndefined();
  });
});

describe('ProductLookupService', () => {
  const fake = (impl: ProductSource['lookup']): ProductSource => ({ name: 'Fake', lookup: vi.fn(impl) });

  it('found → normalized product', async () => {
    setProductSource(fake(async (code) => ({ status: 'found', product: normalizeOffProduct(code, NUTELLA)! })));
    const r = await lookupProduct('3017624010701');
    expect(r.status).toBe('found');
  });

  it('not found → not_found (the UI offers manual entry)', async () => {
    setProductSource(fake(async () => ({ status: 'not_found' })));
    expect(await lookupProduct('4000000000009')).toEqual({ status: 'not_found' });
  });

  it('a throwing source becomes an error result, never an exception', async () => {
    setProductSource(fake(async () => {
      throw new Error('boom');
    }));
    const r = await lookupProduct('4000000000009');
    expect(r.status).toBe('error');
  });

  it('a slow source is cut off by the timeout', async () => {
    setProductSource(
      fake(
        (_code, signal) =>
          new Promise((resolve) => {
            signal?.addEventListener('abort', () => resolve({ status: 'error', message: 'Produkt konnte nicht geladen werden.' }));
          }),
      ),
    );
    const r = await lookupProduct('4000000000009', {}, 20);
    expect(r).toEqual({ status: 'error', message: 'Produkt konnte nicht geladen werden.' });
  });

  it('the local cache answers without any request (offline)', async () => {
    const source = fake(async () => ({ status: 'not_found' }));
    setProductSource(source);
    const cached = { barcode: '4000000000009', name: 'Skyr' } as Product;
    expect(await lookupProduct('4000000000009', { '4000000000009': cached })).toEqual({ status: 'found', product: cached });
    expect(source.lookup).not.toHaveBeenCalled();
  });

  it('an invalid number is rejected before any request', async () => {
    const source = fake(async () => ({ status: 'not_found' }));
    setProductSource(source);
    expect((await lookupProduct('12')).status).toBe('error');
    expect(source.lookup).not.toHaveBeenCalled();
  });
});

describe('Open Food Facts adapter (HTTP)', () => {
  const respond = (status: number, body: unknown) => vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it('sends only the barcode and asks for the needed fields', async () => {
    const spy = respond(200, { status: 1, product: NUTELLA });
    const r = await openFoodFacts.lookup('3017624010701');
    expect(r.status).toBe('found');
    const url = String(spy.mock.calls[0]![0]);
    expect(url).toMatch(/^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/3017624010701\.json\?fields=/);
    expect(spy.mock.calls[0]![1]).not.toHaveProperty('headers');
  });

  it('404 with status 0 → not found', async () => {
    respond(404, { status: 0, status_verbose: 'product not found' });
    expect(await openFoodFacts.lookup('4000000000009')).toEqual({ status: 'not_found' });
  });

  it('server error and network failure → error', async () => {
    respond(503, {});
    expect((await openFoodFacts.lookup('4000000000009')).status).toBe('error');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    expect((await openFoodFacts.lookup('4000000000009')).status).toBe('error');
  });

  it('broken JSON → error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>', { status: 200 }));
    expect((await openFoodFacts.lookup('4000000000009')).status).toBe('error');
  });
});
