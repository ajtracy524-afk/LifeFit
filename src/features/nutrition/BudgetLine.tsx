import { formatCostRange } from '../../domain/costs';
import type { ISODate } from '../../domain/types';
import { weekFoodCost } from '../../domain/week';
import { useAppState } from '../../store/store';
import styles from './nutrition.module.css';

/**
 * "Diese Woche ca. 30–36 € von 55 €" – the estimated food value of the week's
 * plan against the budget. Shown only when enough ingredients have a price
 * estimate; otherwise nothing (never an invented number).
 */
export function BudgetLine({ week, label = 'Diese Woche', className }: { week: ISODate; label?: string; className?: string }) {
  const state = useAppState();
  const cost = weekFoodCost(state, week);
  if (!cost) return null;
  const budget = state.plannerSettings.weeklyBudgetEur;
  const over = budget !== undefined && cost.lowEur > budget;
  return (
    <span className={[styles.budgetLine, over && styles.budgetOver, className].filter(Boolean).join(' ')} title="Schätzung aus Durchschnittspreisen – keine Supermarktpreise">
      {label} {formatCostRange(cost)}
      {budget !== undefined ? ` von ${budget} €` : ''}
    </span>
  );
}
