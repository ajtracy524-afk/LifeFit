import { getFood } from '../data/foods';
import { RECIPES, getRecipe } from '../data/recipes';
import { newId } from '../lib/id';
import { recipeAllowed, recipeMacros, roundServings, plannedMealMacros, sumMacros } from './nutrition';
import type { ISODate, Macros, MealSlot, NutritionProfile, PlannedMeal, Recipe } from './types';

export const SLOT_ORDER: MealSlot[] = ['breakfast', 'snack', 'lunch', 'dinner'];

/** Share of the day's calories per slot – used to size a single added meal. */
const SLOT_SHARE: Record<MealSlot, number> = { breakfast: 0.25, snack: 0.15, lunch: 0.32, dinner: 0.28 };

export function slotsFor(mealsPerDay: 3 | 4): MealSlot[] {
  return mealsPerDay === 3 ? ['breakfast', 'lunch', 'dinner'] : SLOT_ORDER;
}

export function recipesForSlot(slot: MealSlot, profile: NutritionProfile | null): Recipe[] {
  return RECIPES.filter((r) => r.slots.includes(slot) && recipeAllowed(r, profile));
}

/** Servings so that one meal fills its usual share of the daily target. */
export function servingsForSlot(recipe: Recipe, slot: MealSlot, target: Macros, slots: MealSlot[]): number {
  const shareSum = slots.reduce((s, sl) => s + SLOT_SHARE[sl], 0) || 1;
  const kcalGoal = (target.kcal * SLOT_SHARE[slot]) / shareSum;
  const base = recipeMacros(recipe).kcal || 1;
  return roundServings(kcalGoal / base);
}

// ---------- Week planning ----------

/**
 * Weights of the week score (lower = better). All terms are trade-offs, none is
 * a hard rule: fewer ingredients only win where nutrition and variety allow it.
 * Calories always fit because each day's servings are scaled to the target.
 */
export const PLANNER_WEIGHTS = {
  /** Relative protein shortfall per day (0 … 1). */
  proteinGap: 1,
  /** |ln(servings factor)| per day – avoids 0.5× or 3× portions. */
  extremeServing: 0.1,
  /** Per earlier use of the same recipe in the week (as before F3). */
  recipeRepeat: 0.04,
  /** Per use beyond `maxRecipeUses` – protects against a monotonous week. */
  overUse: 0.3,
  maxRecipeUses: 2,
  /** Same recipe in the same slot on consecutive days (soft: rare, e.g. prepped oats). */
  consecutive: 0.15,
  /** Per food that has to be bought (not already needed this week / in the pantry). */
  newFood: 0.04,
  /** Per opened perishable package left unused (as a fraction of the package). */
  packageWaste: 0.12,
};

export type PlannerWeights = typeof PLANNER_WEIGHTS;

/** Leftovers of these categories spoil – opened packages count as waste. */
const PERISHABLE = new Set(['produce', 'meat_fish', 'dairy']);

interface SuggestInput {
  dates: ISODate[];
  slots: MealSlot[];
  target: Macros;
  /** Day-specific target (training / rest day). Falls back to `target`. */
  targetFor?: (date: ISODate) => Macros | undefined;
  profile: NutritionProfile | null;
  existing: PlannedMeal[];
  /** Pantry estimate in grams per food – available ingredients are "free". */
  pantry?: Record<string, number>;
  random?: () => number;
  weights?: Partial<PlannerWeights>;
}

/** One day of the week being planned: fixed (user) meals + the suggested picks. */
export interface PlanningDay {
  date: ISODate;
  target: Macros;
  /** Meals the user already planned – never changed by the planner. */
  fixed: PlannedMeal[];
  /** Calories left for the picks. */
  remainingKcal: number;
  slots: MealSlot[];
  picks: Recipe[];
}

export interface WeekScore {
  total: number;
  nutrition: number;
  variety: number;
  newFoods: number;
  packageWaste: number;
  /** Foods that have to be bought for the week. */
  foodsToBuy: string[];
}

const macrosCache = new Map<string, Macros>();
function baseMacros(r: Recipe): Macros {
  let m = macrosCache.get(r.id);
  if (!m) {
    m = recipeMacros(r);
    macrosCache.set(r.id, m);
  }
  return m;
}

function dayFactor(day: PlanningDay): number {
  const kcal = day.picks.reduce((s, r) => s + baseMacros(r).kcal, 0);
  return day.remainingKcal / (kcal || 1);
}

