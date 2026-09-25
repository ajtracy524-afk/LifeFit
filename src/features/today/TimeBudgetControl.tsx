import { TIME_BUDGET_ORDER, TIME_BUDGETS } from '../../domain/timeBudget';
import type { ISODate, TimeBudget } from '../../domain/types';
import { dayContextFor } from '../../domain/week';
import { applyWithUndo } from '../../lib/undo';
import { useAppState } from '../../store/store';
import { Segmented } from '../../components/ui/Controls';
import styles from './today.module.css';

const HINT: Record<TimeBudget, string> = {
  low: 'Schnelle Gerichte oder Reste · Training ~30 min',
  normal: 'Normale Rezepte und Training',
  high: 'Aufwendigere Rezepte möglich',
};

/**
 * F5: time budget of one day. Changing it runs the week cascade – meals that
 * no longer fit are exchanged, training is shortened, shopping follows – with undo.
 */
export function TimeBudgetControl({ date }: { date: ISODate }) {
  const state = useAppState();
  const value = dayContextFor(state, date).timeBudget;
  return (
    <div className={styles.timeBudget}>
      <Segmented<TimeBudget>
        label="Zeit an diesem Tag"
        value={value}
        onChange={(timeBudget) => timeBudget !== value && applyWithUndo({ type: 'setDayContext', date, context: { timeBudget } })}
        options={TIME_BUDGET_ORDER.map((b) => ({ value: b, label: TIME_BUDGETS[b].label }))}
      />
      <p className={styles.timeHint}>{HINT[value]}</p>
    </div>
  );
}
