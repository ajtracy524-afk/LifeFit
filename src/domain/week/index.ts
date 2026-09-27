export { applyWeekChange, rebalanceDay, type CascadeResult, type ChangeSummary, type WeekChange } from './cascade';
export { bonusDates, bonusKcalByDate, closeCompletedDays, dayShift, dayTargetFor, MAX_BONUS_DAYS, MAX_DAY_SHIFT, shiftTarget, trainingDates, TRAINING_DAY_KCAL, trainingDayBonus } from './dayTargets';
export { addToPantry, entryIngredients, pantryEstimate, purchaseAmount, setPantryQuantity } from './pantry';
export { availablePantry, buildWeekPlan, shoppingCost, weekFoodCost, dayContextFor, DEFAULT_DAY_CONTEXT, openShoppingCount, weekShopping, type PlanDay, type WeekPlan } from './weekPlan';
export { fillWeek, mealAlternatives, planMeals, plannableDays, slotSuggestions, weekMeals, type SlotSuggestions } from './planning';
export { applyRestock, restockRules, type RestockRule } from './restock';
