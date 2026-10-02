// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState, Product } from '../domain/types';

/**
 * Prompt 6 – serial scan into the pantry: mapping remembered per barcode,
 * offline fallback (service mocked), exclusion mark, never a price.
 */

const T = new Date();
const today = `${T.getFullYear()}-${String(T.getMonth() + 1).padStart(2, '0')}-${String(T.getDate()).padStart(2, '0')}`;

const PENNE: Product = {
  barcode: '7610000000001',
  name: 'Penne Rigate',
  brand: 'Coop',
  per100: { kcal: 350, protein: 12, carbs: 70, fat: 1.5 },
  micros100: {},
  unit: 'g',
  packageSize: 500,
  categories: ['en:pastas'],
  source: 'openfoodfacts',
  fetchedAt: T.toISOString(),
};

async function load(patch: Partial<AppState> = {}) {
  vi.resetModules();
  const persistence = await import('./persistence');
  const store = await import('./store');
  const actions = await import('./actions');
  const lookup = await import('../services/productLookup');
  const pantry = await import('../domain/week/pantryOnboarding');
  store.commit({
    ...persistence.emptyState(),
    nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['breakfast', 'lunch', 'dinner'] },
    targets: [{ id: 't', validFrom: today, method: 'formula', kcal: 2600, protein: 150, carbs: 300, fat: 80 }],
    ...patch,
  });
  return { store, actions, lookup, pantry };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('serial scan → pantry', () => {
  it('takes over the package (never a price) and remembers the mapping for the barcode', async () => {
    const { store, actions, lookup, pantry } = await load();
    lookup.setProductSource({ name: 'Mock', lookup: async () => ({ status: 'found', product: { ...PENNE, price: { chf: 9, amount: 500, at: '' } } }) });
    const first = await lookup.lookupProduct(PENNE.barcode, store.getState().products);
    expect(first.status).toBe('found');
    if (first.status !== 'found') return;
    expect(pantry.suggestFoodForProduct(first.product)).toMatchObject({ foodId: 'pasta', reason: 'category' });
    expect(actions.scanToPantry(first.product, 'pasta', { bestBefore: '2027-03-01' })).toBe('added');
    const s = store.getState();
    expect(s.pantry.pasta).toMatchObject({ quantityG: 500, bestBefore: '2027-03-01' });
    expect(s.products[PENNE.barcode]).toMatchObject({ foodId: 'pasta' });
    expect(s.products[PENNE.barcode]!.price).toBeUndefined(); // prices never from the database

    // The next scan of the same barcode: answered from the local cache, the mapping is pre-selected.
    const spy = vi.fn(async () => ({ status: 'not_found' as const }));
    lookup.setProductSource({ name: 'Mock', lookup: spy });
    const again = await lookup.lookupProduct(PENNE.barcode, store.getState().products);
    expect(spy).not.toHaveBeenCalled();
    expect(again.status === 'found' && pantry.suggestFoodForProduct(again.product)).toMatchObject({ foodId: 'pasta', reason: 'remembered' });
    expect(actions.scanToPantry(PENNE, 'pasta')).toBe('added');
    expect(store.getState().pantry.pasta!.quantityG).toBe(1000);
  });

  it('offline: the barcode is kept and resolved later, on a user action', async () => {
    const { store, actions, lookup } = await load();
    lookup.setProductSource({ name: 'Mock', lookup: async () => ({ status: 'error', message: 'offline' }) });
    expect((await lookup.lookupProduct(PENNE.barcode, store.getState().products)).status).toBe('error');
    actions.addPendingScan(PENNE.barcode, '2027-01-01');
    actions.addPendingScan(PENNE.barcode); // twice = once
    expect(store.getState().pendingScans).toEqual([{ barcode: PENNE.barcode, scannedAt: expect.any(String), bestBefore: '2027-01-01' }]);

    // Back online: looked up, put into the pantry, no longer pending.
    lookup.setProductSource({ name: 'Mock', lookup: async () => ({ status: 'found', product: PENNE }) });
    const r = await lookup.lookupProduct(store.getState().pendingScans![0]!.barcode, store.getState().products);
    expect(r.status).toBe('found');
    actions.removePendingScan(PENNE.barcode);
    expect(actions.scanToPantry(PENNE, 'pasta', { bestBefore: '2027-01-01' })).toBe('added');
    expect(store.getState().pendingScans).toBeUndefined();
    expect(store.getState().pantry.pasta!.bestBefore).toBe('2027-01-01');
  });

  it('a product against a hard exclusion is kept and marked – never stock, never in the plan', async () => {
    const { store, actions } = await load({ nutritionProfile: { diet: 'omnivore', excluded: [], allergens: ['tree_nuts'], slots: ['breakfast', 'lunch', 'dinner'] } });
    const nutBar: Product = { ...PENNE, barcode: '7610000000002', name: 'Nussriegel', lmivAllergens: ['tree_nuts'], packageSize: 50, categories: ['en:protein-bars'] };
    expect(actions.scanToPantry(nutBar, 'rice-cakes')).toBe('flagged');
    expect(store.getState().products[nutBar.barcode]).toMatchObject({ foodId: 'rice-cakes' }); // kept, mapping remembered
    expect(store.getState().pantry['rice-cakes']).toBeUndefined(); // no stock from it
  });
});
