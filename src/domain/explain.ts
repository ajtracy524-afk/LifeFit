import { getFood } from '../data/foods';
import { getRecipe } from '../data/recipes';
import { MEAL_STYLES } from '../data/tastes';
import { weekdayLong, weekdayShort } from '../lib/format';
import { addDays, weekStart, weekdayIndex } from './dates';
import { affinityIndex, learnedTrainingDays, learnedTrainingHour, LEARNING, preferenceOf, prefKey } from './learning';
import { formatChf, formatCostRange, priceLookup, recipeCostRange, type CostRange } from './costs';
import { plannedMealMacros } from './nutrition';
import { matchingTastes, recipeStyle } from './preferences';
import { effectivePrepMin } from './planner';
import { postWorkoutSlot, preWorkoutSlot, sessionOn, trainingTimeFor } from './schedule';
import { effectiveTimeBudget, LEFTOVER_PREP_MIN, TIME_BUDGETS } from './timeBudget';
import { estimateMinutes } from './training';
import type { AppState, ISODate, PlanPriority, PlannedMeal } from './types';
import { availablePantry, dayContextFor, dayTargetFor, mealPrepEnabled, weekMeals, weekShopping } from './week';

/**
 * "Warum?" – explanations built ONLY from factors the planner really uses
 * (time budget, pantry, shared ingredients, protein, training, learned
 * behaviour). Nothing is invented: if a factor does not apply, it is not said.
 */

/** Pantry-category foods (oil, spices …) are not worth mentioning as "shared". */
const TRIVIAL = new Set(['olive-oil', 'soy-sauce', 'honey']);

export function explainMeal(state: AppState, meal: PlannedMeal, today: ISODate): string[] {
  const recipe = getRecipe(meal.recipeId);
  if (!recipe) return [];
  const reasons: string[] = [];
  if (meal.source === 'user') reasons.push('Von dir gewählt – der Planer lässt diese Mahlzeit fix.');

  // Time budget (F5) and meal-prep leftovers.
  const week = weekMeals(state, meal.date);
  const cooked = new Map<string, ISODate[]>();
  for (const m of week) if (m.id !== meal.id) cooked.set(m.recipeId, [...(cooked.get(m.recipeId) ?? []), m.date]);
  const prep = effectivePrepMin(recipe, meal.date, cooked, mealPrepEnabled(state));
  const budget = effectiveTimeBudget(dayContextFor(state, meal.date));
  if (prep === LEFTOVER_PREP_MIN && recipe.prepMin > LEFTOVER_PREP_MIN) {
    const from = (cooked.get(recipe.id) ?? []).filter((d) => d < meal.date).sort().pop();
    reasons.push(`Rest von ${from ? weekdayLong(weekdayIndex(from)) : 'vorher'} – nur aufwärmen`);
  } else if (budget === 'low' && prep <= TIME_BUDGETS.low.maxPrepMin) {
    reasons.push(`${prep} Min. Zubereitung – passt zu „Wenig Zeit“`);
  } else {
    reasons.push(`${prep} Min. Zubereitung`);
  }

  // Pantry (F2).
  const stock = availablePantry(state, meal.date, today);
  const atHome = recipe.ingredients.filter((i) => (stock[i.foodId] ?? 0) >= i.grams * meal.servings && !TRIVIAL.has(i.foodId));
  if (atHome.length > 0) reasons.push(`${atHome.length} ${atHome.length === 1 ? 'Zutat ist' : 'Zutaten sind'} schon zu Hause`);

  // Shared ingredients this week (F3).
  const mine = new Set(recipe.ingredients.map((i) => i.foodId).filter((f) => !TRIVIAL.has(f)));
  const sharing = week.filter((m) => m.id !== meal.id && getRecipe(m.recipeId)?.ingredients.some((i) => mine.has(i.foodId)));
  if (sharing.length >= 2) reasons.push(`Teilt Zutaten mit ${sharing.length} anderen Gerichten dieser Woche – weniger Einkauf`);

  // Protein and training.
  const macros = plannedMealMacros(meal);
  const target = dayTargetFor(state, meal.date);
  if (target) reasons.push(`${Math.round(macros.protein)} g Protein – ${Math.round((macros.protein / target.protein) * 100)} % deines Tagesziels`);
  const time = trainingTimeFor(state).time;
  if (meal.slot === postWorkoutSlot(state, meal.date) && macros.protein >= 30) reasons.push(`Proteinreich nach deinem Training um ${time}`);
  else if (meal.slot === preWorkoutSlot(state, meal.date)) reasons.push(`Kleine Mahlzeit vor deinem Training um ${time}`);

  // What the user told LifeFit (onboarding / profile) – only if the recipe really matches.
  const np = state.nutritionProfile;
  const favorites = matchingTastes(recipe.id, np?.favorites);
  if (favorites.length) reasons.push(`Passt zu deiner Vorliebe: ${favorites.slice(0, 2).map((t) => t.label).join(', ')}`);
  if (np?.mealStyle && np.mealStyle !== 'balanced' && recipeStyle(recipe) === np.mealStyle) {
    reasons.push(`Passt zu deinem Mahlzeiten-Stil „${MEAL_STYLES.find((s) => s.id === np.mealStyle)!.label}“`);
  }

  // Learned behaviour – only with real, repeated evidence.
  const prefs = state.learning?.preferences ?? {};
  const eaten = prefs[prefKey.recipe(recipe.id)]?.pos ?? 0;
  if (eaten >= 3 && affinityIndex(prefs)(recipe.id, budget) > 0.15) reasons.push(`Isst du gern – schon ${Math.round(eaten)}× gegessen`);
  const oftenEaten = recipe.ingredients
    .map((i) => ({ food: getFood(i.foodId), p: preferenceOf(prefs[prefKey.food(i.foodId)]) }))
    .filter((x) => x.food && x.food.category !== 'pantry' && x.p.confidence >= LEARNING.showFromConfidence && x.p.score > 0.3);
  if (oftenEaten.length) reasons.push(`Enthält, was du oft isst: ${oftenEaten.slice(0, 2).map((x) => x.food!.name).join(', ')}`);
  // Cost only with a real basis (your CHF product prices, or reliable estimates for ≥ 80 % of the weight) – never invented.
  const cost = recipeCostRange(recipe, meal.servings, priceLookup(state.products));
  if (cost) reasons.push(`${formatCostRange(cost)} für diese Mahlzeit`);
  if (recipe.personal) reasons.unshift('Dein eigenes Gericht');

  return reasons;
}

