import { getFood, isStaple } from '../data/foods';
import { allRecipes, getRecipe } from '../data/recipes';
import { newId } from '../lib/id';
import { LEFTOVER_DAYS, LEFTOVER_PREP_MIN, TIME_BUDGETS } from './timeBudget';
import { recipeAllowed, recipeMacros, roundServings, plannedMealMacros, sumMacros } from './nutrition';
import { purchaseCost } from './costs';
import { foodPreference } from './preferences';
import type { ISODate, Macros, MealSlot, NutritionProfile, PlanPriority, PlannedMeal, Recipe, TimeBudget } from './types';

/** Order of all slots through the day ("Snack 2" in the afternoon, E13). */
export const SLOT_ORDER: MealSlot[] = ['breakfast', 'snack', 'lunch', 'snack2', 'dinner'];
/** The meals without a choice – as before "Snack 2" existed. */
export const DEFAULT_SLOTS: MealSlot[] = ['breakfast', 'snack', 'lunch', 'dinner'];

/** Recipes are written for four slots – "Snack 2" uses the snack recipes. */
export function recipeSlot(slot: MealSlot): Exclude<MealSlot, 'snack2'> {
  return slot === 'snack2' ? 'snack' : slot;
}

/** Share of the day's calories per slot – used to size a single added meal. */
const SLOT_SHARE: Record<MealSlot, number> = { breakfast: 0.25, snack: 0.15, lunch: 0.32, dinner: 0.28, snack2: 0.12 };

/** Share of the day's calories that `part` of the day's `slots` stands for. */
export function slotShare(part: MealSlot[], slots: MealSlot[]): number {
  const all = slots.reduce((sum, sl) => sum + SLOT_SHARE[sl], 0) || 1;
  return part.reduce((sum, sl) => sum + SLOT_SHARE[sl], 0) / all;
}

export function slotsFor(mealsPerDay: 3 | 4): MealSlot[] {
  return mealsPerDay === 3 ? ['breakfast', 'lunch', 'dinner'] : DEFAULT_SLOTS;
}

