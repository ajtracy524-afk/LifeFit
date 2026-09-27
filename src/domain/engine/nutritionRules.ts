import { getFood } from '../../data/foods';
import { RECIPES, getRecipe } from '../../data/recipes';
import { SLOT_LABEL, fmt } from '../../lib/format';
import { addDays } from '../dates';
import { dayTotals, foodAllowed, foodMacros, recipeAllowed, recipeMacros, roundServings, targetForDate } from '../nutrition';
import { recipesForSlot, servingsForSlot, swapOptions } from '../planner';
import type { Macros, MealSlot, Recipe } from '../types';
import { dayContextFor, pantryEstimate, weekFoodCost } from '../week';
import { formatCostRange, priceLookup, recipeCostRange, type CostRange } from '../costs';
import { dishCostRange, dishPortionNutrition } from '../dishes';
import { plannerAffinity } from '../preferences';
import { effectiveTimeBudget, TIME_BUDGETS } from '../timeBudget';
import type { EngineContext } from './context';
import type { EngineAction, Recommendation } from './types';

export const NUTRITION_RULES = {
  /** Below these open amounts nothing is suggested – the ring on "Heute" is enough. */
  minKcalGap: 150,
  minProteinGap: 15,
  /** One suggested meal never exceeds this share of the daily target … */
  maxMealShare: 0.45,
  /** … and after this hour only a small snack is suggested. */
  lateHour: 21,
  lateMealShare: 0.2,
  /** Over the target by more than this share → neutral info, never compensation. */
  overShare: 0.1,
  /** Protein pattern: average below this share of the target over ≥ 4 logged days. */
  proteinPatternShare: 0.8,
  proteinPatternMinDays: 4,
  /** Recipes eaten/planned within this many days count as "had recently". */
  varietyDays: 2,
  /** Pantry leftovers below this amount are not worth a suggestion. */
  minLeftoverG: 50,
  /** Protein shortfall weight – higher on a training day (the day target already has more protein). */
  proteinWeight: 1.2,
  proteinWeightTraining: 1.5,
  /** Learned taste (−1 … 1, avoided far below): a clear, but not dominating pull. */
  affinityWeight: 0.15,
  /** Per CHF of a serving, only when the week is already over its budget. */
  overBudgetPerChf: 0.03,
} as const;

/** Ready-to-eat foods that close a protein gap without many calories. */
const PROTEIN_FOODS = ['skyr', 'quark', 'greek-yogurt', 'cottage', 'whey', 'tofu', 'edamame', 'tuna', 'protein-bar'];

/** Perishables worth using up when their planned meal was skipped. */
const PERISHABLE = new Set(['produce', 'meat_fish', 'dairy']);

// ---------- Meal suggestions ----------

export interface MealSuggestion {
  recipe: Recipe;
  slot: MealSlot;
  servings: number;
  macros: Macros;
  /** Ingredients not at home – they land on the shopping list once the meal is planned. */
  missingFoods: string[];
  score: number;
  /** Price range of the serving – only with enough price data (never invented). */
  cost?: CostRange;
  /** Short, factual reasons ("nur 15 min – passt zu „Wenig Zeit“"). */
  because: string[];
}

/**
 * Scores every allowed recipe for the next free slot. Lower score = better.
 *   calorie fit + protein shortfall (heavier on a training day)
 *   + missing ingredients + recently eaten + long prep late in the day
 *   − learned taste (favorites, eaten/replaced meals – see preferences.ts)
 *   + cost, only when the week is already over its CHF budget
 * Hard filters: diet and allergens; the day's time budget as long as at least
 * one recipe fits it (fitting first, like the cascade). Every suggestion
 * carries the facts it was chosen for, so the UI can say why.
 */
