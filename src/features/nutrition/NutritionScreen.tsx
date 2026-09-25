import { useMemo, useState } from 'react';
import { addDays, isoWeekNumber, today, weekDays, weekStart, weekdayIndex } from '../../domain/dates';
import { dayTotals, plannedMealMacros, sumMacros } from '../../domain/nutrition';
import { SLOT_ORDER, slotShare } from '../../domain/planner';
import { activeWorkouts, estimateMinutes } from '../../domain/training';
import { DAY_MODE_LABEL, excludedSlots, TIME_BUDGETS } from '../../domain/timeBudget';
import { dayContextFor, dayTargetFor, weekShopping } from '../../domain/week';
import type { ISODate, LogEntry, MealSlot, PlannedMeal } from '../../domain/types';
import { fmt, formatDateLong, relativeDay, SLOT_LABEL, weekdayShort } from '../../lib/format';
import { href, navigate, useRoute } from '../../lib/router';
import { withUndo } from '../../lib/undo';
import { removeLogEntry } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Screen } from '../../components/Screen';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, LinkCard } from '../../components/ui/Card';
import { Segmented } from '../../components/ui/Controls';
import { EmptyState } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { MacroRow } from '../../components/ui/Progress';
import { LogFoodSheet, type LogTarget } from './LogFoodSheet';
import { MealRow } from './MealRow';
import { MealSheet } from './MealSheet';
import { RecipePicker, type PickerTarget } from './RecipePicker';
import { CoachCard } from '../today/CoachCard';
import { TimeBudgetControl } from '../today/TimeBudgetControl';
import { WeekAutopilot } from '../plan/WeekAutopilot';
import styles from './nutrition.module.css';

type View = 'day' | 'week';