export function recipesForSlot(slot: MealSlot, profile: NutritionProfile | null): Recipe[] {
  return allRecipes().filter((r) => r.slots.includes(recipeSlot(slot)) && recipeAllowed(r, profile));
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
 * a hard rule. Rough priority (hard filters for diet/allergens come first and
 * are never scored): calories (always hit via servings) → protein → time
 * budget → variety → pantry use → ingredient overlap → package leftovers.
 */
export const PLANNER_WEIGHTS = {
  /** Relative protein shortfall per day (0 … 1). */
  proteinGap: 1,
  /**
   * Step penalty for a day below PROTEIN_FLOOR of its protein target (grows
   * with the shortfall). Only "Sparen" sets it: the price may trade a little
   * protein, never below the floor – unless no recipe combination reaches it.
   */
  proteinFloor: 0,
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
  /**
   * "Ich koche gern vor" (E18, Prompt 4): bonus per meal that is a leftover of a
   * meal-prep dish – above the repeat penalty, so cooking once for 2–3 days wins.
   */
  mealPrepBundle: 0.1,
  /** Per opened perishable package left unused (as a fraction of the package). */
  packageWaste: 0.12,
  /** F5: per 10 min of preparation beyond the day's time budget. */
  timeOver: 0.4,
  /**
   * Bonus per elaborate dish (≥ ELABORATE_PREP_MIN) on a day with much time.
   * Deliberately below a full preference, pantry or budget hit – it only
   * decides between otherwise similar meals.
   */
  elaborate: 0.05,
  /**
   * F2: perishable pantry stock left unused by the week (per food, as a share
   * of the stock). Makes the planner prefer plans that use what is at home –
   * a preference, not an obligation.
   */
  pantryUnused: 0.12,
  /**
   * Personalization: per meal, × −affinity (−1 … +1) from learned behaviour.
   * Small on purpose – it breaks ties and nudges, it never beats nutrition,
   * time or the hard filters.
   */
  preference: 0.12,
  /** Estimated purchase cost, per 10 CHF (only foods with a price estimate). */
  cost: 0.05,
  /** Estimated cost above the (pro-rata) budget, per 10 CHF. */
  budgetOver: 0.6,
  /** Fiber shortfall per day as a share of the day's fiber orientation value. */
  fiberGap: 0.05,
  /** Protein shortfall of the meal after training (share of POST_WORKOUT_PROTEIN_G). */
  postWorkoutProtein: 0.15,
};

export type PlannerWeights = typeof PLANNER_WEIGHTS;

/** General orientation values for planning – no medical targets. */
export const FIBER_PER_1000_KCAL_G = 14;
export const POST_WORKOUT_PROTEIN_G = 35;

/**
 * Plan priorities only shift weights – it is always the same planner.
 * save: cost and budget count more · protein: protein counts more ·
 * health: fiber (as available nutrient-quality signal) counts more.
 */
export const PRIORITY_WEIGHTS: Record<PlanPriority, Partial<PlannerWeights>> = {
  save: { cost: 0.6, budgetOver: 1.5, proteinFloor: 0.5 },
  balanced: {},
  protein: { proteinGap: 1.6, postWorkoutProtein: 0.35, cost: 0.03 },
  health: { fiberGap: 0.6 },
};

export function weightsFor(priority: PlanPriority = 'balanced', overrides: Partial<PlannerWeights> = {}): PlannerWeights {
  return { ...PLANNER_WEIGHTS, ...PRIORITY_WEIGHTS[priority], ...overrides };
}

/**
 * Foods 👍 / 👎 of the profile as a per-recipe score (cached). Undefined without
 * any – nothing changes then. "Mag ich nicht" is a soft rule since Prompt 4: the
 * recipe is planned only when nothing else fits (E23).
 */
export function foodScorer(profile: Pick<NutritionProfile, 'likedFoods' | 'dislikedFoods'> | null): ((recipe: Recipe) => number) | undefined {
  const liked = new Set(profile?.likedFoods ?? []);
  const disliked = new Set(profile?.dislikedFoods ?? []);
  if (!liked.size && !disliked.size) return undefined;
  const cache = new Map<string, number>();
  return (recipe) => {
    let v = cache.get(recipe.id);
    if (v === undefined) cache.set(recipe.id, (v = foodPreference(recipe, liked, disliked)));
    return v;
  };
}

/** Survives a day in a box – "chilled" ones need cooling (E23). */
export const isPortable = (r: Recipe): boolean => r.portable === 'yes' || r.portable === 'chilled';

/** Share of the day's protein target below which the steep penalty applies. */
export const PROTEIN_FLOOR = 0.9;

/** Checked with the ROUNDED servings – what the plan will really contain. */
function belowProteinFloor(protein: number, target: number, W: PlannerWeights): number {
  const shortfall = target > 0 ? PROTEIN_FLOOR - protein / target : 0;
  return shortfall > 0 && W.proteinFloor > 0 ? W.proteinFloor * (1 + 10 * shortfall) : 0;
}

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
  /** F5: time budget per day (default "normal"). */
  timeBudgetFor?: (date: ISODate) => TimeBudget;
  /** F1: slots a day does not plan (e.g. dinner when eating out). */
  excludedSlotsFor?: (date: ISODate) => MealSlot[];
  /** Personalization: learned affinity −1 … +1 per recipe and day budget (pre-aggregated). */
  affinity?: (recipeId: string, budget: TimeBudget) => number;
  /** Budget in CHF for the purchases of the planned days (already pro rata). */
  budgetChf?: number;
  priority?: PlanPriority;
  /** Meal slot right after training on a training day (gets protein priority). */
  postWorkoutSlotFor?: (date: ISODate) => MealSlot | undefined;
  /** Age of pantry stock in days – older stock is used up first. */
  pantryAgeDays?: Record<string, number>;
  random?: () => number;
  weights?: Partial<PlannerWeights>;
  /** "Ich koche gern vor" (E18) – default no. */
  mealPrep?: boolean;
  /**
   * The user's cooking time per day (Prompt 4): recipes longer than this are
   * planned only when nothing else fits. Without it the time budget is a soft cost.
   */
  maxPrepFor?: (date: ISODate) => number;
  /** "Mitnehmen" (Prompt 5): only portable recipes for this slot on this date. */
  portableFor?: (date: ISODate, slot: MealSlot) => boolean;
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
  timeBudget: TimeBudget;
  postWorkoutSlot?: MealSlot;
  /** The user's cooking time for the day (Prompt 4) – replaces the time budget's limit. */
  maxPrepMin?: number;
}