/** "Warum dieser Plan?" for a whole day. */
export function explainDay(state: AppState, date: ISODate, today: ISODate): string[] {
  const reasons: string[] = [];
  const context = dayContextFor(state, date);
  const budget = effectiveTimeBudget(context);
  if (context.mode === 'eating_out') reasons.push('Abendessen auswärts – nicht im Plan');
  if (budget === 'low') reasons.push('Wenig Zeit – schnelle Gerichte oder Reste');
  if (budget === 'high') reasons.push('Viel Zeit – aufwendigere Gerichte möglich');

  const session = sessionOn(state, date);
  if (session && !session.completedWorkoutId) reasons.push(`Training um ${trainingTimeFor(state).time} · ~${estimateMinutes(session.template)} min`);

  const meals = state.plannedMeals.filter((m) => m.date === date && m.status === 'planned');
  const stock = availablePantry(state, date, today);
  const fromPantry = new Set(
    meals.flatMap((m) => getRecipe(m.recipeId)?.ingredients.filter((i) => (stock[i.foodId] ?? 0) > 0 && !TRIVIAL.has(i.foodId)).map((i) => i.foodId) ?? []),
  );
  if (fromPantry.size > 0) reasons.push(`${fromPantry.size} ${fromPantry.size === 1 ? 'Zutat kommt' : 'Zutaten kommen'} aus deinem Vorrat`);

  const tomorrow = addDays(date, 1);
  const needed = weekShopping(state, weekStart(date), today).filter((i) => i.state === 'open' && i.sources.some((s) => s.date >= date && s.date <= tomorrow));
  if (needed.length > 0) reasons.push(`Für heute und morgen fehlen noch ${needed.length} Artikel`);
  return reasons;
}

/** An estimate for the UI: "ca. 12.40 CHF". */
export function formatChfEstimate(chf: number): string {
  return `ca. ${formatChf(chf)}`;
}

