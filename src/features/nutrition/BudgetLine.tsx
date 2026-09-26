import { useMemo } from 'react';
import { formatCostRange } from '../../domain/costs';
import { weekDays } from '../../domain/dates';
import type { ISODate } from '../../domain/types';
import { weekFoodCost } from '../../domain/week';
import { useAppState } from '../../store/store';
import styles from './nutrition.module.css';

/**
 * "Diese Woche ca. 32–38 CHF von 55 CHF" – the estimated food value of the week's
 * plan against the budget (CHF only). Without enough price data no number is
 * shown: with a budget set it says so ("Preis nicht verfügbar"), otherwise the
 * line stays away. Never an invented number, never "0 CHF".
 */
export function BudgetLine({ week, label = 'Diese Woche', className }: { week: ISODate; label?: string; className?: string }) {
  const state = useAppState();
  // Only recomputed when plan, log or product prices change – not on every render.
  const cost = useMemo(() => weekFoodCost(state, week), [state.plannedMeals, state.logEntries, state.products, week]);
  const budget = state.plannerSettings.weeklyBudgetChf;
  if (!cost) {
    const days = weekDays(week);
    const hasFood = state.plannedMeals.some((m) => m.date >= days[0]! && m.date <= days[6]! && m.status !== 'skipped');
    if (budget === undefined || !hasFood) return null;
    return (
      <span className={[styles.budgetLine, className].filter(Boolean).join(' ')}>
        {label}: Preis nicht verfügbar – zu wenig Preisdaten · Budget {budget} CHF
      </span>
    );
  }
  const over = budget !== undefined && cost.lowChf > budget;
  return (
    <span className={[styles.budgetLine, over && styles.budgetOver, className].filter(Boolean).join(' ')} title="Schätzung aus Durchschnittspreisen – keine Supermarktpreise">
      {label} {formatCostRange(cost)}
      {budget !== undefined ? ` von ${budget} CHF` : ''}
    </span>
  );
}
