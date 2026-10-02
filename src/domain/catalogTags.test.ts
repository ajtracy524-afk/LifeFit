import { describe, expect, it } from 'vitest';
import { getFood } from '../data/foods';
import { getRecipe } from '../data/recipes';
import { emptyState } from '../store/persistence';
import {
  dietOf,
  fitsDiet,
  foodGroups,
  isExcluded,
  hardExclusionsOf,
  swapContextOf,
  recipeAllowedBy,
  recipeLabels,
  recipeTags,
  substituteFood,
  usableFood,
} from './catalogTags';
import { recipeAllowed } from './nutrition';
import { buildShoppingList } from './shopping';
import type { AppState, Food, NutritionProfile, PlannedMeal } from './types';
import { applyStaples } from './week/restock';
import { weekShopping } from './week';

const food = (id: string) => getFood(id)!;
const recipe = (id: string) => getRecipe(id)!;

describe('diet from animal kinds', () => {
  it('derives the strictest diet a food or recipe fits', () => {
    expect(dietOf([])).toBe('vegan');
    expect(dietOf(['honey'])).toBe('vegetarian');
    expect(dietOf(['milk', 'fish'])).toBe('pescatarian');
    expect(dietOf(['fish', 'meat'])).toBe('omnivore');
    expect(fitsDiet(['fish'], 'pescatarian')).toBe(true);
    expect(fitsDiet(['fish'], 'vegetarian')).toBe(false);
    expect(fitsDiet(['egg'], 'pescatarian')).toBe(true);
    expect(recipeTags(recipe('tuna-pasta-salad')).diet).toBe('pescatarian');
    expect(recipeTags(recipe('chili')).diet).toBe('omnivore');
    expect(recipeTags(recipe('lentil-dal')).diet).toBe('vegan');
  });

  it('derives allergens, traces, intolerances and alcohol of a recipe from its ingredients', () => {
    const dal = recipeTags(recipe('lentil-dal'));
    expect(dal.allergens.sort()).toEqual(['celery', 'mustard']); // hidden in the curry powder (E23)
    expect(dal.celiac).toEqual(['lentils']); // contamination risk
    const bowl = recipeTags(recipe('chicken-rice-bowl'));
    expect(bowl.alcohol).toBe('fermentation'); // soy sauce (E17)
    expect(bowl.allergens.sort()).toEqual(['gluten', 'soy']);
    const oats = recipeTags(recipe('overnight-oats'));
    expect(oats.lactose.sort()).toEqual(['milk', 'whey']);
    expect(oats.fructose).toEqual(['honey']);
    expect(recipeTags(recipe('apple-pb')).traces).toEqual(['tree_nuts']);
  });
});