export function NutritionScreen() {
  const { params } = useRoute();
  const view: View = params.get('view') === 'week' ? 'week' : 'day';
  const date = params.get('date') ?? today();

  const [openMeal, setOpenMeal] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [logTarget, setLogTarget] = useState<LogTarget | null>(null);

  const setView = (v: View) => navigate('nutrition', { view: v, date: params.get('date') ?? undefined }, { replace: true });

  return (
    <Screen
      title="Ernährung"
      toolbar={
        <Segmented
          label="Ansicht"
          value={view}
          onChange={setView}
          options={[
            { value: 'day', label: 'Tag' },
            { value: 'week', label: 'Wochenplan' },
          ]}
        />
      }
    >
      {view === 'day' ? (
        <DayView date={date} onOpenMeal={setOpenMeal} onPick={setPicker} onLog={setLogTarget} />
      ) : (
        <WeekView start={weekStart(date)} onOpenMeal={setOpenMeal} onPick={setPicker} />
      )}

      <MealSheet mealId={openMeal} onClose={() => setOpenMeal(null)} onLogInstead={(m) => setLogTarget({ date: m.date, slot: m.slot })} />
      <RecipePicker target={picker} onClose={() => setPicker(null)} />
      <LogFoodSheet target={logTarget} onClose={() => setLogTarget(null)} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Day
// ---------------------------------------------------------------------------

interface DayViewProps {
  date: ISODate;
  onOpenMeal: (id: string) => void;
  onPick: (t: PickerTarget) => void;
  onLog: (t: LogTarget) => void;
}

function DayView({ date, onOpenMeal, onPick, onLog }: DayViewProps) {
  const state = useAppState();
  const target = dayTargetFor(state, date);
  const totals = dayTotals(state.logEntries, date);
  const meals = state.plannedMeals.filter((m) => m.date === date);
  const extras = state.logEntries.filter((e) => e.date === date && !e.plannedMealId);
  const profileSlots = state.nutritionProfile?.slots ?? SLOT_ORDER;
  const slots = SLOT_ORDER.filter((s) => profileSlots.includes(s) || meals.some((m) => m.slot === s) || extras.some((e) => e.slot === s));
  const isFuture = date > today();

  const go = (d: ISODate) => navigate('nutrition', { view: 'day', date: d === today() ? undefined : d }, { replace: true });

  return (
    <>
      <div className={styles.dateSwitch}>
        <IconButton icon="chevronLeft" label="Vorheriger Tag" onClick={() => go(addDays(date, -1))} />
        <div className={styles.dateLabel}>
          <strong>{relativeDay(date)}</strong>
          <span>{formatDateLong(date)}</span>
        </div>
        <IconButton icon="chevronRight" label="Nächster Tag" onClick={() => go(addDays(date, 1))} />
      </div>

      {date >= today() && (
        <Card>
          <TimeBudgetControl date={date} withMode />
        </Card>
      )}

      {target && (
        <Card>
          <div className={styles.dayTotals}>
            <div>
              <span className={styles.bigNumber}>{fmt.int(totals.kcal)}</span>
              <span className={styles.muted}> / {fmt.kcal(target.kcal)}</span>
            </div>
            <span className={styles.remaining}>
              {totals.kcal <= target.kcal ? `${fmt.int(target.kcal - totals.kcal)} übrig` : `+${fmt.int(totals.kcal - target.kcal)} kcal`}
            </span>
          </div>
          <div className={styles.macroStack}>
            <MacroRow label="Protein" value={totals.protein} target={target.protein} />
            <MacroRow label="Kohlenhydrate" value={totals.carbs} target={target.carbs} color="var(--carbs)" />
            <MacroRow label="Fett" value={totals.fat} target={target.fat} color="var(--fat)" />
          </div>
        </Card>
      )}

      {/* Plan suggestions for today – each one is a plan change (cascade), no tips. */}
      {date === today() && <CoachCard domains={['nutrition', 'shopping', 'body']} title="Vorschläge für deinen Plan" />}

      {slots.map((slot) => {
        const slotMeals = meals.filter((m) => m.slot === slot);
        const slotExtras = extras.filter((e) => e.slot === slot);
        const kcal =
          slotMeals.filter((m) => m.status === 'eaten').reduce((s, m) => s + plannedMealMacros(m).kcal, 0) +
          slotExtras.reduce((s, e) => s + e.macros.kcal, 0);
        return (
          <Card key={slot} padded={false} className={styles.slotCard}>
            <header className={styles.slotHeader}>
              <h2>{SLOT_LABEL[slot]}</h2>
              {kcal > 0 && <span>{fmt.kcal(kcal)}</span>}
            </header>
            {slotMeals.map((m) => (
              <MealRow key={m.id} meal={m} onOpen={() => onOpenMeal(m.id)} checkable={!isFuture} />
            ))}
            {slotExtras.map((e) => (
              <LogRow key={e.id} entry={e} />
            ))}
            <div className={styles.slotActions}>
              <Button variant="ghost" size="sm" icon="plus" onClick={() => onPick({ date, slot })}>
                Rezept
              </Button>
              {!isFuture && (
                <Button variant="ghost" size="sm" icon="search" onClick={() => onLog({ date, slot })}>
                  Lebensmittel
                </Button>
              )}
            </div>
          </Card>
        );
      })}
    </>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  return (
    <div className={styles.logRow}>
      <span className={styles.logText}>
        <span className={styles.mealTitle}>{entry.name}</span>
        <span className={styles.mealMeta}>
          {fmt.kcal(entry.macros.kcal)}
          {entry.macros.protein > 0 && ` · ${fmt.int(entry.macros.protein)} g Protein`}
          {entry.grams && ` · ${fmt.g(entry.grams)}`}
        </span>
      </span>
      <IconButton icon="trash" label={`${entry.name} löschen`} onClick={() => withUndo(`${entry.name} gelöscht`, () => removeLogEntry(entry.id))} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Week plan
// ---------------------------------------------------------------------------

interface WeekViewProps {
  start: ISODate;
  onOpenMeal: (id: string) => void;
  onPick: (t: PickerTarget) => void;
}

function WeekView({ start, onOpenMeal, onPick }: WeekViewProps) {
  const state = useAppState();
  const t = today();
  const days = weekDays(start);
  const end = days[6]!;
  const slots = state.nutritionProfile?.slots ?? SLOT_ORDER;
  const training = useMemo(() => activeWorkouts(state.training, state.workoutOverrides, state.workouts, start, state.dayContexts), [state.training, state.workoutOverrides, state.workouts, state.dayContexts, start]);
  const shoppingCount = useMemo(() => weekShopping(state, start, t).filter((i) => i.state === 'open').length, [state, start, t]);

  // Slots eaten out are free on purpose – not "open".
  const openSlots = days
    .filter((d) => d >= t)
    .reduce((n, d) => n + slots.filter((s) => !excludedSlots(dayContextFor(state, d)).includes(s) && !state.plannedMeals.some((m) => m.date === d && m.slot === s)).length, 0);
  const isPastWeek = end < t;
  const thisWeek = weekStart(t);

  const go = (s: ISODate) => navigate('nutrition', { view: 'week', date: s === thisWeek ? undefined : s }, { replace: true });

  // One planning path: the weekly check-in (same planner as everywhere else).
  const [planning, setPlanning] = useState(false);

  return (
    <>
      <WeekAutopilot week={planning ? start : null} onClose={() => setPlanning(false)} onDone={() => setPlanning(false)} />

      <div className={styles.dateSwitch}>
        <IconButton icon="chevronLeft" label="Vorherige Woche" onClick={() => go(addDays(start, -7))} />
        <div className={styles.dateLabel}>
          <strong>{start === thisWeek ? 'Diese Woche' : start === addDays(thisWeek, 7) ? 'Nächste Woche' : `KW ${isoWeekNumber(start)}`}</strong>
          <span>
            {relativeDayShort(start)} – {relativeDayShort(end)}
          </span>
        </div>
        <IconButton icon="chevronRight" label="Nächste Woche" onClick={() => go(addDays(start, 7))} />
      </div>

      {!isPastWeek && openSlots === 0 && (
        <Button variant="ghost" size="sm" icon="calendar" className={styles.planWeek} onClick={() => setPlanning(true)}>
          Woche neu planen
        </Button>
      )}

      {!isPastWeek && openSlots > 0 && (
        <Card tone="accent" className={styles.suggestCard}>
          <div>
            <strong>{openSlots === days.filter((d) => d >= t).length * slots.length ? 'Noch keine Woche geplant' : `${openSlots} ${openSlots === 1 ? 'Mahlzeit' : 'Mahlzeiten'} offen`}</strong>
            <p className={styles.muted}>Plane deine Woche in etwa 1 Minute – Essen, Training und Einkauf passen dann zusammen.</p>
          </div>
          <Button icon="sparkle" onClick={() => setPlanning(true)}>
            Woche planen
          </Button>
        </Card>
      )}

      {days.map((d) => {
        const dayMeals = state.plannedMeals.filter((m) => m.date === d);
        const target = dayTargetFor(state, d);
        const planned = sumMacros(dayMeals.filter((m) => m.status !== 'skipped').map(plannedMealMacros));
        // On an eating-out day the planned meals cover only their share of the target.
        const out = excludedSlots(dayContextFor(state, d)).filter((sl) => slots.includes(sl));
        const plannedShare = out.length ? 1 - slotShare(out, slots) : 1;
        const fit = target && dayMeals.length > 0 ? planned.kcal / (target.kcal * plannedShare) : undefined;
        const session = training.find((s) => s.date === d);
        const past = d < t;
        return (
          <Card key={d} padded={false} className={[styles.dayCard, past && styles.dayCardPast].filter(Boolean).join(' ')}>
            <header className={styles.dayHeader}>
              <a href={href('nutrition', { view: 'day', date: d })} className={styles.dayName}>
                <strong>{weekdayShort(weekdayIndex(d))}</strong>
                <span>{d === t ? 'Heute' : relativeDayShort(d)}</span>
              </a>
              {session && (
                <span className={styles.trainingTag}>
                  <Icon name="dumbbell" size={14} /> {session.template.name} · ~{estimateMinutes(session.template)} min
                  {session.status === 'moved' ? ' · verschoben' : ''}
                </span>
              )}
              {dayContextFor(state, d).timeBudget !== 'normal' && dayContextFor(state, d).mode === 'normal' && (
                <span className={styles.trainingTag}>
                  <Icon name="clock" size={14} /> {TIME_BUDGETS[dayContextFor(state, d).timeBudget].label}
                </span>
              )}
              {dayContextFor(state, d).mode !== 'normal' && (
                <span className={styles.trainingTag}>
                  <Icon name="calendar" size={14} /> {DAY_MODE_LABEL[dayContextFor(state, d).mode]}
                </span>
              )}
              <span className={styles.flex} />
              {fit !== undefined && (
                <span className={Math.abs(fit - 1) <= 0.08 ? styles.fitOk : styles.fitOff} title="Geplante Kalorien im Vergleich zum Ziel">
                  {fmt.kcal(planned.kcal)}
                </span>
              )}
            </header>
            {slots.map((slot) => {
              const slotMeals = dayMeals.filter((m) => m.slot === slot);
              if (slotMeals.length === 0) {
                return past ? null : (
                  <button key={slot} type="button" className={styles.emptySlot} onClick={() => onPick({ date: d, slot })}>
                    <Icon name="plus" size={16} /> {SLOT_LABEL[slot]}
                  </button>
                );
              }
              return slotMeals.map((m: PlannedMeal) => (
                <MealRow key={m.id} meal={m} label={SLOT_LABEL[slot as MealSlot]} onOpen={() => onOpenMeal(m.id)} checkable={d <= t} />
              ));
            })}
          </Card>
        );
      })}

      {!isPastWeek &&
        (shoppingCount > 0 ? (
          <LinkCard href={href('shopping', start === thisWeek ? undefined : { week: start })} icon={<Icon name="cart" size={20} />}>
            <strong>{shoppingCount} Zutaten auf der Einkaufsliste</strong>
            <span className={styles.muted}>Automatisch aus diesem Plan erstellt</span>
          </LinkCard>
        ) : (
          openSlots === 0 && <EmptyState compact icon="cart" title="Alles erledigt" text="Für diese Woche ist nichts mehr einzukaufen." />
        ))}
    </>
  );
}

function relativeDayShort(d: ISODate): string {
  const [, m, day] = d.split('-');
  return `${Number(day)}.${Number(m)}.`;
}
