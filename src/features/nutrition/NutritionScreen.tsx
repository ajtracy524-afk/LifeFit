import { useMemo, useState } from 'react';
import { getRecipe } from '../../data/recipes';
import { addDays, isoWeekNumber, today, weekDays, weekStart, weekdayIndex } from '../../domain/dates';
import { BASIC_NUTRIENTS, daySummary, plannedMealMacros, sumMacros, type NutritionSummary } from '../../domain/nutrition';
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
import { MacroStrip } from '../../components/ui/Progress';
import { CountUp } from '../../components/ui/CountUp';
import { LogFoodSheet, type LogTarget } from './LogFoodSheet';
import { MealRow } from './MealRow';
import { MealSheet } from './MealSheet';
import { RecipePicker, type PickerTarget } from './RecipePicker';
import { CoachCard } from '../today/CoachCard';
import { TimeBudgetControl } from '../today/TimeBudgetControl';
import { WeekAutopilot } from '../plan/WeekAutopilot';
import { WaterControl } from './WaterControl';
import { MicronutrientPanel } from './MicronutrientPanel';
import { BudgetLine } from './BudgetLine';
import { CalorieStatusBadge } from './CalorieStatusBadge';
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

      <MealSheet mealId={openMeal} onClose={() => setOpenMeal(null)} />
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
  const summary = useMemo(() => daySummary(state.logEntries, date), [state.logEntries, date]);
  const totals = summary.day.macros;
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

      {target && (
        <Card>
          <div className={styles.dayTotals}>
            <div>
              <span className={styles.bigNumber}>
                <CountUp value={totals.kcal} format={fmt.int} />
              </span>
              <span className={styles.muted}> / {fmt.kcal(target.kcal)}</span>
            </div>
            <span className={styles.remaining}>
              {totals.kcal <= target.kcal ? `${fmt.int(target.kcal - totals.kcal)} übrig` : `+${fmt.int(totals.kcal - target.kcal)} kcal`}
            </span>
          </div>
          {!isFuture && <CalorieStatusBadge date={date} eatenKcal={totals.kcal} targetKcal={target.kcal} />}
          <div className={styles.macroStack}>
            <MacroStrip protein={totals.protein} carbs={totals.carbs} fat={totals.fat} target={target} />
          </div>
          <OptionalNutrients summary={summary.day} />
          <MicronutrientPanel summary={summary.day} />
        </Card>
      )}

      {!isFuture && (
        <Card>
          <WaterControl date={date} />
          {/* Same budget line (and calculation) as on Heute – week of the shown day, eaten so far up to today. */}
          <BudgetLine week={weekStart(date)} label={weekStart(date) === weekStart(today()) ? 'Diese Woche' : `KW ${isoWeekNumber(weekStart(date))}`} progressUntil={today()} className={styles.budgetDay} />
        </Card>
      )}

      {date >= today() && (
        <Card>
          <TimeBudgetControl date={date} withMode />
        </Card>
      )}

      {/* Plan suggestions for today – each one is a plan change (cascade), no tips. */}
      {date === today() && <CoachCard domains={['nutrition', 'shopping', 'body']} title="Vorschläge für deinen Plan" />}

      {slots.map((slot) => {
        const slotMeals = meals.filter((m) => m.slot === slot);
        const slotExtras = extras.filter((e) => e.slot === slot);
        const eaten = summary.slots[slot];
        return (
          <Card key={slot} padded={false} className={styles.slotCard}>
            <header className={styles.slotHeader}>
              <span className={styles.slotTitle}>
                <h2>{SLOT_LABEL[slot]}</h2>
                <span className={styles.slotTime}>{state.plannerSettings.mealTimes[slot]}</span>
              </span>
              {eaten.entries > 0 && <span>{fmt.kcal(eaten.macros.kcal)}</span>}
            </header>
            {eaten.entries > 0 && (
              <p className={styles.slotMacros} aria-label={`${SLOT_LABEL[slot]}: Makros`}>
                <span>
                  <strong>{fmt.int(eaten.macros.protein)} g</strong> Protein
                </span>
                <span>
                  <strong>{fmt.int(eaten.macros.carbs)} g</strong> Kohlenh.
                </span>
                <span>
                  <strong>{fmt.int(eaten.macros.fat)} g</strong> Fett
                </span>
                {eaten.incomplete > 0 && <span className={styles.partial}>teils ohne Angaben</span>}
              </p>
            )}
            {slotMeals.map((m) => (
              <MealRow key={m.id} meal={m} onOpen={() => onOpenMeal(m.id)} checkable={!isFuture} />
            ))}
            {slotExtras.map((e) => (
              <LogRow key={e.id} entry={e} replaces={e.replacedMealId ? getRecipe(meals.find((m) => m.id === e.replacedMealId)?.recipeId ?? '')?.title : undefined} />
            ))}
            {!isFuture && (
              <button type="button" className={styles.addFood} onClick={() => onLog({ date, slot })}>
                <Icon name="plus" size={18} /> Lebensmittel hinzufügen
              </button>
            )}
            <div className={styles.slotSecondary}>
              <Button variant="ghost" size="sm" icon="calendar" onClick={() => onPick({ date, slot })}>
                {date >= today() ? 'Rezept einplanen' : 'Rezept nachtragen'}
              </Button>
            </div>
          </Card>
        );
      })}
    </>
  );
}