/**
 * Scores a whole week – nutrition per day, variety across the week and the
 * shopping it causes (distinct foods to buy, opened perishable packages).
 */
export function scoreWeek(days: PlanningDay[], pantry: Record<string, number> = {}, weights: Partial<PlannerWeights> = {}): WeekScore {
  const W = { ...PLANNER_WEIGHTS, ...weights };
  let nutrition = 0;
  const uses = new Map<string, number>();
  const need = new Map<string, number>();
  const addNeed = (r: Recipe, servings: number) => {
    for (const i of r.ingredients) need.set(i.foodId, (need.get(i.foodId) ?? 0) + i.grams * servings);
  };

  for (const day of days) {
    const factor = dayFactor(day);
    const fixedProtein = day.fixed.reduce((s, m) => s + plannedMealMacros(m).protein, 0);
    const protein = fixedProtein + day.picks.reduce((s, r) => s + baseMacros(r).protein, 0) * factor;
    nutrition += W.proteinGap * (Math.max(0, day.target.protein - protein) / day.target.protein);
    if (day.picks.length) nutrition += W.extremeServing * Math.abs(Math.log(factor));

    for (const m of day.fixed) {
      uses.set(m.recipeId, (uses.get(m.recipeId) ?? 0) + 1);
      const r = getRecipe(m.recipeId);
      if (r && m.status === 'planned') addNeed(r, m.servings);
    }
    for (const r of day.picks) {
      uses.set(r.id, (uses.get(r.id) ?? 0) + 1);
      addNeed(r, factor);
    }
  }

  let variety = 0;
  for (const c of uses.values()) variety += W.recipeRepeat * ((c * (c - 1)) / 2) + W.overUse * Math.max(0, c - W.maxRecipeUses);
  for (let d = 1; d < days.length; d++) {
    const prev = days[d - 1]!;
    const cur = days[d]!;
    cur.slots.forEach((slot, i) => {
      const j = prev.slots.indexOf(slot);
      if (j >= 0 && prev.picks[j]?.id === cur.picks[i]?.id) variety += W.consecutive;
    });
  }

  const foodsToBuy: string[] = [];
  let waste = 0;
  for (const [foodId, grams] of need) {
    const toBuy = grams - (pantry[foodId] ?? 0);
    if (toBuy <= 0.5) continue;
    foodsToBuy.push(foodId);
    const food = getFood(foodId);
    if (food?.packageG && PERISHABLE.has(food.category)) {
      const packs = Math.ceil(toBuy / food.packageG);
      waste += (packs * food.packageG - toBuy) / food.packageG;
    }
  }
  const newFoods = W.newFood * foodsToBuy.length;
  const packageWaste = W.packageWaste * waste;

  return { total: nutrition + variety + newFoods + packageWaste, nutrition, variety, newFoods, packageWaste, foodsToBuy };
}

/**
 * Rule-based week suggestion. Fills only EMPTY slots, keeps what the user
 * planned. Two phases:
 *  1. Day by day (as before): random candidates weighted towards unused
 *     recipes, scored by protein, repeats, portion size – plus foods the week
 *     does not need yet.
 *  2. Whole week: every suggested meal is tried against every allowed recipe
 *     of its slot; a swap is kept only if the WEEK score improves.
 * With a seeded `random` the result is fully reproducible.
 */
