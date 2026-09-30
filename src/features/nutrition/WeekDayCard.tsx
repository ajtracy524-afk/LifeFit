import { useState } from 'react';
import { formatCostRange } from '../../domain/costs';
import { weekdayIndex } from '../../domain/dates';
import { DAY_MODE_LABEL, DAY_MODE_ORDER, EATING_OUT_SLOTS, TIME_BUDGETS } from '../../domain/timeBudget';
import type { PlannedWorkout } from '../../domain/training';
import { estimateMinutes } from '../../domain/training';
import type { DayMode, MealSlot, PlannedMeal } from '../../domain/types';
import type { DayOverview } from '../../domain/week/dayOverview';
import { closedMeals, type PlanDay } from '../../domain/week';
import { applyWithUndo } from '../../lib/undo';
import { useAppState } from '../../store/store';
import { Segmented } from '../../components/ui/Controls';
import { fmt, SLOT_LABEL, weekdayShort } from '../../lib/format';
import { href } from '../../lib/router';
import { Card } from '../../components/ui/Card';
import { ProgressBar } from '../../components/ui/Progress';
import { Icon } from '../../components/ui/Icon';
import { MealRow } from './MealRow';
import styles from './nutrition.module.css';

const TONE_COLOR = { green: 'var(--tone-good)', orange: 'var(--tone-watch)', red: 'var(--tone-alert)', none: 'var(--text-3)' } as const;

interface Props {
  day: PlanDay;
  overview: DayOverview;
  today: string;
  slots: MealSlot[];
  session?: PlannedWorkout;
  onOpenMeal: (id: string) => void;
  onPick: (target: { date: string; slot: MealSlot }) => void;
}

/**
 * One day of the nutrition week: who the day is (training / rest, time,
 * eating out), how it looks (status, kcal and protein against the day
 * target, eaten count, cost) and its meals. Past days fold to their summary.
 */
export function WeekDayCard({ day, overview: o, today, slots, session, onOpenMeal, onPick }: Props) {
  const past = day.date < today;
  const isToday = day.date === today;
  const [open, setOpen] = useState(!past);
  const context = day.context;
  const label = `${weekdayShort(weekdayIndex(day.date))} ${isToday ? 'Heute' : shortDate(day.date)}`;
  const state = useAppState();
  const closed = closedMeals(state, day.date);
  // Where dinner happens is a planning decision – made here (and in the check-in), shown on Heute.
  const dinnerChoice = !past && slots.some((s) => EATING_OUT_SLOTS.includes(s));

  return (
    <Card padded={false} className={[styles.weekDay, isToday && styles.weekDayToday, past && styles.weekDayPast].filter(Boolean).join(' ')}>
      <header className={styles.weekDayHead}>
        <a href={href('nutrition', { view: 'day', date: day.date })} className={styles.weekDayName} aria-label={`${label}: Tagesansicht öffnen`}>
          <strong>{weekdayShort(weekdayIndex(day.date))}</strong>
          <span>{isToday ? 'Heute' : shortDate(day.date)}</span>
        </a>
        <span className={styles.weekDayStatus} style={{ color: TONE_COLOR[o.status.tone] }}>
          {o.status.text}
        </span>
        {past && (
          <button type="button" className={styles.weekDayToggle} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? `${label} zuklappen` : `${label} aufklappen`}>
            <Icon name="chevronDown" size={18} />
          </button>
        )}
      </header>

      <div className={styles.weekDayTags}>
        {session ? (
          <span className={styles.weekTagTraining}>
            🏋️ {session.template.name} · {session.completedWorkoutId ? 'erledigt ✓' : `~${estimateMinutes(session.template)} min`}{session.status === 'moved' ? ' · verschoben' : ''}
          </span>
        ) : (
          <span className={styles.weekTag}>🌿 Ruhetag</span>
        )}
        {context.timeBudget !== 'normal' && (
          <span className={styles.weekTag}>
            <Icon name="clock" size={12} /> {TIME_BUDGETS[context.timeBudget].label}
          </span>
        )}
        {context.mode !== 'normal' && <span className={styles.weekTag}>🍽️ {DAY_MODE_LABEL[context.mode]} essen</span>}
        {o.meals > 0 && (past || isToday) && (
          <span className={styles.weekTag}>
            {o.eaten} / {o.meals} gegessen
          </span>
        )}
        {o.cost && <span className={styles.weekTag}>{formatCostRange(o.cost)}</span>}
      </div>

      {o.kcalRef !== undefined && (o.meals > 0 || o.kcal > 0) && (
        <div className={styles.weekDayBars}>
          <DayBar label="kcal" value={o.kcal} max={o.kcalRef} tone={o.kcalTone} format={(v) => fmt.int(v)} />
          <DayBar label="Protein" value={o.protein} max={o.proteinRef ?? 0} tone={o.proteinTone} format={(v) => `${fmt.int(v)} g`} />
          {o.carbsRef !== undefined && o.fatRef !== undefined && (
            <p className={styles.weekMacros}>
              KH {fmt.int(o.carbs)} / {fmt.int(o.carbsRef)} g · Fett {fmt.int(o.fat)} / {fmt.int(o.fatRef)} g
            </p>
          )}
        </div>
      )}

      {open && (
        <div className={styles.weekDayMeals}>
          {slots.map((slot) => {
            // A dinner taken out by "Auswärts" is not a meal of the plan – the slot shows its state instead.
            const slotMeals = day.meals.filter((m) => m.slot === slot && m.skippedFor !== 'eating_out');
            const off = closed.find((c) => c.slot === slot);
            if (!slotMeals.length) {
              if (off?.reason === 'eating_out')
                return (
                  <p key={slot} className={styles.closedSlot}>
                    <span aria-hidden>🍽️</span> {SLOT_LABEL[slot]} · Auswärts <span className={styles.muted}>– nicht im Plan, nicht im Einkauf</span>
                  </p>
                );
              if (past) return null;
              return (
                <button key={slot} type="button" className={styles.emptySlot} onClick={() => onPick({ date: day.date, slot })}>
                  <Icon name="plus" size={16} /> {SLOT_LABEL[slot]}
                  {off ? ' · nicht geplant' : ''}
                </button>
              );
            }
            return slotMeals.map((m: PlannedMeal) => <MealRow key={m.id} meal={m} label={SLOT_LABEL[slot]} onOpen={() => onOpenMeal(m.id)} checkable={day.date <= today} />);
          })}
          {dinnerChoice && (
            <div className={styles.dinnerChoice}>
              <span className={styles.dinnerChoiceLabel}>Abendessen</span>
              <Segmented<DayMode>
                label={`Abendessen ${label}`}
                value={context.mode}
                onChange={(mode) => mode !== context.mode && applyWithUndo({ type: 'setDayContext', date: day.date, context: { mode } })}
                options={DAY_MODE_ORDER.map((m) => ({ value: m, label: m === 'eating_out' ? '🍽️ Auswärts' : '🏠 Zuhause' }))}
              />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function DayBar({ label, value, max, tone, format }: { label: string; value: number; max: number; tone: keyof typeof TONE_COLOR; format: (v: number) => string }) {
  return (
    <div className={styles.weekBar}>
      <span className={styles.weekBarText}>
        <span>{label}</span>
        <strong>
          {format(value)} <span>/ {format(max)}</span>
        </strong>
      </span>
      <ProgressBar value={value} max={max} height={5} color={TONE_COLOR[tone]} label={label} />
    </div>
  );
}

function shortDate(d: string): string {
  const [, m, day] = d.split('-');
  return `${Number(day)}.${Number(m)}.`;
}