/** Everything besides the days that the week score needs (all optional). */
export interface ScoreExtras {
  affinity?: (recipeId: string, budget: TimeBudget) => number;
  budgetChf?: number;
  pantryAgeDays?: Record<string, number>;
  /** "Ich koche gern vor" (E18): meal-prep dishes are bundled into leftovers. */
  mealPrep?: boolean;
  /** Foods 👍 / 👎 of the profile per recipe (Prompt 4) – on the same scale as `affinity`. */
  food?: (recipe: Recipe) => number;
}

export interface WeekScore {
  total: number;
  nutrition: number;
  variety: number;
  newFoods: number;
  packageWaste: number;
  /** Preparation time beyond the days' budgets (F5). */
  time: number;
  /** Perishable pantry stock the week does not use (F2). */
  pantryUnused: number;
  /** Personal preference term (negative = liked meals). */
  preference: number;
  /** Cost and budget term. */
  cost: number;
  /** Estimated purchase cost of the week in CHF (priced foods only). */
  costChf: number;
  /** Fiber and post-workout protein term. */
  quality: number;
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

/** Recipes and the days they are cooked on – to recognise meal-prep leftovers. */
type Cooked = Map<string, ISODate[]>;

function markCooked(cooked: Cooked, recipeId: string, date: ISODate) {
  const list = cooked.get(recipeId);
  if (list) list.push(date);
  else cooked.set(recipeId, [date]);
}

/**
 * Preparation a meal really costs on `date`: a meal-prep dish cooked on one of
 * the previous LEFTOVER_DAYS days only needs reheating – only for users who
 * like to cook ahead (E18), otherwise every meal is cooked fresh.
 */
export function effectivePrepMin(recipe: Recipe, date: ISODate, cooked: Cooked, mealPrep: boolean): number {
  return mealPrep && isLeftover(recipe, date, cooked) ? Math.min(recipe.prepMin, LEFTOVER_PREP_MIN) : recipe.prepMin;
}

/** A meal-prep dish cooked on one of the previous LEFTOVER_DAYS days. */
export function isLeftover(recipe: Recipe, date: ISODate, cooked: Cooked): boolean {
  if (!recipe.mealPrep) return false;
  const today = dayNumber(date);
  return (cooked.get(recipe.id) ?? []).some((d) => {
    const age = today - dayNumber(d);
    return age >= 1 && age <= LEFTOVER_DAYS;
  });
}

/**
 * Day number of an ISO date, cached: the week score runs hundreds of times per
 * plan and only ever sees a handful of dates – creating Date objects for each
 * comparison was the planner's biggest cost.
 */
const dayNumbers = new Map<ISODate, number>();
function dayNumber(iso: ISODate): number {
  let n = dayNumbers.get(iso);
  if (n === undefined) {
    const [y, m, d] = iso.split('-').map(Number);
    n = Math.round(Date.UTC(y!, m! - 1, d!) / 86_400_000);
    dayNumbers.set(iso, n);
  }
  return n;
}

/** Preparation from which a dish counts as "aufwendig" for a day with much time. */
export const ELABORATE_PREP_MIN = 25;

/**
 * Time term of a meal: preparation beyond the day's budget costs score; on a
 * day with much time an elaborate dish gets a small bonus (negative cost).
 */
function timeCost(prepMin: number, budget: TimeBudget, W: PlannerWeights, maxPrepMin = TIME_BUDGETS[budget].maxPrepMin): number {
  const over = (W.timeOver * Math.max(0, prepMin - maxPrepMin)) / 10;
  return budget === 'high' && prepMin >= ELABORATE_PREP_MIN ? over - W.elaborate : over;
}

const fiberCache = new Map<string, number>();
/** Fiber of one serving in g. */
export function recipeFiber(r: Recipe | undefined): number {
  if (!r) return 0;
  let f = fiberCache.get(r.id);
  if (f === undefined) {
    f = r.ingredients.reduce((sum, i) => sum + ((getFood(i.foodId)?.micros?.fiber ?? 0) * i.grams) / 100, 0);
    fiberCache.set(r.id, f);
  }
  return f;
}

function dayFactor(day: PlanningDay): number {
  const kcal = day.picks.reduce((s, r) => s + baseMacros(r).kcal, 0);
  return day.remainingKcal / (kcal || 1);
}

/**
 * Scores a whole week – nutrition per day, variety across the week, the
 * shopping it causes (distinct foods to buy, opened perishable packages) and
 * cooking time beyond each day's time budget. `context` are fixed meals of the
 * same week outside the planned days (they count for variety, foods, leftovers).
 */
export function scoreWeek(
  days: PlanningDay[],
  pantry: Record<string, number> = {},
  weights: Partial<PlannerWeights> = {},
  context: PlannedMeal[] = [],
  extras: ScoreExtras = {},
): WeekScore {
  const W = { ...PLANNER_WEIGHTS, ...weights };
  let nutrition = 0;
  let preference = 0;
  let quality = 0;
  const uses = new Map<string, number>();
  const need = new Map<string, number>();
  const addNeed = (r: Recipe, servings: number) => {
    // Staples (salt, pepper, spices) are at home – no purchase, no cost, no new food (E19).
    for (const i of r.ingredients) if (!isStaple(i.foodId)) need.set(i.foodId, (need.get(i.foodId) ?? 0) + i.grams * servings);
  };

  const cooked: Cooked = new Map();
  for (const m of context) {
    uses.set(m.recipeId, (uses.get(m.recipeId) ?? 0) + 1);
    markCooked(cooked, m.recipeId, m.date);
    const r = getRecipe(m.recipeId);
    if (r && m.status === 'planned') addNeed(r, m.servings);
  }
  for (const day of days) {
    for (const m of day.fixed) markCooked(cooked, m.recipeId, day.date);
    for (const r of day.picks) markCooked(cooked, r.id, day.date);
  }

  let time = 0;
  for (const day of days) {
    const factor = dayFactor(day);
    for (const r of day.picks) time += timeCost(effectivePrepMin(r, day.date, cooked, !!extras.mealPrep), day.timeBudget, W, day.maxPrepMin);
    const fixedProtein = day.fixed.reduce((s, m) => s + plannedMealMacros(m).protein, 0);
    const protein = fixedProtein + day.picks.reduce((s, r) => s + baseMacros(r).protein, 0) * factor;
    nutrition += W.proteinGap * (Math.max(0, day.target.protein - protein) / day.target.protein) + belowProteinFloor(fixedProtein + day.picks.reduce((s, r) => s + baseMacros(r).protein, 0) * roundServings(factor), day.target.protein, W);
    if (day.picks.length) nutrition += W.extremeServing * Math.abs(Math.log(factor));

    if (extras.affinity) for (const r of day.picks) preference -= W.preference * extras.affinity(r.id, day.timeBudget);
    if (extras.food) for (const r of day.picks) preference -= W.preference * extras.food(r);
    if (extras.mealPrep) for (const r of day.picks) if (isLeftover(r, day.date, cooked)) preference -= W.mealPrepBundle;

    const fiber = day.fixed.reduce((s, m) => s + recipeFiber(getRecipe(m.recipeId)) * m.servings, 0) + day.picks.reduce((s, r) => s + recipeFiber(r), 0) * factor;
    const fiberTarget = (day.target.kcal / 1000) * FIBER_PER_1000_KCAL_G;
    quality += W.fiberGap * (Math.max(0, fiberTarget - fiber) / fiberTarget);
    const post = day.postWorkoutSlot ? day.picks[day.slots.indexOf(day.postWorkoutSlot)] : undefined;
    if (post) quality += W.postWorkoutProtein * (Math.max(0, POST_WORKOUT_PROTEIN_G - baseMacros(post).protein * factor) / POST_WORKOUT_PROTEIN_G);

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
  let costChf = 0;
  for (const [foodId, grams] of need) {
    const toBuy = grams - (pantry[foodId] ?? 0);
    if (toBuy <= 0.5) continue;
    foodsToBuy.push(foodId);
    const food = getFood(foodId);
    // Cost of what is actually bought (whole packages), pantry already deducted.
    if (food) costChf += purchaseCost(food, toBuy) ?? 0;
    if (food?.packageG && PERISHABLE.has(food.category)) {
      const packs = Math.ceil(toBuy / food.packageG);
      waste += (packs * food.packageG - toBuy) / food.packageG;
    }
  }
  const newFoods = W.newFood * foodsToBuy.length;
  const packageWaste = W.packageWaste * waste;

  let unused = 0;
  for (const [foodId, stock] of Object.entries(pantry)) {
    if (stock <= 0 || !PERISHABLE.has(getFood(foodId)?.category ?? '')) continue;
    // Older stock should be used first (no expiry data – only its age is known).
    const age = extras.pantryAgeDays?.[foodId] ?? 0;
    unused += (Math.max(0, stock - (need.get(foodId) ?? 0)) / stock) * (1 + Math.min(1, age / 7));
  }
  const pantryUnused = W.pantryUnused * unused;
  const cost = (W.cost * costChf) / 10 + (extras.budgetChf !== undefined ? (W.budgetOver * Math.max(0, costChf - extras.budgetChf)) / 10 : 0);

  return {
    total: nutrition + variety + newFoods + packageWaste + time + pantryUnused + preference + cost + quality,
    nutrition,
    variety,
    newFoods,
    packageWaste,
    time,
    pantryUnused,
    preference,
    cost,
    costChf,
    quality,
    foodsToBuy,
  };
}

/**
 * Rule-based week suggestion. Fills only EMPTY slots, keeps what the user
 * planned. Two phases:
 *  1. Day by day (as before): random candidates weighted towards unused
 *     recipes, scored by protein, repeats, portion size – plus foods the week
 *     does not need yet.
 *  2. Whole week: every suggested meal is tried against every allowed recipe
 *     of its slot; a swap is kept only if the WEEK score improves.
 * Time budget (F5): preparation beyond a day's budget costs score; meal-prep
 * leftovers from the previous days count as quick. Meals in `existing` outside
 * `dates` are context: they stay fixed but count for foods, variety, leftovers.
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
  timeBudgetFor = () => 'normal',
  excludedSlotsFor = () => [],
  affinity,
  budgetChf,
  priority = 'balanced',
  postWorkoutSlotFor = () => undefined,
  pantryAgeDays,
  random = Math.random,
  weights: overrides = {},
  mealPrep = false,
  maxPrepFor,
  portableFor,
}: SuggestInput): PlannedMeal[] {
  const W = weightsFor(priority, overrides);
  const weights = W;
  const food = foodScorer(profile);
  const extras: ScoreExtras = { affinity, budgetChf, pantryAgeDays, mealPrep, ...(food ? { food } : {}) };
  const usage = new Map<string, number>();
  for (const m of existing) usage.set(m.recipeId, (usage.get(m.recipeId) ?? 0) + 1);

  // Foods the week already needs or has at home – reusing them is free.
  const weekFoods = new Set<string>(Object.keys(pantry).filter((id) => pantry[id]! > 0));
  for (const m of existing) {
    if (m.status === 'planned') getRecipe(m.recipeId)?.ingredients.forEach((i) => weekFoods.add(i.foodId));
  }
  const context = existing.filter((m) => !dates.includes(m.date) && m.status !== 'skipped');
  const cooked: Cooked = new Map();
  for (const m of existing) if (m.status !== 'skipped') markCooked(cooked, m.recipeId, m.date);

  const days: PlanningDay[] = [];
  // Allowed recipes per slot – filtered once, not in every attempt.
  const slotRecipes = new Map<MealSlot, Recipe[]>();
  const recipesFor = (slot: MealSlot) => {
    let list = slotRecipes.get(slot);
    if (!list) slotRecipes.set(slot, (list = recipesForSlot(slot, profile)));
    return list;
  };
  // "Mitnehmen": portable recipes only ("chilled" ones show "Kühlung nötig").
  const poolFor = (date: ISODate, slot: MealSlot) => (portableFor?.(date, slot) ? recipesFor(slot).filter(isPortable) : recipesFor(slot));

  // ---- Phase 1: day by day ----
  for (const date of dates) {
    const target = targetFor?.(date) ?? baseTarget;
    const timeBudget = timeBudgetFor(date);
    const maxPrepMin = maxPrepFor?.(date);
    const postWorkoutSlot = postWorkoutSlotFor(date);
    const fixed = existing.filter((m) => m.date === date && m.status !== 'skipped');
    // Slots without any matching recipe (strict diet combinations) stay empty
    // instead of blocking the whole day.
    const excluded = excludedSlotsFor(date);
    const emptySlots = slots.filter(
      (s) => !excluded.includes(s) && !existing.some((m) => m.date === date && m.slot === s) && poolFor(date, s).length > 0,
    );
    if (emptySlots.length === 0) continue;

    const fixedMacros = sumMacros(fixed.map(plannedMealMacros));
    // Safety floor if fixed meals already exceed the target – proportional to the
    // free slots, so re-planning a single meal cannot inflate it (20 % for an empty day).
    const minShare = (0.2 * emptySlots.length) / (emptySlots.length + fixed.length);
    const remainingKcal = Math.max(target.kcal - fixedMacros.kcal, target.kcal * minShare);

    let best: { picks: Recipe[]; score: number } | null = null;

    for (let attempt = 0; attempt < 60; attempt++) {
      const picks: Recipe[] = [];
      for (const slot of emptySlots) {
        // The cooking time holds whenever recipes fit it (Prompt 4).
        const allowed = poolFor(date, slot);
        const fitting = maxPrepMin === undefined ? allowed : allowed.filter((r) => effectivePrepMin(r, date, cooked, mealPrep) <= maxPrepMin);
        const all = fitting.length ? fitting : allowed;
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
      const proteinGap = Math.max(0, target.protein - protein) / target.protein + belowProteinFloor(fixedMacros.protein + base.protein * roundServings(factor), target.protein, W);
      const repeatPenalty = picks.reduce((s, r) => s + (usage.get(r.id) ?? 0), 0) * W.recipeRepeat;
      const extremeServing = Math.abs(Math.log(factor)) * W.extremeServing;
      const unseen = new Set(picks.flatMap((r) => r.ingredients.map((i) => i.foodId)).filter((f) => !weekFoods.has(f) && !isStaple(f)));
      const time = picks.reduce((sum, r) => sum + timeCost(effectivePrepMin(r, date, cooked, mealPrep), timeBudget, W, maxPrepMin), 0);
      const liked = (affinity ? picks.reduce((sum, r) => sum - W.preference * affinity(r.id, timeBudget), 0) : 0) + (food ? picks.reduce((sum, r) => sum - W.preference * food(r), 0) : 0);
      const postIndex = postWorkoutSlot ? emptySlots.indexOf(postWorkoutSlot) : -1;
      const post = postIndex >= 0 ? picks[postIndex] : undefined;
      const postGap = post ? (W.postWorkoutProtein * Math.max(0, POST_WORKOUT_PROTEIN_G - baseMacros(post).protein * factor)) / POST_WORKOUT_PROTEIN_G : 0;
      const bundled = mealPrep ? picks.filter((r) => isLeftover(r, date, cooked)).length * W.mealPrepBundle : 0;
      const score = proteinGap + repeatPenalty + extremeServing + unseen.size * W.newFood + time + liked + postGap - bundled;

      if (!best || score < best.score) best = { picks, score };
    }

    if (!best) continue;
    for (const r of best.picks) {
      usage.set(r.id, (usage.get(r.id) ?? 0) + 1);
      r.ingredients.forEach((i) => weekFoods.add(i.foodId));
      markCooked(cooked, r.id, date);
    }
    days.push({ date, target, fixed, remainingKcal, slots: emptySlots, picks: best.picks, timeBudget, postWorkoutSlot, ...(maxPrepMin !== undefined ? { maxPrepMin } : {}) });
  }

  // ---- Phase 2: improve the week as a whole ----
  let current = scoreWeek(days, pantry, weights, context, extras).total;
  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    for (const day of days) {
      day.slots.forEach((slot, i) => {
        const taken = new Set([...day.picks.filter((_, k) => k !== i).map((r) => r.id), ...day.fixed.map((m) => m.recipeId)]);
        const original = day.picks[i]!;
        let bestRecipe = original;
        const tooLong = (r: Recipe) => day.maxPrepMin !== undefined && r.prepMin > day.maxPrepMin;
        for (const alt of poolFor(day.date, slot)) {
          if (alt.id === original.id || taken.has(alt.id)) continue;
          // Never trade a dish that fits the cooking time for one that does not.
          if (tooLong(alt) && !tooLong(original)) continue;
          day.picks[i] = alt;
          const score = scoreWeek(days, pantry, weights, context, extras).total;
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

export interface MealOption {
  recipe: Recipe;
  servings: number;
  macros: Macros;
  /** Week score with this option (lower = better) – the planner's own measure. */
  score: number;
}

export interface RankInput {
  date: ISODate;
  slot: MealSlot;
  /** Target of the day, already reduced by what was eaten outside the plan. */
  target: Macros;
  /** Other meals of the day (planned or eaten) – fixed, they count for protein and variety. */
  fixed: PlannedMeal[];
  /** Calories the option should fill. */
  kcal: number;
  timeBudget: TimeBudget;
  postWorkoutSlot?: MealSlot;
  profile: NutritionProfile | null;
  /** Meals of the rest of the week – context for variety, foods and leftovers. */
  context: PlannedMeal[];
  pantry?: Record<string, number>;
  extras?: ScoreExtras;
  priority?: PlanPriority;
  exclude?: string[];
  /** "Mitnehmen" (Prompt 5): portable recipes only. */
  portableOnly?: boolean;
}

/**
 * Options for ONE slot, ranked with the same week score the planner uses
 * (protein, time budget, variety, pantry, costs, fiber, post-workout protein,
 * preferences). Used for "Passend zu deinem Plan" – never random.
 */
export function rankMealOptions(input: RankInput, limit = 3): MealOption[] {
  const W = weightsFor(input.priority);
  const food = input.extras?.food ?? foodScorer(input.profile);
  const extras: ScoreExtras = { ...input.extras, ...(food ? { food } : {}) };
  return recipesForSlot(input.slot, input.profile)
    .filter((r) => !input.exclude?.includes(r.id) && (!input.portableOnly || isPortable(r)))
    .map((recipe) => {
      const day: PlanningDay = {
        date: input.date,
        target: input.target,
        fixed: input.fixed,
        remainingKcal: input.kcal,
        slots: [input.slot],
        picks: [recipe],
        timeBudget: input.timeBudget,
        postWorkoutSlot: input.postWorkoutSlot,
      };
      const servings = roundServings(dayFactor(day));
      return { recipe, servings, macros: recipeMacros(recipe, servings), score: scoreWeek([day], input.pantry, W, input.context, extras).total };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, limit);
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
