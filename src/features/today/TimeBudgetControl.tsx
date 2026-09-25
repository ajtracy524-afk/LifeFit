import { DAY_MODE_LABEL, DAY_MODE_ORDER, TIME_BUDGET_ORDER, TIME_BUDGETS } from '../../domain/timeBudget';
import type { DayMode, ISODate, TimeBudget } from '../../domain/types';
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
export function TimeBudgetControl({ date, withMode = false }: { date: ISODate; withMode?: boolean }) {
  const state = useAppState();
  const context = dayContextFor(state, date);
  const value = context.timeBudget;
  return (
    <div className={styles.timeBudget}>
      <Segmented<TimeBudget>
        label="Zeit an diesem Tag"
        value={value}
        onChange={(timeBudget) => timeBudget !== value && applyWithUndo({ type: 'setDayContext', date, context: { timeBudget } })}
        options={TIME_BUDGET_ORDER.map((b) => ({ value: b, label: TIME_BUDGETS[b].label }))}
      />
      <p className={styles.timeHint}>{MODE_HINT[context.mode] ?? HINT[value]}</p>
      {withMode && (
        <Segmented<DayMode>
          label="Ausnahme an diesem Tag"
          value={context.mode}
          onChange={(mode) => mode !== context.mode && applyWithUndo({ type: 'setDayContext', date, context: { mode } })}
          options={DAY_MODE_ORDER.map((m) => ({ value: m, label: DAY_MODE_LABEL[m] }))}
        />
      )}
    </div>
  );
}

/** Busy/Reise override the time budget, "Auswärts" changes the meals – say so. */
const MODE_HINT: Partial<Record<DayMode, string>> = {
  eating_out: 'Abendessen auswärts – nicht im Plan und nicht auf der Einkaufsliste',
  busy: 'Busy: schnelle Gerichte · Training ~30 min',
  travel: 'Unterwegs: schnelle Gerichte · Training ~30 min',
};
