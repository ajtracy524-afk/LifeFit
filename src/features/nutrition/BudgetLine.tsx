import { useMemo } from 'react';
import { formatCostRange } from '../../domain/costs';
import type { ISODate } from '../../domain/types';
import { weekFoodCost } from '../../domain/week';
import { useAppState } from '../../store/store';
import styles from './nutrition.module.css';

/**
 * "Diese Woche ca. 32–38 CHF von 55 CHF" – the estimated food value of the week's
 * plan against the budget. Shown only when enough ingredients have a price
 * estimate; otherwise nothing (never an invented number).
 */
export function BudgetLine({ week, label = 'Diese Woche', className }: { week: ISODate; label?: string; className?: string }) {
  const state = useAppState();
  // Only recomputed when plan, log or product prices change – not on every render.
  const cost = useMemo(() => weekFoodCost(state, week), [state.plannedMeals, state.logEntries, state.products, week]);
  if (!cost) return null;
  const budget = state.plannerSettings.weeklyBudgetChf;
  const over = budget !== undefined && cost.lowChf > budget;
  return (
    <span className={[styles.budgetLine, over && styles.budgetOver, className].filter(Boolean).join(' ')} title="Schätzung aus Durchschnittspreisen – keine Supermarktpreise">
      {label} {formatCostRange(cost)}
      {budget !== undefined ? ` von ${budget} CHF` : ''}
    </span>
  );
}