describe('hard exclusions (the filter of Prompt 4)', () => {
  it('traces are excluded by default and allowed per allergen (E15)', () => {
    expect(isExcluded(food('peanut-butter'), { allergens: ['tree_nuts'] })).toBe(true);
    expect(isExcluded(food('peanut-butter'), { allergens: ['tree_nuts'], tracesOk: ['tree_nuts'] })).toBe(false);
    expect(isExcluded(food('peanut-butter'), { allergens: ['peanuts'], tracesOk: ['peanuts'] })).toBe(true); // an ingredient, not a trace
    expect(isExcluded(food('toast'), { allergens: ['sesame'] })).toBe(true);
  });

  it('coeliac disease is stricter than a gluten allergy: contamination risks and traces count', () => {
    expect(isExcluded(food('quinoa'), { allergens: ['gluten'] })).toBe(false);
    expect(isExcluded(food('quinoa'), { intolerances: ['celiac'] })).toBe(true);
    expect(isExcluded(food('rice'), { intolerances: ['celiac'] })).toBe(false);
  });

  it('alcohol excludes fermentation too, unless the user says it is okay (E17)', () => {
    expect(isExcluded(food('soy-sauce'), { alcohol: true })).toBe(true);
    expect(isExcluded(food('soy-sauce'), { alcohol: true, fermentationAlcoholOk: true })).toBe(false);
    const wine = { ...food('vinegar'), id: 'wine', tags: { ...food('vinegar').tags!, alcohol: 'added' as const } };
    expect(isExcluded(wine, { alcohol: true, fermentationAlcoholOk: true })).toBe(true);
  });

  it('pork and diets', () => {
    const ham: Food = { ...food('chicken'), id: 'ham', tags: { allergens: [], kinds: ['meat', 'pork'] } };
    expect(isExcluded(ham, { pork: true })).toBe(true);
    expect(isExcluded(food('chicken'), { pork: true })).toBe(false);
    expect(isExcluded(food('salmon'), { diet: 'pescatarian' })).toBe(false);
    expect(isExcluded(food('chicken'), { diet: 'pescatarian' })).toBe(true);
    expect(isExcluded(food('honey'), { diet: 'vegan' })).toBe(true);
  });

  it('fructose intolerance and ripened cheese with little lactose (E20)', () => {
    expect(isExcluded(food('apple'), { intolerances: ['fructose'] })).toBe(true);
    expect(isExcluded(food('protein-bar'), { intolerances: ['fructose'] })).toBe(true);
    // Every food with lactose "low" stays allowed – the rule for any ripened hard cheese.
    expect(isExcluded(food('gouda'), { intolerances: ['lactose'] })).toBe(false);
    expect(isExcluded(food('feta'), { intolerances: ['lactose'] })).toBe(true);
  });
});

describe('swap instead of exclude (E20)', () => {
  it('lactose intolerance swaps milk, quark, skyr and Greek yogurt – a milk allergy never', () => {
    expect(substituteFood('milk', { lactoseIntolerant: true, milkAllergy: false })).toBe('milk-lf');
    expect(substituteFood('greek-yogurt', { lactoseIntolerant: true, milkAllergy: false })).toBe('greek-yogurt-lf');
    expect(substituteFood('milk', { lactoseIntolerant: true, milkAllergy: true })).toBe('milk');
    expect(substituteFood('milk', { lactoseIntolerant: false, milkAllergy: false })).toBe('milk');
    expect(substituteFood('feta', { lactoseIntolerant: true, milkAllergy: false })).toBe('feta'); // no variant
  });

  it('the usable food of an ingredient: itself, its variant, or none', () => {
    expect(usableFood('milk', {})).toBe('milk');
    expect(usableFood('milk', { intolerances: ['lactose'] })).toBe('milk-lf');
    expect(usableFood('milk', { intolerances: ['lactose'], allergens: ['milk'] })).toBeUndefined();
    expect(usableFood('whey', { intolerances: ['lactose'] })).toBeUndefined(); // no lactose-free variant
  });

  it('recipes with these ingredients stay allowed with lactose intolerance', () => {
    expect(recipeAllowedBy(recipe('protein-pancakes'), { intolerances: ['lactose'] })).toBe(true); // quark → quark-lf
    expect(recipeAllowedBy(recipe('protein-pancakes'), { intolerances: ['lactose'], allergens: ['milk'] })).toBe(false);
    expect(recipeAllowedBy(recipe('overnight-oats'), { intolerances: ['lactose'] })).toBe(false); // whey
    // The old profile ("Laktose") is the intolerance and gets the same swap (E5).
    const old: NutritionProfile = { diet: 'omnivore', excluded: ['lactose'], slots: ['breakfast', 'lunch', 'dinner'] };
    expect(swapContextOf(hardExclusionsOf(old))).toEqual({ lactoseIntolerant: true, milkAllergy: false });
    expect(recipeAllowed(recipe('protein-pancakes'), old)).toBe(true);
    expect(recipeAllowed(recipe('overnight-oats'), old)).toBe(false);
    expect(recipeAllowed(recipe('protein-pancakes'), { ...old, diet: 'vegan' })).toBe(false); // the diet still wins
  });

  it('the shopping list buys the variant – pantry and plan keep the original', () => {
    const meal: PlannedMeal = { id: 'm', date: '2026-10-05', slot: 'breakfast', recipeId: 'protein-pancakes', servings: 1, status: 'planned', source: 'suggest' };
    const items = buildShoppingList([meal], '2026-10-05', '2026-10-11', (id) => substituteFood(id, { lactoseIntolerant: true, milkAllergy: false }));
    const quark = items.find((i) => i.foodId === 'quark')!;
    expect(quark).toMatchObject({ buyFoodId: 'quark-lf', name: 'Magerquark laktosefrei', grams: 150 });
    expect(items.find((i) => i.foodId === 'egg')!.buyFoodId).toBeUndefined();

    const state: AppState = {
      ...emptyState(),
      nutritionProfile: { diet: 'omnivore', excluded: ['lactose'], slots: ['breakfast', 'lunch', 'dinner'] },
      plannedMeals: [meal],
    };
    const list = weekShopping(state, '2026-10-05', '2026-10-05');
    expect(list.find((i) => i.foodId === 'quark')).toMatchObject({ name: 'Magerquark laktosefrei', state: 'open' });
    expect(weekShopping({ ...state, nutritionProfile: { ...state.nutritionProfile!, excluded: [] } }, '2026-10-05', '2026-10-05').find((i) => i.foodId === 'quark')!.name).toBe('Magerquark');
  });
});

