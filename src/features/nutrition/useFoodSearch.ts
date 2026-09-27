import { useEffect, useMemo, useState } from 'react';
import type { DbFood } from '../../data/foodDb';
import { FOODS } from '../../data/foods';
import { foodAllowed } from '../../domain/nutrition';
import type { CustomDish, Food, Product } from '../../domain/types';
import { loadFoodDb, matchesQuery, searchFoodDb } from '../../services/foodDatabase';
import { useAppState } from '../../store/store';

export interface FoodSearch {
  dishes: CustomDish[];
  products: Product[];
  catalog: Food[];
  database: DbFood[];
  /** The extended database is still loading (first search only). */
  loading: boolean;
  /** The extended database could not be loaded (e.g. offline on first use) – local results still work. */
  failed: boolean;
}

/**
 * ONE search over all local sources, in the order of services/foodDatabase:
 * own dishes, scanned products, catalog, extended database. The database is
 * loaded on the first real query (a separate chunk), never before.
 */
export function useFoodSearch(query: string, { dishes = true }: { dishes?: boolean } = {}): FoodSearch {
  const state = useAppState();
  const q = query.trim();
  const [db, setDb] = useState<DbFood[] | null>(null);
  const [failed, setFailed] = useState(false);
  const wantsDb = q.length >= 2;

  useEffect(() => {
    if (!wantsDb || db) return;
    let alive = true;
    loadFoodDb()
      .then((foods) => alive && setDb(foods))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [wantsDb, db]);

  return useMemo(() => {
    if (!q) return { dishes: [], products: [], catalog: [], database: [], loading: false, failed: false };
    const profile = state.nutritionProfile;
    return {
      dishes: dishes ? Object.values(state.customDishes ?? {}).filter((d) => matchesQuery(d.name, q)) : [],
      products: Object.values(state.products ?? {}).filter((p) => matchesQuery(`${p.name} ${p.brand ?? ''}`, q)),
      catalog: FOODS.filter((f) => matchesQuery(f.name, q)).sort((a, b) => Number(foodAllowed(b, profile)) - Number(foodAllowed(a, profile))),
      database: db ? searchFoodDb(db, q) : [],
      loading: wantsDb && !db && !failed,
      failed,
    };
  }, [q, db, failed, wantsDb, dishes, state.customDishes, state.products, state.nutritionProfile]);
}
