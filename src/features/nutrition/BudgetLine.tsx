import { useMemo } from 'react';
import { formatCostRange, type CostRange } from '../../domain/costs';
import { weekDays } from '../../domain/dates';
import type { ISODate } from '../../domain/types';
import { weekFoodCost } from '../../domain/week';
import { useAppState } from '../../store/store';
import { useCountUp } from '../../components/ui/CountUp';
import styles from './nutrition.module.css';

interface Props {
  week: ISODate;
  label?: string;
  className?: string;
  /** Heute: also what was eaten so far and what is left (needs a budget). */
  progressUntil?: ISODate;
}

/**
 * "Diese Woche ca. 32–38 CHF von 55 CHF" – the estimated food value of the
 * week against the budget (CHF only), optionally with "bisher gegessen" and
 * "frei". Without enough price data no number is shown: with a budget set it
 * says so ("Preis nicht verfügbar"), otherwise the line stays away. Being over
 * budget is said in words, not only by colour. Never an invented number.
 */
export function BudgetLine({ week, label = 'Diese Woche', className, progressUntil }: Props) {
  const state = useAppState();
  // Only recomputed when plan, log or product prices change – not on every render.
  const cost = useMemo(() => weekFoodCost(state, week), [state.plannedMeals, state.logEntries, state.products, week]);
  const eaten = useMemo(
    () => (progressUntil ? weekFoodCost(state, week, { eatenUntil: progressUntil }) : undefined),
    [state.plannedMeals, state.logEntries, state.products, week, progressUntil],
  );
  const budget = state.plannerSettings.weeklyBudgetChf;
  // Ranges glide to new values like every other number (never below 0, same rounding as formatCostRange).
  const low = useCountUp(cost?.lowChf ?? 0);
  const high = useCountUp(cost?.highChf ?? 0);

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
  const left = budget !== undefined ? remaining(budget, cost) : undefined;
  return (
    <span className={[styles.budgetLine, over && styles.budgetOver, className].filter(Boolean).join(' ')} title="Schätzung aus Durchschnittspreisen und deinen eingegebenen Preisen">
      {label} {formatCostRange({ lowChf: Math.min(low, high), highChf: Math.max(low, high) })}
      {budget !== undefined ? ` von ${budget} CHF` : ''}
      {over ? ' – über Budget' : ''}
      {progressUntil && budget !== undefined && (eaten || left) && (
        <span className={styles.budgetDetail}>
          {[eaten && `bisher gegessen ${formatCostRange(eaten)}`, left && (left.over ? `${formatCostRange(left.range)} über Budget` : `frei ${formatCostRange(left.range)}`)]
            .filter(Boolean)
            .join(' · ')}
        </span>
      )}
    </span>
  );
}

/** Budget minus the cost range – the range flips: a higher cost leaves less. */
function remaining(budget: number, cost: CostRange): { range: CostRange; over: boolean } {
  if (cost.lowChf > budget) return { range: { lowChf: cost.lowChf - budget, highChf: cost.highChf - budget }, over: true };
  return { range: { lowChf: Math.max(0, budget - cost.highChf), highChf: budget - cost.lowChf }, over: false };
}
