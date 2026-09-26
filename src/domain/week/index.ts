export { applyWeekChange, rebalanceDay, type CascadeResult, type ChangeSummary, type WeekChange } from './cascade';
export { bonusDates, closeCompletedDays, dayShift, dayTargetFor, MAX_BONUS_DAYS, MAX_DAY_SHIFT, shiftTarget, trainingDates, TRAINING_DAY_KCAL } from './dayTargets';
export { addToPantry, entryIngredients, pantryEstimate, purchaseAmount, setPantryQuantity } from './pantry';
export { availablePantry, buildWeekPlan, dayContextFor, DEFAULT_DAY_CONTEXT, openShoppingCount, weekShopping, type PlanDay, type WeekPlan } from './weekPlan';
export { fillWeek, planMeals, plannableDays, weekMeals } from './planning';
export { applyRestock, restockRules, type RestockRule } from './restock';
