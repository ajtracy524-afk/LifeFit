import type { Macros, MicroNutrient, Micros } from '../domain/types';

/**
 * Every optional nutrient LifeFit can know, in ONE table: label, unit the
 * value is stored in, where Open Food Facts keeps it (always grams per 100 g
 * there) and – if one exists – the official nutrient reference value (NRV) of
 * food labelling: EU Regulation 1169/2011, Annex XIII, identical in the Swiss
 * labelling ordinance. NRVs are a REFERENCE for labels, not personal targets;
 * nutrients without an NRV (fiber, sugar, salt, sodium) have none here.
 */
export interface NutrientInfo {
  label: string;
  unit: 'g' | 'mg' | 'µg';
  group: 'basic' | 'vitamin' | 'mineral';
  /** Open Food Facts nutriment keys (first one found wins). Basic nutrients are read separately. */
  off?: string[];
  nrv?: number;
}

export const NUTRIENTS: Record<MicroNutrient, NutrientInfo> = {
  fiber: { label: 'Ballaststoffe', unit: 'g', group: 'basic' },
  sugar: { label: 'Zucker', unit: 'g', group: 'basic' },
  salt: { label: 'Salz', unit: 'g', group: 'basic' },

  vitaminA: { label: 'Vitamin A', unit: 'µg', group: 'vitamin', off: ['vitamin-a'], nrv: 800 },
  vitaminC: { label: 'Vitamin C', unit: 'mg', group: 'vitamin', off: ['vitamin-c'], nrv: 80 },
  vitaminD: { label: 'Vitamin D', unit: 'µg', group: 'vitamin', off: ['vitamin-d'], nrv: 5 },
  vitaminE: { label: 'Vitamin E', unit: 'mg', group: 'vitamin', off: ['vitamin-e'], nrv: 12 },
  vitaminK: { label: 'Vitamin K', unit: 'µg', group: 'vitamin', off: ['vitamin-k'], nrv: 75 },
  vitaminB1: { label: 'Vitamin B1', unit: 'mg', group: 'vitamin', off: ['vitamin-b1'], nrv: 1.1 },
  vitaminB2: { label: 'Vitamin B2', unit: 'mg', group: 'vitamin', off: ['vitamin-b2'], nrv: 1.4 },
  vitaminB3: { label: 'Vitamin B3', unit: 'mg', group: 'vitamin', off: ['vitamin-pp'], nrv: 16 },
  vitaminB6: { label: 'Vitamin B6', unit: 'mg', group: 'vitamin', off: ['vitamin-b6'], nrv: 1.4 },
  vitaminB9: { label: 'Folat (B9)', unit: 'µg', group: 'vitamin', off: ['vitamin-b9', 'folates'], nrv: 200 },
  vitaminB12: { label: 'Vitamin B12', unit: 'µg', group: 'vitamin', off: ['vitamin-b12'], nrv: 2.5 },

  calcium: { label: 'Calcium', unit: 'mg', group: 'mineral', off: ['calcium'], nrv: 800 },
  magnesium: { label: 'Magnesium', unit: 'mg', group: 'mineral', off: ['magnesium'], nrv: 375 },
  iron: { label: 'Eisen', unit: 'mg', group: 'mineral', off: ['iron'], nrv: 14 },
  potassium: { label: 'Kalium', unit: 'mg', group: 'mineral', off: ['potassium'], nrv: 2000 },
  zinc: { label: 'Zink', unit: 'mg', group: 'mineral', off: ['zinc'], nrv: 10 },
  phosphorus: { label: 'Phosphor', unit: 'mg', group: 'mineral', off: ['phosphorus'], nrv: 700 },
  sodium: { label: 'Natrium', unit: 'mg', group: 'mineral', off: ['sodium'] },
};

/** Grams (as Open Food Facts stores them) → the nutrient's unit. */
export const FROM_GRAMS: Record<NutrientInfo['unit'], number> = { g: 1, mg: 1000, µg: 1_000_000 };

/**
 * Declared "Salz" IS defined as sodium × 2.5 (EU Regulation 1169/2011,
 * Annex I no. 11; same in the Swiss labelling ordinance). A salt value from a
 * label therefore determines sodium exactly. Used for manual entries where the
 * user typed a salt value and for catalog foods (FoodData Central sodium →
 * salt). Scanned products take sodium straight from the source data.
 */
export const SALT_PER_SODIUM = 2.5;

/**
 * Consistency rule for one food's values: sugar is part of the carbohydrates,
 * so a sugar value above the carbs of the SAME nutrition table is impossible –
 * a data conflict (two sources, or an error in a source). Such a sugar value is
 * treated as unknown: never capped, never estimated.
 */
export function consistentMicros(per100: Partial<Macros>, micros: Micros | undefined): Micros | undefined {
  if (!micros || micros.sugar === undefined || per100.carbs === undefined || micros.sugar <= per100.carbs + 0.05) return micros;
  const { sugar: _conflict, ...rest } = micros;
  return rest;
}