describe('staples on the shopping list (E19)', () => {
  const meal: PlannedMeal = { id: 'm', date: '2026-10-05', slot: 'snack', recipeId: 'edamame-snack', servings: 1, status: 'planned', source: 'suggest' };
  const at = '2026-10-01T08:00:00Z';
  const listWith = (pantry: AppState['pantry'], purchased: Record<string, number> = {}) => {
    const items = buildShoppingList([meal], '2026-10-05', '2026-10-11').map((i) => ({ ...i, state: 'open' as const, neededG: i.grams, remainingG: i.grams }));
    const available = Object.fromEntries(Object.values(pantry).map((p) => [p.foodId, p.quantityG]));
    return applyStaples(items, pantry, available, purchased);
  };

  it('salt is an ingredient but no purchase while it is at home', () => {
    expect(recipe('edamame-snack').ingredients.map((i) => i.foodId)).toContain('salt');
    expect(listWith({}).map((i) => i.foodId)).toEqual(['edamame']); // unknown → assumed at home
    expect(listWith({ salt: { foodId: 'salt', quantityG: 300, updatedAt: at } }).map((i) => i.foodId)).toEqual(['edamame']);
  });

  it('marked empty → one package on the list, also without a planned meal; bought → done', () => {
    const empty = listWith({ salt: { foodId: 'salt', quantityG: 0, updatedAt: at }, pepper: { foodId: 'pepper', quantityG: 0, updatedAt: at } });
    expect(empty.find((i) => i.foodId === 'salt')).toMatchObject({ state: 'open', remainingG: 500 });
    expect(empty.find((i) => i.foodId === 'pepper')).toMatchObject({ state: 'open', remainingG: 50, neededG: 0 });
    const bought = listWith({ salt: { foodId: 'salt', quantityG: 0, updatedAt: at } }, { salt: 500 });
    expect(bought.find((i) => i.foodId === 'salt')!.state).toBe('checked');
  });
});

describe('display', () => {
  it('preference groups: reviewed override, computed otherwise, none for condiments (E16)', () => {
    expect(foodGroups(food('broccoli'))).toEqual(['veg']);
    expect(foodGroups(food('kidney'))).toEqual(['protein', 'carbs']);
    expect(foodGroups(food('chicken'))).toEqual(['protein']); // computed
    expect(foodGroups(food('avocado'))).toEqual(['fat']); // computed
    expect(foodGroups(food('soy-sauce'))).toEqual([]);
  });

  it('recipe chips come from the typed facts', () => {
    expect(recipeLabels(recipe('chili'))).toEqual(['Meal Prep', 'To go', 'High Protein']);
    expect(recipeLabels(recipe('skyr-bowl'))).toEqual(['To go · Kühlung nötig', 'Schnell', 'High Protein']);
    expect(recipeLabels(recipe('veggie-omelette'))).toEqual(['Vegetarisch']);
  });
});