export function suggestMealsForGap(ctx: EngineContext, gap: Pick<Macros, 'kcal' | 'protein'>, limit = 3): MealSuggestion[] {
  const target = ctx.target;
  if (!target || gap.kcal <= 0) return [];
  const R = NUTRITION_RULES;
  const profile = ctx.state.nutritionProfile;
  const late = ctx.hour >= R.lateHour;

  const slots: MealSlot[] = late || ctx.freeSlots.length === 0 ? ['snack'] : ctx.freeSlots;
  const mealCount = late ? 1 : slots.length;
  const mealKcal = Math.min(gap.kcal / mealCount, target.kcal * (late ? R.lateMealShare : R.maxMealShare));
  const mealProtein = Math.max(0, gap.protein) / mealCount;

  const recent = new Set(
    ctx.state.plannedMeals
      .filter((m) => m.status !== 'skipped' && m.date >= addDays(ctx.date, -R.varietyDays) && m.date <= ctx.date)
      .map((m) => m.recipeId),
  );

  // Next free slot that has at least one allowed recipe.
  const slot = slots.find((s) => recipesForSlot(s, profile).length > 0);
  if (!slot) return [];

  const timeBudget = effectiveTimeBudget(dayContextFor(ctx.state, ctx.date));
  const maxPrep = TIME_BUDGETS[timeBudget].maxPrepMin;
  const trainingDay = !!ctx.todaysSession || ctx.trainedToday;
  const affinity = plannerAffinity(ctx.state.learning?.preferences ?? {}, profile);
  const price = priceLookup(ctx.state.products);
  const weekBudget = ctx.state.plannerSettings?.weeklyBudgetChf;
  const weekCost = weekBudget !== undefined ? weekFoodCost(ctx.state, ctx.weekStart) : undefined;
  const overBudget = weekBudget !== undefined && !!weekCost && weekCost.lowChf > weekBudget;

  const allowed = recipesForSlot(slot, profile).filter((r) => !(ctx.hour >= 20 && r.prepMin > 30));
  const fitting = allowed.filter((r) => r.prepMin <= maxPrep);
  const pool = fitting.length ? fitting : allowed;

  return pool
    .map((recipe) => {
      const servings = roundServings(mealKcal / (recipeMacros(recipe).kcal || 1));
      const macros = recipeMacros(recipe, servings);
      const missingFoods = recipe.ingredients.filter((i) => !ctx.pantry.has(i.foodId)).map((i) => i.foodId);
      const cost = recipeCostRange(recipe, servings, price);
      const liked = affinity(recipe.id, timeBudget);

      const kcalError = Math.abs(macros.kcal - mealKcal) / mealKcal;
      const proteinShort = mealProtein > 0 ? Math.max(0, mealProtein - macros.protein) / mealProtein : 0;
      const score =
        kcalError +
        (trainingDay ? R.proteinWeightTraining : R.proteinWeight) * proteinShort +
        0.08 * missingFoods.length +
        (recent.has(recipe.id) ? 0.25 : 0) +
        (ctx.hour >= 18 && recipe.prepMin > 20 ? 0.1 : 0) +
        (recipe.prepMin > maxPrep ? 0.5 : 0) -
        R.affinityWeight * liked +
        (overBudget && cost ? R.overBudgetPerChf * ((cost.lowChf + cost.highChf) / 2) : 0);

      const because = [
        timeBudget === 'low' && recipe.prepMin <= maxPrep ? `nur ${recipe.prepMin} min – passt zu „${TIME_BUDGETS.low.label}“` : null,
        mealProtein >= 10 && macros.protein >= mealProtein * 0.8 ? `${fmt.g(macros.protein)} Protein – deckt deine offene Menge` : null,
        trainingDay && macros.protein >= 25 ? 'eiweißreich – heute ist Trainingstag' : null,
        kcalError <= 0.15 ? `${fmt.kcal(macros.kcal)} – passt zu deinen offenen Kalorien` : null,
        missingFoods.length === 0 ? 'alle Zutaten laut Vorrat da' : null,
        liked >= 0.3 ? 'isst du gern' : null,
        overBudget && cost ? `günstig: ${formatCostRange(cost)}` : null,
      ].filter((b): b is string => !!b);

      return { recipe, slot, servings, macros, missingFoods, score, cost, because };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, limit);
}

export interface FoodSuggestion {
  foodId: string;
  name: string;
  grams: number;
  macros: Macros;
}

/** Protein gap without calorie room: lean, ready-to-eat foods, preferring what is at home. */
export function suggestProteinFoods(ctx: EngineContext, proteinGap: number, kcalRoom: number, limit = 2): FoodSuggestion[] {
  const profile = ctx.state.nutritionProfile;
  const maxKcal = Math.max(150, kcalRoom + 150);
  return PROTEIN_FOODS.map((id) => getFood(id))
    .filter((f): f is NonNullable<typeof f> => !!f && foodAllowed(f, profile))
    .map((food) => {
      const perGram = food.per100.protein / 100;
      let grams = Math.min(proteinGap / perGram, (maxKcal / food.per100.kcal) * 100);
      grams = food.pieceG ? Math.max(1, Math.round(grams / food.pieceG)) * food.pieceG : Math.max(20, Math.round(grams / 10) * 10);
      const macros = foodMacros(food, grams);
      const density = food.per100.protein / food.per100.kcal;
      return { food, grams, macros, rank: density + (ctx.pantry.has(food.id) ? 0.1 : 0) };
    })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map(({ food, grams, macros }) => ({ foodId: food.id, name: food.name, grams, macros }));
}

/** "Wenig Zeit heute · Trainingstag · noch ca. 620 kcal offen" – the situation the suggestion answers. */
function situation(timeBudget: keyof typeof TIME_BUDGETS, trainingDay: boolean, openKcal: number): string {
  const parts = [timeBudget !== 'normal' ? `${TIME_BUDGETS[timeBudget].label} heute` : null, trainingDay ? 'Trainingstag' : null, `noch ca. ${fmt.kcal(openKcal)} offen`];
  const text = parts.filter(Boolean).join(' · ');
  return text[0]!.toUpperCase() + text.slice(1);
}

// ---------- Rules ----------

/** "Heute fehlen noch 650 kcal und 50 g Protein" → suggest matching meals. */
export function nutritionGapRule(ctx: EngineContext): Recommendation[] {
  const t = ctx.target;
  if (!t) return [];
  const R = NUTRITION_RULES;

  const missing = { kcal: t.kcal - ctx.eaten.kcal, protein: t.protein - ctx.eaten.protein };
  const open = { kcal: missing.kcal - ctx.plannedOpenMacros.kcal, protein: missing.protein - ctx.plannedOpenMacros.protein };
  if (open.kcal < R.minKcalGap && open.protein < R.minProteinGap) return [];

  const parts = [
    missing.kcal >= 50 ? fmt.kcal(missing.kcal) : null,
    missing.protein >= 5 ? `${fmt.g(missing.protein)} Protein` : null,
  ].filter(Boolean);
  const title = `Heute fehlen noch ${parts.join(' und ')}`;

  const reasons = [`Gegessen: ${fmt.int(ctx.eaten.kcal)} von ${fmt.kcal(t.kcal)}, ${fmt.g(ctx.eaten.protein)} von ${fmt.g(t.protein)} Protein`];
  if (ctx.plannedOpen.length > 0) {
    reasons.push(`Noch geplant: ${fmt.kcal(ctx.plannedOpenMacros.kcal)}, ${fmt.g(ctx.plannedOpenMacros.protein)} Protein`);
  }

  const late = ctx.hour >= R.lateHour;
  const timeBudget = effectiveTimeBudget(dayContextFor(ctx.state, ctx.date));
  const trainingDay = !!ctx.todaysSession || ctx.trainedToday;
  const facts = {
    targetKcal: t.kcal,
    targetProtein: t.protein,
    eatenKcal: Math.round(ctx.eaten.kcal),
    eatenProtein: Math.round(ctx.eaten.protein),
    missingKcal: Math.round(missing.kcal),
    missingProtein: Math.round(missing.protein),
    openKcal: Math.round(open.kcal),
    openProtein: Math.round(open.protein),
    late,
    timeBudget,
    trainingDay,
  };

  let actions: EngineAction[] = [];
  let message: string;

  if (open.kcal >= R.minKcalGap) {
    const meals = suggestMealsForGap(ctx, open);
    actions = meals.map((m) => ({
      type: 'add_meal',
      label: `${m.recipe.emoji} ${m.recipe.title} · ${fmt.kcal(m.macros.kcal)} · ${fmt.g(m.macros.protein)} P`,
      date: ctx.date,
      slot: m.slot,
      recipeId: m.recipe.id,
      servings: m.servings,
      details: { title: `${m.recipe.emoji} ${m.recipe.title}`, prepMin: m.recipe.prepMin, kcal: Math.round(m.macros.kcal), protein: Math.round(m.macros.protein), cost: m.cost, because: m.because },
    }));
    const best = meals[0];
    if (best) {
      const missingNote = best.missingFoods.length
        ? ` ${best.missingFoods.length} Zutat${best.missingFoods.length === 1 ? '' : 'en'} kommt beim Einplanen auf die Einkaufsliste.`
        : ' Alle Zutaten sind laut Einkaufsliste da.';
      message = late
        ? `Für heute Abend reicht ein kleiner, eiweißreicher Snack – der Rest ist kein Problem.${missingNote}`
        : `${situation(timeBudget, trainingDay, open.kcal)} – passend für ${SLOT_LABEL[best.slot]}:${missingNote}`;
    } else {
      message = 'Kein Rezept passt zu deinen Ernährungsvorlieben – erfasse einfach, was du isst.';
    }
  } else {
    // Calories are covered, only protein is short.
    const foods = suggestProteinFoods(ctx, open.protein, Math.max(0, open.kcal));
    actions = foods.map((f) => ({
      type: 'log_food',
      label: `${f.name} ${fmt.g(f.grams)} erfassen · ${fmt.g(f.macros.protein)} P · ${fmt.kcal(f.macros.kcal)}`,
      date: ctx.date,
      slot: 'snack',
      foodId: f.foodId,
      grams: f.grams,
    }));
    message = 'Kalorien passen – ein eiweißreicher Snack schließt die Lücke.';
  }

  const priority = ctx.hour >= 17 && open.protein >= 30 ? 'high' : 'medium';
  return [
    { id: `nutrition_gap:${ctx.date}`, kind: 'nutrition_gap', domain: 'nutrition', priority, confidence: 'high', title, message, reasons, facts, actions },
  ];
}

/** Over target: neutral info. Deliberately NO compensation (no skipping, no "burning it off"). */
export function nutritionOverRule(ctx: EngineContext): Recommendation[] {
  const t = ctx.target;
  if (!t || ctx.eaten.kcal <= t.kcal * (1 + NUTRITION_RULES.overShare)) return [];
  const over = ctx.eaten.kcal - t.kcal;
  return [
    {
      id: `nutrition_over:${ctx.date}`,
      kind: 'nutrition_over',
      domain: 'nutrition',
      priority: 'low',
      confidence: 'high',
      title: `Heute ${fmt.kcal(over)} über dem Ziel`,
      message: 'Ein einzelner Tag fällt kaum ins Gewicht. Kein Ausgleich nötig – morgen einfach normal nach Plan weiter.',
      reasons: [],
      facts: { overKcal: Math.round(over), targetKcal: t.kcal },
      actions: [],
    },
  ];
}

/** Protein repeatedly short over the last week → swap upcoming meals for higher-protein ones. */
export function proteinPatternRule(ctx: EngineContext): Recommendation[] {
  const R = NUTRITION_RULES;
  const days = Array.from({ length: 7 }, (_, i) => addDays(ctx.date, -(i + 1)));
  const logged = days
    .map((d) => ({ d, totals: dayTotals(ctx.state.logEntries, d), target: targetForDate(ctx.state.targets, d) }))
    .filter((x) => x.totals.kcal > 0 && x.target);
  if (logged.length < R.proteinPatternMinDays) return [];

  const avg = logged.reduce((s, x) => s + x.totals.protein, 0) / logged.length;
  const avgTarget = logged.reduce((s, x) => s + x.target!.protein, 0) / logged.length;
  if (avg >= avgTarget * R.proteinPatternShare) return [];

  const upcoming = ctx.state.plannedMeals.filter((m) => m.status === 'planned' && m.date >= ctx.date && m.date <= addDays(ctx.date, 3));
  const swaps = upcoming
    .map((meal) => ({ meal, option: swapOptions(meal, ctx.state.nutritionProfile, 8).sort((a, b) => b.proteinDelta - a.proteinDelta)[0] }))
    .filter((x) => x.option && x.option.proteinDelta >= 10)
    .sort((a, b) => b.option!.proteinDelta - a.option!.proteinDelta)
    .slice(0, 2);

  const actions: EngineAction[] = swaps.map(({ meal, option }) => ({
    type: 'swap_meal',
    label: `${getRecipe(meal.recipeId)?.title ?? 'Mahlzeit'} → ${option!.recipe.title} (+${fmt.g(option!.proteinDelta)} P)`,
    mealId: meal.id,
    recipeId: option!.recipe.id,
    servings: option!.servings,
  }));
  if (actions.length === 0) actions.push({ type: 'open', label: 'Essensplan ansehen', route: 'nutrition' });

  return [
    {
      id: `protein_pattern:${ctx.date}`,
      kind: 'protein_pattern',
      domain: 'nutrition',
      priority: 'medium',
      confidence: logged.length >= 6 ? 'high' : 'medium',
      title: `Protein zuletzt bei Ø ${fmt.g(avg)} (Ziel ${fmt.g(avgTarget)})`,
      message: 'Mit gleichen Kalorien, aber mehr Eiweiß kommst du leichter hin:',
      reasons: [`${logged.length} erfasste Tage in den letzten 7 Tagen`],
      facts: { avgProtein: Math.round(avg), targetProtein: Math.round(avgTarget), loggedDays: logged.length },
      actions,
    },
  ];
}

/** Perishables in the pantry that no planned meal uses any more → a recipe that uses them up. */
export function leftoversRule(ctx: EngineContext): Recommendation[] {
  const stock = pantryEstimate(ctx.state);
  const stillPlanned = new Set(
    ctx.state.plannedMeals
      .filter((m) => m.status === 'planned' && m.date >= ctx.date)
      .flatMap((m) => getRecipe(m.recipeId)?.ingredients.map((i) => i.foodId) ?? []),
  );

  const leftovers = new Set<string>();
  for (const [foodId, grams] of Object.entries(stock)) {
    const food = getFood(foodId);
    if (food && PERISHABLE.has(food.category) && grams >= NUTRITION_RULES.minLeftoverG && !stillPlanned.has(foodId)) leftovers.add(foodId);
  }
  if (leftovers.size === 0 || !ctx.target) return [];

  const profile = ctx.state.nutritionProfile;
  const best = RECIPES.filter((r) => recipeAllowed(r, profile))
    .map((r) => ({ r, uses: r.ingredients.filter((i) => leftovers.has(i.foodId)).length }))
    .filter((x) => x.uses > 0)
    .sort((a, b) => b.uses - a.uses)[0];
  if (!best) return [];

  const tomorrow = addDays(ctx.date, 1);
  const usedTomorrow = new Set(ctx.state.plannedMeals.filter((m) => m.date === tomorrow && m.status !== 'skipped').map((m) => m.slot));
  const todaySlot = best.r.slots.find((s) => ctx.freeSlots.includes(s));
  const tomorrowSlot = best.r.slots.find((s) => ctx.slots.includes(s) && !usedTomorrow.has(s));
  const date = todaySlot ? ctx.date : tomorrow;
  const slot = todaySlot ?? tomorrowSlot;
  const names = [...leftovers].map((id) => getFood(id)!.name);

  return [
    {
      id: `leftovers:${ctx.date}`,
      kind: 'leftovers',
      domain: 'shopping',
      priority: 'low',
      confidence: 'medium',
      title: `Noch da: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ' …' : ''}`,
      message: `Im Vorrat und nicht mehr eingeplant. ${best.r.title} verwertet ${best.uses === 1 ? 'eine Zutat' : `${best.uses} Zutaten`} davon.`,
      reasons: names.map((n) => `${n} – laut Vorrat noch da, aktuell nicht eingeplant`),
      facts: { leftoverCount: leftovers.size, usedByRecipe: best.uses },
      actions: slot
        ? [
            {
              type: 'add_meal',
              label: `${best.r.emoji} ${best.r.title} ${date === ctx.date ? 'heute' : 'morgen'} einplanen`,
              date,
              slot,
              recipeId: best.r.id,
              servings: servingsForSlot(best.r, slot, ctx.target, ctx.slots),
            },
          ]
        : [],
    },
  ];
}

/** Portions an own dish is suggested in – halves only, like the portion picker. */
const DISH_PORTIONS = [0.5, 1, 1.5, 2];

/**
 * "Dein Melon Sandwich passt heute gut": an own dish that fits what is still
 * open today (after planned meals). Same room as the meal suggestions
 * (maxMealShare, late snack), protein weighed the same way; dishes the user
 * logs often win ties. Only when it really fits (±25 % of the meal size).
 */
export function ownDishRule(ctx: EngineContext): Recommendation[] {
  const t = ctx.target;
  const dishes = Object.values(ctx.state.customDishes ?? {});
  if (!t || dishes.length === 0) return [];
  const R = NUTRITION_RULES;
  const open = { kcal: t.kcal - ctx.eaten.kcal - ctx.plannedOpenMacros.kcal, protein: t.protein - ctx.eaten.protein - ctx.plannedOpenMacros.protein };
  if (open.kcal < R.minKcalGap) return [];
  const late = ctx.hour >= R.lateHour;
  const mealKcal = Math.min(open.kcal, t.kcal * (late ? R.lateMealShare : R.maxMealShare));
  const slot: MealSlot = late || ctx.freeSlots.length === 0 ? 'snack' : ctx.freeSlots[0]!;
  const trainingDay = !!ctx.todaysSession || ctx.trainedToday;
  const since = addDays(ctx.date, -30);
  const uses = (id: string) => ctx.state.logEntries.filter((e) => e.dishId === id && e.date >= since).length;

  const best = dishes
    .map((dish) => {
      const perPortion = dishPortionNutrition(dish, 1).macros;
      if (!(perPortion.kcal > 0)) return undefined;
      const portions = DISH_PORTIONS.reduce((a, b) => (Math.abs(perPortion.kcal * b - mealKcal) < Math.abs(perPortion.kcal * a - mealKcal) ? b : a));
      const macros = dishPortionNutrition(dish, portions).macros;
      const kcalError = Math.abs(macros.kcal - mealKcal) / mealKcal;
      const proteinWanted = Math.max(0, open.protein) * (mealKcal / open.kcal);
      const proteinShort = proteinWanted > 0 ? Math.max(0, proteinWanted - macros.protein) / proteinWanted : 0;
      const used = uses(dish.id);
      const score = kcalError + (trainingDay ? R.proteinWeightTraining : R.proteinWeight) * proteinShort * 0.5 - 0.03 * Math.min(used, 5);
      return { dish, portions, macros, kcalError, proteinWanted, used, score };
    })
    .filter((x): x is NonNullable<typeof x> => !!x && x.kcalError <= 0.25 && x.macros.kcal <= open.kcal * 1.1)
    .sort((a, b) => a.score - b.score)[0];
  if (!best) return [];

  const { dish, portions, macros } = best;
  const cost = dishCostRange(dish, portions, priceLookup(ctx.state.products));
  const amount = portions === 1 ? '' : ` (${fmt.servings(portions)})`;
  const because = [
    'dein eigenes Gericht',
    best.used >= 2 ? `in den letzten 30 Tagen ${best.used}× gegessen` : null,
    best.proteinWanted >= 10 && macros.protein >= best.proteinWanted * 0.8 ? `${fmt.g(macros.protein)} Protein – deckt deine offene Menge` : null,
    `${fmt.kcal(macros.kcal)} – passt zu deinen offenen Kalorien`,
  ].filter((b): b is string => !!b);
  return [
    {
      id: `own_dish:${ctx.date}:${dish.id}`,
      kind: 'own_dish',
      domain: 'nutrition',
      priority: 'medium',
      confidence: 'high',
      title: `Dein ${dish.name} passt heute gut`,
      message: `ca. ${fmt.kcal(macros.kcal)} und ${fmt.g(macros.protein)} Protein${amount} – noch ca. ${fmt.kcal(open.kcal)} offen für ${SLOT_LABEL[slot]}.`,
      reasons: [`Gegessen: ${fmt.int(ctx.eaten.kcal)} von ${fmt.kcal(t.kcal)}`],
      facts: { openKcal: Math.round(open.kcal), dishKcal: macros.kcal, dishProtein: Math.round(macros.protein), portions, uses: best.used },
      actions: [
        {
          type: 'log_dish',
          label: `${dish.name} erfassen`,
          date: ctx.date,
          slot,
          dishId: dish.id,
          portions,
          details: { title: `🍽️ ${dish.name}${amount}`, kcal: macros.kcal, protein: Math.round(macros.protein), cost, because },
        },
      ],
    },
  ];
}