export function suggestWeek({
  dates,
  slots,
  target: baseTarget,
  targetFor,
  profile,
  existing,
  pantry = {},
  random = Math.random,
  weights = {},
}: SuggestInput): PlannedMeal[] {
  const W = { ...PLANNER_WEIGHTS, ...weights };
  const usage = new Map<string, number>();
  for (const m of existing) usage.set(m.recipeId, (usage.get(m.recipeId) ?? 0) + 1);

  // Foods the week already needs or has at home – reusing them is free.
  const weekFoods = new Set<string>(Object.keys(pantry).filter((id) => pantry[id]! > 0));
  for (const m of existing) {
    if (m.status === 'planned' && dates.includes(m.date)) getRecipe(m.recipeId)?.ingredients.forEach((i) => weekFoods.add(i.foodId));
  }

  const days: PlanningDay[] = [];

  // ---- Phase 1: day by day ----
  for (const date of dates) {
    const target = targetFor?.(date) ?? baseTarget;
    const fixed = existing.filter((m) => m.date === date && m.status !== 'skipped');
    // Slots without any matching recipe (strict diet combinations) stay empty
    // instead of blocking the whole day.
    const emptySlots = slots.filter((s) => !existing.some((m) => m.date === date && m.slot === s) && recipesForSlot(s, profile).length > 0);
    if (emptySlots.length === 0) continue;

    const fixedMacros = sumMacros(fixed.map(plannedMealMacros));
    const remainingKcal = Math.max(target.kcal - fixedMacros.kcal, target.kcal * 0.2);

    let best: { picks: Recipe[]; score: number } | null = null;

    for (let attempt = 0; attempt < 60; attempt++) {
      const picks: Recipe[] = [];
      for (const slot of emptySlots) {
        const all = recipesForSlot(slot, profile);
        const unused = all.filter((r) => !picks.includes(r));
        const options = unused.length > 0 ? unused : all;
        // Weighted random: recipes used less this week are more likely.
        const w = options.map((r) => 1 / (1 + 2 * (usage.get(r.id) ?? 0)));
        let roll = random() * w.reduce((a, b) => a + b, 0);
        let chosen = options[0]!;
        for (let i = 0; i < options.length; i++) {
          roll -= w[i]!;
          if (roll <= 0) {
            chosen = options[i]!;
            break;
          }
        }
        picks.push(chosen);
      }

      const base = sumMacros(picks.map(baseMacros));
      const factor = remainingKcal / (base.kcal || 1);
      const protein = fixedMacros.protein + base.protein * factor;
      const proteinGap = Math.max(0, target.protein - protein) / target.protein;
      const repeatPenalty = picks.reduce((s, r) => s + (usage.get(r.id) ?? 0), 0) * W.recipeRepeat;
      const extremeServing = Math.abs(Math.log(factor)) * W.extremeServing;
      const unseen = new Set(picks.flatMap((r) => r.ingredients.map((i) => i.foodId)).filter((f) => !weekFoods.has(f)));
      const score = proteinGap + repeatPenalty + extremeServing + unseen.size * W.newFood;

      if (!best || score < best.score) best = { picks, score };
    }

    if (!best) continue;
    for (const r of best.picks) {
      usage.set(r.id, (usage.get(r.id) ?? 0) + 1);
      r.ingredients.forEach((i) => weekFoods.add(i.foodId));
    }
    days.push({ date, target, fixed, remainingKcal, slots: emptySlots, picks: best.picks });
  }

  // ---- Phase 2: improve the week as a whole ----
  let current = scoreWeek(days, pantry, weights).total;
  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    for (const day of days) {
      day.slots.forEach((slot, i) => {
        const taken = new Set([...day.picks.filter((_, k) => k !== i).map((r) => r.id), ...day.fixed.map((m) => m.recipeId)]);
        const original = day.picks[i]!;
        let bestRecipe = original;
        for (const alt of recipesForSlot(slot, profile)) {
          if (alt.id === original.id || taken.has(alt.id)) continue;
          day.picks[i] = alt;
          const score = scoreWeek(days, pantry, weights).total;
          if (score < current - 1e-9) {
            current = score;
            bestRecipe = alt;
            improved = true;
          }
        }
        day.picks[i] = bestRecipe;
      });
    }
    if (!improved) break;
  }

  return days.flatMap((day) => {
    const servings = roundServings(dayFactor(day));
    return day.picks.map(
      (recipe, i): PlannedMeal => ({
        id: newId(),
        date: day.date,
        slot: day.slots[i]!,
        recipeId: recipe.id,
        servings,
        status: 'planned',
        source: 'suggest',
      }),
    );
  });
}

/** Deterministic PRNG (mulberry32) seeded from a string – same week, same suggestion. */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h |= 0;
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SwapOption {
  recipe: Recipe;
  servings: number;
  macros: Macros;
  proteinDelta: number;
}

/** Alternatives for a planned meal, scaled to the same calories, ranked by protein match. */
export function swapOptions(meal: PlannedMeal, profile: NutritionProfile | null, limit = 4): SwapOption[] {
  const current = getRecipe(meal.recipeId);
  if (!current) return [];
  const original = recipeMacros(current, meal.servings);

  return recipesForSlot(meal.slot, profile)
    .filter((r) => r.id !== current.id)
    .map((recipe) => {
      const servings = roundServings(original.kcal / (recipeMacros(recipe).kcal || 1));
      const macros = recipeMacros(recipe, servings);
      return { recipe, servings, macros, proteinDelta: macros.protein - original.protein };
    })
    .sort((a, b) => Math.abs(a.proteinDelta) - Math.abs(b.proteinDelta))
    .slice(0, limit);
}