const MICRO_LABEL = { fiber: 'Ballaststoffe', sugar: 'Zucker', salt: 'Salz' } as const;

/**
 * "Weitere Nährwerte": fiber, sugar, salt side by side – one glance, smaller
 * than the macros. Appears once any of them is known; a value without data
 * says "keine Daten" (never 0), a sum over only some entries says so.
 */
function OptionalNutrients({ summary }: { summary: NutritionSummary }) {
  if (!BASIC_NUTRIENTS.some((k) => summary.micros[k].known > 0)) return null;
  return (
    <dl className={styles.extraNutrients} aria-label="Weitere Nährwerte">
      {BASIC_NUTRIENTS.map((k) => {
        const m = summary.micros[k];
        return (
          <div key={k} className={styles.extraCell} title={m.known > 0 && m.known < m.of ? `Nur ${m.known} von ${m.of} Einträgen haben diese Angabe` : undefined}>
            <dt>{MICRO_LABEL[k]}</dt>
            <dd>
              {m.known > 0 ? <strong>{fmt.micro(k, m.value)}</strong> : <span className={styles.partial}>keine Daten</span>}
              {m.known > 0 && m.known < m.of && <span className={styles.extraPartial}>aus {m.known} von {m.of}</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

const SOURCE_LABEL: Partial<Record<LogEntry['method'], string>> = { barcode: 'Barcode', manual: 'Manuell', quick: 'Manuell', food: 'Lebensmittel', dish: 'Mein Gericht' };
const UNIT_LABEL = { g: 'g', ml: 'ml', portion: 'Portion', piece: 'Stück' } as const;

/** One logged food. `replaces`: the planned dish it was eaten instead of (shown like on Heute). */
function LogRow({ entry, replaces }: { entry: LogEntry; replaces?: string }) {
  const unknown = new Set(entry.unknown ?? []);
  const amount = entry.amount !== undefined && entry.unit ? `${fmt.dec(entry.amount)} ${UNIT_LABEL[entry.unit]}` : entry.grams ? fmt.g(entry.grams) : undefined;
  return (
    <div className={styles.logRow}>
      <span className={styles.logText}>
        <span className={styles.sourceBadge}>
          {entry.method === 'barcode' && <Icon name="barcode" size={12} />}
          {SOURCE_LABEL[entry.method]}
          {entry.brand ? ` · ${entry.brand}` : ''}
          {replaces ? ` · statt ${replaces}` : ''}
        </span>
        <span className={styles.mealTitle}>{entry.name}</span>
        <span className={styles.mealMeta}>
          {[
            amount,
            fmt.kcal(entry.macros.kcal),
            unknown.has('protein') ? 'Protein –' : `${fmt.int(entry.macros.protein)} g P`,
            unknown.has('carbs') ? 'KH –' : `${fmt.int(entry.macros.carbs)} g KH`,
            unknown.has('fat') ? 'Fett –' : `${fmt.int(entry.macros.fat)} g F`,
          ]
            .filter(Boolean)
            .join(' · ')}
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
      <BudgetLine week={start} label={start === thisWeek ? 'Diese Woche' : start === addDays(thisWeek, 7) ? 'Nächste Woche' : `KW ${isoWeekNumber(start)}`} className={styles.budgetWeek} />

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
