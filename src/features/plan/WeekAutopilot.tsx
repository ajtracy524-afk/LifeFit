import { useMemo, useState } from 'react';
import { getProgram } from '../../data/exercises';
import { isoWeekNumber, today as todayISO, weekDays, weekdayIndex } from '../../domain/dates';
import { DAY_MODE_LABEL, DAY_MODE_ORDER, TIME_BUDGET_ORDER, TIME_BUDGETS } from '../../domain/timeBudget';
import { estimateMinutes, trainingWeekdays } from '../../domain/training';
import type { DayContext, DayMode, ISODate, TimeBudget } from '../../domain/types';
import { applyWeekChange, buildWeekPlan, dayContextFor, shoppingCost, type WeekChange } from '../../domain/week';
import { budgetNote, formatEur } from '../../domain/explain';
import { learnedTrainingDays } from '../../domain/learning';
import { weekdayShort } from '../../lib/format';
import { applyWithUndo } from '../../lib/undo';
import { useAppState } from '../../store/store';
import { Button } from '../../components/ui/Button';
import { Segmented, WeekdayPicker } from '../../components/ui/Controls';
import { Sheet } from '../../components/ui/Sheet';
import styles from './plan.module.css';

const STEPS = ['Training', 'Zeit', 'Ausnahmen', 'Vorschau'] as const;

interface Props {
  /** Week (Monday) to plan; `null` closes the sheet. */
  week: ISODate | null;
  onClose: () => void;
  /** Called after the week was created. */
  onDone: (week: ISODate) => void;
}

/**
 * F1 weekly check-in. Only asks what the plan needs; everything else comes
 * from the profile. The result is ONE cascade change (planWeek) – training,
 * meals, day targets and shopping are derived from it, undo included.
 */
export function WeekAutopilot({ week, onClose, onDone }: Props) {
  return (
    <Sheet open={!!week} onClose={onClose} title="Woche planen" subtitle={week ? `KW ${isoWeekNumber(week)}` : undefined}>
      {week && <CheckIn key={week} week={week} onDone={onDone} />}
    </Sheet>
  );
}

