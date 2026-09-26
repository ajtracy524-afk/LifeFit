import { DAY_MODE_LABEL, DAY_MODE_ORDER, TIME_BUDGET_ORDER, TIME_BUDGETS } from '../../domain/timeBudget';
import type { DayMode, ISODate, TimeBudget } from '../../domain/types';
import { dayContextFor } from '../../domain/week';
import { applyWithUndo } from '../../lib/undo';
import { useAppState } from '../../store/store';
import { Segmented } from '../../components/ui/Controls';
import styles from './today.module.css';

const HINT: Record<TimeBudget, string> = {
  low: `Nur schnelle Gerichte (bis ${TIME_BUDGETS.low.maxPrepMin} min) oder Reste · Training ~${TIME_BUDGETS.low.trainingMin} min`,
  normal: 'Normale Rezepte und Training',
  high: 'Auch aufwendigere Rezepte',
};

const MODE_HINT: Record<DayMode, string> = {
  normal: 'Abendessen wird geplant und eingekauft',
  eating_out: 'Abendessen auswärts – nicht im Plan, nicht auf der Einkaufsliste. Erfasse einfach, was du isst.',
};

/**
 * F5: the day in two independent questions – "Wie viel Zeit hast du?" (cooking
 * and training) and "Wo isst du zu Abend?". Each change runs the week cascade
 * (meals that no longer fit are exchanged, training is shortened, shopping
 * follows) with undo; eaten, past and own meals stay protected there.
 */
export function TimeBudgetControl({ date, withMode = false }: { date: ISODate; withMode?: boolean }) {
  const state = useAppState();
  const context = dayContextFor(state, date);
  const value = context.timeBudget;
  return (
    <div className={styles.timeBudget}>
      <div className={styles.dayQuestion}>
        <span className={styles.dayQuestionLabel}>Zeit zum Kochen</span>
        <Segmented<TimeBudget>
          label="Zeit zum Kochen"
          value={value}
          onChange={(timeBudget) => timeBudget !== value && applyWithUndo({ type: 'setDayContext', date, context: { timeBudget } })}
          options={TIME_BUDGET_ORDER.map((b) => ({ value: b, label: TIME_BUDGETS[b].label }))}
        />
        <p className={styles.timeHint}>{HINT[value]}</p>
      </div>
      {withMode && (
        <div className={styles.dayQuestion}>
          <span className={styles.dayQuestionLabel}>Abendessen</span>
          <Segmented<DayMode>
            label="Abendessen"
            value={context.mode}
            onChange={(mode) => mode !== context.mode && applyWithUndo({ type: 'setDayContext', date, context: { mode } })}
            options={DAY_MODE_ORDER.map((m) => ({ value: m, label: DAY_MODE_LABEL[m] }))}
          />
          <p className={styles.timeHint}>{MODE_HINT[context.mode]}</p>
        </div>
      )}
    </div>
  );
}