/**
 * Honest budget line for a planned week. The planner cannot go below what the
 * recipes, the calorie/protein targets and variety allow – say so instead of
 * pretending the budget was met.
 */
/**
 * The week against the budget – with the SAME number the budget line uses
 * (weekFoodCost: the value of all food of the week, a range). "Passt" only
 * when even the upper end fits; a range across the budget is said as such;
 * without enough prices there is no verdict (never a partial sum).
 */
export function budgetNote(cost: CostRange | undefined, budgetChf: number | undefined, priority: PlanPriority): string | undefined {
  if (budgetChf === undefined) return undefined;
  if (!cost) return `Zu wenig Preisdaten für einen Vergleich mit deinem Budget von ${formatChf(budgetChf)}.`;
  if (cost.highChf <= budgetChf) return `Passt in dein Budget von ${formatChf(budgetChf)}.`;
  if (cost.lowChf <= budgetChf) return `Liegt etwa bei deinem Budget von ${formatChf(budgetChf)} (${formatCostRange(cost)}).`;
  return priority === 'save'
    ? `Über deinem Budget von ${formatChf(budgetChf)} – günstige Rezepte sind schon bevorzugt, Kalorien und Protein haben Vorrang.`
    : `Über deinem Budget von ${formatChf(budgetChf)} – mit dem Schwerpunkt „Sparen“ (Profil) wird die Woche günstiger.`;
}

/**
 * "Was LifeFit über dich gelernt hat" – plain sentences, each backed by
 * counted behaviour with enough confidence. Empty until there is evidence.
 */
export function learnedInsights(state: AppState): string[] {
  const prefs = state.learning?.preferences ?? {};
  const insights: string[] = [];
  const recipes = Object.entries(prefs)
    .filter(([key]) => key.startsWith('recipe:') && !key.includes('@'))
    .map(([key, stat]) => ({ id: key.slice(7), stat, p: preferenceOf(stat) }))
    .filter((x) => x.p.confidence >= LEARNING.showFromConfidence && getRecipe(x.id));
  const liked = recipes.filter((x) => x.p.score > 0.3).sort((a, b) => b.p.score - a.p.score).slice(0, 3);
  const avoided = recipes.filter((x) => x.p.score < -0.3).sort((a, b) => a.p.score - b.p.score).slice(0, 3);
  if (liked.length) insights.push(`Du isst gern: ${liked.map((x) => getRecipe(x.id)!.title).join(', ')}`);
  if (avoided.length) insights.push(`Tauschst oder überspringst du oft: ${avoided.map((x) => getRecipe(x.id)!.title).join(', ')}`);

  // Foods eaten outside the plan (searched, scanned, manual with a known food).
  const foods = Object.entries(prefs)
    .filter(([key]) => key.startsWith('food:'))
    .map(([key, stat]) => ({ food: getFood(key.slice(5)), p: preferenceOf(stat) }))
    .filter((x) => x.food && x.p.confidence >= LEARNING.showFromConfidence && x.p.score > 0.3)
    .sort((a, b) => b.p.evidence - a.p.evidence)
    .slice(0, 3);
  if (foods.length) insights.push(`Isst du oft zusätzlich: ${foods.map((x) => x.food!.name).join(', ')} – Rezepte damit kommen etwas häufiger`);

  const busy = Object.entries(prefs)
    .filter(([key]) => key.endsWith('@low'))
    .map(([key, stat]) => ({ id: key.slice(7, -4), p: preferenceOf(stat) }))
    .filter((x) => x.p.confidence >= LEARNING.showFromConfidence && x.p.score < -0.3 && getRecipe(x.id));
  if (busy.length) insights.push(`An Tagen mit wenig Zeit lässt du eher aus: ${busy.map((x) => getRecipe(x.id)!.title).join(', ')}`);

  const days = learnedTrainingDays(prefs);
  if (days.length) insights.push(`Du trainierst meistens ${days.map((d) => weekdayShort(d)).join(', ')}`);
  const hour = learnedTrainingHour(prefs);
  if (hour !== undefined) insights.push(`Dein Training beginnt meist gegen ${hour} Uhr`);
  return insights;
}