function CheckIn({ week, onDone }: { week: ISODate; onDone: (week: ISODate) => void }) {
  const state = useAppState();
  const t = todayISO();
  const dates = weekDays(week);
  const open = dates.filter((d) => d >= t);

  const [step, setStep] = useState(0);
  const [trainingDays, setTrainingDays] = useState<number[]>(() => (state.training ? trainingWeekdays(state.training, week) : []));
  const [days, setDays] = useState<Record<ISODate, DayContext>>(() => Object.fromEntries(open.map((d) => [d, dayContextFor(state, d)])));

  const setDay = (date: ISODate, patch: Partial<DayContext>) => setDays((prev) => ({ ...prev, [date]: { ...prev[date]!, ...patch } }));
  const change: WeekChange = { type: 'planWeek', week, trainingDays, days };

  // Preview = the real cascade on a copy; nothing is stored until "Woche erstellen".
  const preview = useMemo(() => {
    if (step !== 3) return null;
    const result = applyWeekChange(state, { type: 'planWeek', week, trainingDays, days }, new Date());
    if (!result.ok) return { error: result.reason } as const;
    const plan = buildWeekPlan(result.state, week, t);
    return { plan, toBuy: plan.shopping.filter((i) => i.state === 'open').length, costEur: shoppingCost(plan.shopping).totalEur } as const;
  }, [step, state, week, trainingDays, days, t]);

  const create = () => {
    if (applyWithUndo(change)) onDone(week);
  };

  const program = state.training ? getProgram(state.training.programId) : undefined;
  // Personalization: suggest the days the user actually trains on (only with enough evidence).
  const learnedDays = learnedTrainingDays(state.learning.preferences).filter((d) => dates[d]! >= t);
  const budget = state.plannerSettings.weeklyBudgetEur;
  const isCurrentWeek = dates[0]! < t;
  const note = preview && !('error' in preview) ? budgetNote(preview.costEur, budget, state.plannerSettings.priority) : undefined;

  return (
    <div className={styles.checkin}>
      <ol className={styles.steps} aria-label="Schritte">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? styles.stepActive : i < step ? styles.stepDone : styles.step}>
            {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section className={styles.section}>
          <h3 className={styles.question}>An welchen Tagen kannst du trainieren?</h3>
          <WeekdayPicker value={trainingDays} onChange={setTrainingDays} />
          {learnedDays.length > 0 && learnedDays.join() !== [...trainingDays].sort().join() && (
            <button type="button" className={styles.suggest} onClick={() => setTrainingDays(learnedDays)}>
              Meistens trainierst du {learnedDays.map((d) => weekdayShort(d)).join(', ')} – übernehmen
            </button>
          )}
          <p className={styles.muted}>
            {program ? `${program.name} · ` : ''}
            {trainingDays.length} {trainingDays.length === 1 ? 'Tag' : 'Tage'}
            {isCurrentWeek ? ' · vergangene Tage bleiben, wie sie waren' : ''}
          </p>
        </section>
      )}

      {step === 1 && (
        <section className={styles.section}>
          <h3 className={styles.question}>Wie viel Zeit hast du an welchem Tag?</h3>
          {open.map((d) => (
            <div key={d} className={styles.dayRow}>
              <span className={styles.dayLabel}>{dayLabel(d)}</span>
              <Segmented<TimeBudget>
                label={`Zeit ${dayLabel(d)}`}
                value={days[d]!.timeBudget}
                onChange={(timeBudget) => setDay(d, { timeBudget })}
                options={TIME_BUDGET_ORDER.map((b) => ({ value: b, label: TIME_BUDGETS[b].label }))}
              />
            </div>
          ))}
        </section>
      )}

      {step === 2 && (
        <section className={styles.section}>
          <h3 className={styles.question}>Gibt es Ausnahmen?</h3>
          <p className={styles.muted}>Auswärts: Abendessen entfällt im Plan · Busy/Reise: schnelle Gerichte, kürzeres Training</p>
          {open.map((d) => (
            <div key={d} className={styles.dayRow}>
              <span className={styles.dayLabel}>{dayLabel(d)}</span>
              <Segmented<DayMode>
                label={`Ausnahme ${dayLabel(d)}`}
                value={days[d]!.mode}
                onChange={(mode) => setDay(d, { mode })}
                options={DAY_MODE_ORDER.map((m) => ({ value: m, label: DAY_MODE_LABEL[m] }))}
              />
            </div>
          ))}
        </section>
      )}

      {step === 3 && preview && (
        <section className={styles.section} aria-live="polite">
          {'error' in preview ? (
            <p className={styles.error} role="alert">
              {preview.error}
            </p>
          ) : (
            <>
              <h3 className={styles.previewTitle}>Training</h3>
              <ul className={styles.previewList}>
                {preview.plan.days.map((day) => (
                  <li key={day.date}>
                    <span>{weekdayShort(weekdayIndex(day.date))}</span>
                    <span>{day.workout ? `${day.workout.template.name} · ~${estimateMinutes(day.workout.template)} min` : 'frei'}</span>
                  </li>
                ))}
              </ul>
              <h3 className={styles.previewTitle}>Essen</h3>
              <ul className={styles.previewList}>
                {preview.plan.days
                  .filter((day) => day.date >= t)
                  .map((day) => {
                    const planned = day.meals.filter((m) => m.status !== 'skipped').length;
                    const mode = day.context.mode;
                    return (
                      <li key={day.date}>
                        <span>{weekdayShort(weekdayIndex(day.date))}</span>
                        <span>
                          {planned} {planned === 1 ? 'Mahlzeit' : 'Mahlzeiten'}
                          {mode !== 'normal' ? ` · ${DAY_MODE_LABEL[mode]}` : ''}
                          {day.context.timeBudget !== 'normal' && mode === 'normal' ? ` · ${TIME_BUDGETS[day.context.timeBudget].label}` : ''}
                        </span>
                      </li>
                    );
                  })}
              </ul>
              <h3 className={styles.previewTitle}>Einkauf</h3>
              <p className={styles.muted}>
                {preview.toBuy === 0 ? 'Alles ist schon da.' : `${preview.toBuy} Artikel – Vorrat ist schon abgezogen.`}
                {preview.costEur > 0 ? ` ${formatEur(preview.costEur)} geschätzt.` : ''}
              </p>
              {note && <p className={styles.muted}>{note}</p>}
            </>
          )}
        </section>
      )}

      <div className={styles.actions}>
        {step > 0 && (
          <Button variant="secondary" onClick={() => setStep(step - 1)}>
            Zurück
          </Button>
        )}
        {step < 3 ? (
          <Button onClick={() => setStep(step + 1)} className={styles.primary}>
            Weiter
          </Button>
        ) : (
          <Button icon="sparkle" onClick={create} disabled={!preview || 'error' in preview} className={styles.primary}>
            Woche erstellen
          </Button>
        )}
      </div>
    </div>
  );
}

function dayLabel(date: ISODate): string {
  return `${weekdayShort(weekdayIndex(date))} ${Number(date.slice(8))}.`;
}
