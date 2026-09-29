import { getFood } from '../../data/foods';
import { fmt } from '../../lib/format';
import { foodAllowed, foodMacros } from '../nutrition';
import type { AppState, Food } from '../types';
import type { Metric } from './trends';

/**
 * The simplest improvement for a nutrient – one sentence and up to three
 * concrete foods from the catalog that fit the user's diet, with real
 * amounts and values. Never a "must", never a health claim.
 */
export interface Improvement {
  action: string;
  options: Array<{ foodId: string; name: string; grams: number; text: string }>;
}

/** Ready-to-eat, protein-dense (same list the coach uses for protein gaps). */
export const PROTEIN_FOODS = ['skyr', 'quark', 'greek-yogurt', 'cottage', 'whey', 'tofu', 'edamame', 'tuna', 'protein-bar', 'egg'];
const FIBER_FOODS = ['oats', 'lentils', 'kidney', 'chickpeas', 'berries', 'apple', 'broccoli', 'bread', 'spinach', 'edamame'];
const FAT_FOODS = ['almonds', 'avocado', 'olive-oil', 'salmon', 'peanut-butter'];

const portion = (f: Food, grams: number) => (f.pieceG ? Math.max(1, Math.round(grams / f.pieceG)) * f.pieceG : Math.max(10, Math.round(grams / 10) * 10));
const amountText = (f: Food, grams: number) => (f.pieceG && f.pieceLabel ? `${Math.round(grams / f.pieceG)} ${f.pieceLabel}` : fmt.g(grams));

function pick(state: AppState, ids: string[], grams: (f: Food) => number, value: (f: Food, g: number) => string, rank?: (f: Food) => number): Improvement['options'] {
  return ids
    .map((id) => getFood(id))
    .filter((f): f is Food => !!f && foodAllowed(f, state.nutritionProfile))
    .sort((a, b) => (rank ? rank(b) - rank(a) : 0))
    .slice(0, 3)
    .map((f) => {
      const g = portion(f, grams(f));
      return { foodId: f.id, name: f.name, grams: g, text: `${f.name} · ${amountText(f, g)} · ${value(f, g)}` };
    });
}

export function improvementFor(state: AppState, metric: Metric, direction: 'low' | 'high', gap?: number): Improvement | undefined {
  if (metric === 'protein' && direction === 'low') {
    const need = Math.max(10, Math.min(40, gap ?? 25));
    return {
      action: 'Eine proteinreiche Komponente zu einer Mahlzeit ergänzen.',
      options: pick(state, PROTEIN_FOODS, (f) => (need / Math.max(1, f.per100.protein)) * 100, (f, g) => `${fmt.int(foodMacros(f, g).protein)} g Protein`, (f) => f.per100.protein / f.per100.kcal),
    };
  }
  if (metric === 'fiber' && direction === 'low') {
    return {
      action: 'Täglich eine zusätzliche Portion Gemüse, Obst, Hülsenfrüchte oder Vollkorn einbauen.',
      options: pick(state, FIBER_FOODS, (f) => (f.pieceG ? f.pieceG : 80), (f, g) => `${fmt.dec(((f.micros?.fiber ?? 0) * g) / 100)} g Ballaststoffe`, (f) => (f.micros?.fiber ?? 0) / Math.max(1, f.per100.kcal)),
    };
  }
  if (metric === 'fat' && direction === 'low') {
    return {
      action: 'Etwas mehr hochwertige Fettquellen einplanen, z. B. Nüsse, Olivenöl, Avocado oder fetten Fisch.',
      options: pick(state, FAT_FOODS, (f) => (10 / Math.max(1, f.per100.fat)) * 100, (f, g) => `${fmt.int(foodMacros(f, g).fat)} g Fett`),
    };
  }
  if (metric === 'water' && direction === 'low') return { action: 'Zu jeder Mahlzeit ein Glas Wasser trinken – so kommt die Menge fast von selbst.', options: [] };
  if (metric === 'sugar' && direction === 'high') return { action: 'Süße Getränke und Snacks prüfen – dort steckt oft der größte Teil.', options: [] };
  if (metric === 'salt' && direction === 'high') return { action: 'Fertigprodukte, Wurst, Käse und Würzsaucen prüfen – dort steckt meist das meiste Salz.', options: [] };
  if (metric === 'kcal') return { action: direction === 'high' ? 'Mahlzeiten ähnlich wie an deinen Tagen im Ziel planen – ohne Ausgleichen oder Weglassen.' : 'Eine vollwertige Mahlzeit oder einen Snack mehr einplanen.', options: [] };
  return undefined;
}
