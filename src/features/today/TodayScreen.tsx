import { useMemo, useState } from 'react';
import { addDays, daysBetween, today, weekDays, weekStart, weekdayIndex } from '../../domain/dates';
import { daySummary } from '../../domain/nutrition';
import { SLOT_ORDER } from '../../domain/planner';
import { goalProgress, latestWeight } from '../../domain/progress';
import { isCompletedOn, resolveWorkouts } from '../../domain/training';
import { nextAction } from '../../domain/today';
import { dayTargetFor, weekShopping } from '../../domain/week';
import type { MealSlot, WorkoutTemplate } from '../../domain/types';
import { fmt, formatDateLong, greeting, weekdayShort } from '../../lib/format';
import { href, navigate } from '../../lib/router';
import { showToast } from '../../lib/toast';
import { startWorkoutFrom } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Screen } from '../../components/Screen';
import { Button } from '../../components/ui/Button';
import { Card, LinkCard } from '../../components/ui/Card';
import { Icon } from '../../components/ui/Icon';
import { MacroStrip, ProgressBar, ProgressRing } from '../../components/ui/Progress';
import { CountUp } from '../../components/ui/CountUp';
import { Sheet } from '../../components/ui/Sheet';
import { LogFoodSheet, type LogTarget } from '../nutrition/LogFoodSheet';
import { WaterControl } from '../nutrition/WaterControl';
import { MicronutrientPanel } from '../nutrition/MicronutrientPanel';
import { BudgetLine } from '../nutrition/BudgetLine';
import { CalorieStatusBadge } from '../nutrition/CalorieStatusBadge';
import { DayTypeBadge } from './DayTypeBadge';
import { DayGoals } from './DayGoals';
import { calorieStatus } from '../../domain/calorieStatus';
import { useCrossing, useIncrease, useScreenMount } from '../../lib/motion';
import { MealSheet } from '../nutrition/MealSheet';
import { WeightSheet } from '../progress/WeightSheet';
import { WorkoutPlanSheet } from '../training/WorkoutPlanSheet';
import { WeekAutopilot } from '../plan/WeekAutopilot';
import { CoachCard } from './CoachCard';
import { DayPlanCard } from './DayPlanCard';
import { NextActionCard } from './NextActionCard';
import { TimeBudgetControl } from './TimeBudgetControl';
import styles from './today.module.css';

export function TodayScreen() {
  useScreenMount();
  const state = useAppState();
  const t = today();
  const start = weekStart(t);

  const [openMeal, setOpenMeal] = useState<string | null>(null);
  const [replaceFirst, setReplaceFirst] = useState(false);
  const openMealSheet = (id: string, replace = false) => {
    setReplaceFirst(replace);
    setOpenMeal(id);
  };
  const [logTarget, setLogTarget] = useState<LogTarget | null>(null);
  const [weightOpen, setWeightOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);

  const target = dayTargetFor(state, t);
  // One summary of what was eaten today – macros and micronutrients from the same entries.
  const day = useMemo(() => daySummary(state.logEntries, t).day, [state.logEntries, t]);
  const totals = day.macros;
  // Ring motion from real changes: every increase an impact, entering the target zone a success sweep.
  const zone = target ? calorieStatus({ eaten: totals.kcal, planned: 0, targetKcal: target.kcal, finished: false })?.key : undefined;
  const ringImpact = useIncrease(totals.kcal);
  const ringSuccess = useCrossing(zone === 'in_zone');
  const slots = state.nutritionProfile?.slots ?? SLOT_ORDER;
  const weekHasMeals = state.plannedMeals.some((m) => m.date >= t && m.date <= addDays(start, 6));

  const week = useMemo(() => resolveWorkouts(state.training, state.workoutOverrides, state.workouts, start, state.dayContexts), [state.training, state.workoutOverrides, state.workouts, state.dayContexts, start]);
  const schedule = week.filter((s) => s.status !== 'skipped');
  const [planOpen, setPlanOpen] = useState(false);
  const [planningWeek, setPlanningWeek] = useState<string | null>(null);
  const todaysSession = schedule.find((s) => s.date === t);
  const running = state.workouts.find((w) => w.status === 'in_progress');

  const shopping = useMemo(() => weekShopping(state, start, t), [state, start, t]);
  const shopState = state.shopping[start];
  const openItems = shopping.filter((i) => i.state === 'open');
  const tomorrow = addDays(t, 1);
  const neededSoon = openItems.filter((i) => i.sources.some((s) => s.date <= tomorrow)).length;
  const manualOpen = shopState?.manual.filter((m) => !m.checked).length ?? 0;

  const goal = state.goal ? goalProgress(state.goal, state.weights) : undefined;
  const lastWeigh = latestWeight(state.weights);
  const weighReminder = !lastWeigh || daysBetween(lastWeigh.date, t) >= 7;

  const isSunday = weekdayIndex(t) === 6;
  const nextWeekStart = addDays(start, 7);
  const nextWeekPlanned = state.plannedMeals.some((m) => m.date >= nextWeekStart && m.date <= addDays(nextWeekStart, 6));

  const action = nextAction(state, t, new Date().getHours());

  const logSlot = (): MealSlot => {
    const h = new Date().getHours();
    const preferred: MealSlot = h < 10 ? 'breakfast' : h < 14 ? 'lunch' : h < 17 ? 'snack' : 'dinner';
    return slots.includes(preferred) ? preferred : (slots[slots.length - 1] ?? 'dinner');
  };

  // Starts today's planned version – shortened on a "wenig Zeit" day.
  const begin = (template: WorkoutTemplate) => {
    if (startWorkoutFrom(template)) navigate('session');
    else showToast('Training konnte nicht gestartet werden.', { tone: 'error' });
  };

  return (
    <Screen
      eyebrow={formatDateLong(t)}
      title={`${greeting()}${state.profile?.name ? `, ${state.profile.name}` : ''}`}
      actions={
        <>
          {/* In the header, not floating: it can never cover content (water, timeline) at any width. */}
          <button type="button" className={styles.quickAdd} onClick={() => setQuickOpen(true)} aria-label="Schnell erfassen">
            <Icon name="plus" size={22} strokeWidth={2.2} />
          </button>
          <a href={href('profile')} className={styles.avatar} aria-label="Profil & Einstellungen">
            {state.profile?.name?.[0]?.toUpperCase() ?? <Icon name="user" size={20} />}
          </a>
        </>
      }
    >
      {/* Week strip */}
      <nav className={styles.week} aria-label="Woche">
        {weekDays(start).map((d, i) => {
          const dayMeals = state.plannedMeals.filter((m) => m.date === d && m.status !== 'skipped');
          const eaten = dayMeals.filter((m) => m.status === 'eaten').length;
          const training = schedule.find((s) => s.date === d);
          const trained = isCompletedOn(state.workouts, d);
          const mealState = dayMeals.length === 0 ? 'none' : eaten === dayMeals.length ? 'full' : eaten > 0 ? 'half' : 'open';
          return (
            <a key={d} href={href('nutrition', { view: 'day', date: d })} className={d === t ? styles.dayActive : styles.day} aria-current={d === t ? 'date' : undefined}>
              <span className={styles.dayName}>{weekdayShort(i)}</span>
              <span className={styles.dayNum}>{Number(d.slice(8))}</span>
              <span className={styles.dayMarks}>
                <span className={`${styles.mealDot} ${styles[mealState]}`} />
                {(training || trained) && <span className={trained ? styles.trainDone : styles.trainPlanned} />}
              </span>
            </a>
          );
        })}
      </nav>

      <button type="button" className={styles.planWeek} onClick={() => setPlanningWeek(start)}>
        <Icon name="calendar" size={16} /> Woche planen
      </button>

      {isSunday && !nextWeekPlanned && (
        <Card tone="accent" className={styles.inlineCard}>
          <div>
            <strong>Nächste Woche planen</strong>
            <p className={styles.muted}>In 2 Minuten steht dein Plan – inklusive Einkaufsliste.</p>
          </div>
          <Button onClick={() => setPlanningWeek(nextWeekStart)}>Planen</Button>
        </Card>
      )}

      {/* Training or rest day – at a glance, a training day links to the session. */}
      <DayTypeBadge session={todaysSession} completed={isCompletedOn(state.workouts, t)} running={running} />

      {/* Daily target */}
      {target && (
        <Card>
          <div className={styles.target}>
            <ProgressRing
              value={totals.kcal}
              max={target.kcal}
              label={`${fmt.int(totals.kcal)} von ${fmt.int(target.kcal)} Kilokalorien`}
              impact={ringImpact}
              success={ringSuccess}
              tone={zone === 'over' || zone === 'well_over' ? 'over' : 'default'}
            >
              <span className={styles.ringValue}>
                <CountUp value={Math.abs(target.kcal - totals.kcal)} format={fmt.int} />
              </span>
              <span className={styles.ringLabel}>
                {zone === 'in_zone' && (
                  <span key={ringSuccess} className={styles.ringCheck} aria-hidden>
                    ✓{' '}
                  </span>
                )}
                {totals.kcal <= target.kcal ? 'kcal übrig' : 'kcal drüber'}
              </span>
            </ProgressRing>
            <div className={styles.targetSide}>
              <p className={styles.targetKcal}>
                <strong>
                  <CountUp value={totals.kcal} format={fmt.int} />
                </strong>{' '}
                / {fmt.kcal(target.kcal)}
              </p>
              <p className={styles.muted}>heute gegessen</p>
              <CalorieStatusBadge date={t} eatenKcal={totals.kcal} targetKcal={target.kcal} />
            </div>
          </div>
          <DayGoals date={t} />
          <div className={styles.macroRow}>
            <MacroStrip protein={totals.protein} carbs={totals.carbs} fat={totals.fat} target={target} />
            <MicronutrientPanel summary={day} />
          </div>
          <div className={styles.waterRow}>
            <WaterControl date={t} />
          </div>
          <div className={styles.statusBudget}>
            <TimeBudgetControl date={t} />
          </div>
        </Card>
      )}

      {/* The one next action of the day */}
      <NextActionCard action={action} onPlanWeek={setPlanningWeek} onStart={begin} onOpenMeal={(id) => openMealSheet(id)} onReplaceMeal={(id) => openMealSheet(id, true)} />

      {/* Only safety notices belong on "Heute" – plus, once today's training is done, what to eat now (fitness → nutrition). */}
      <CoachCard domains={['safety']} />
      {isCompletedOn(state.workouts, t) && <CoachCard domains={['nutrition']} title="Nach deinem Training" />}

      {/* The day as a timeline – meals and training in time order */}
      {weekHasMeals && (
        <DayPlanCard
          date={t}
          weekStartDate={start}
          startInNextAction={action.kind === 'start_training'}
          running={!!running}
          onOpenMeal={(id) => openMealSheet(id)}
          onStart={begin}
          onMoveTraining={() => setPlanOpen(true)}
          onLogFood={() => setLogTarget({ date: t, slot: logSlot() })}
        />
      )}

      {/* Shopping */}
      {weekHasMeals && (
        <LinkCard href={href('shopping')} icon={<Icon name="cart" size={20} />}>
          {openItems.length + manualOpen === 0 ? (
            <strong>Alles eingekauft ✓</strong>
          ) : (
            <>
              <strong>{openItems.length + manualOpen} Artikel offen</strong>
              <span className={styles.muted}>{neededSoon > 0 ? `${neededSoon} davon für heute oder morgen` : 'Für diese Woche'}</span>
            </>
          )}
          <BudgetLine week={start} progressUntil={t} />
        </LinkCard>
      )}

      {/* Goal */}
      {goal && (
        <Card>
          <a href={href('progress')} className={styles.goal}>
            <div className={styles.goalText}>
              <strong>{goal.target !== undefined && goal.target !== goal.start ? `Ziel ${fmt.kg(goal.target)}` : 'Gewicht halten'}</strong>
              <span className={styles.muted}>Aktuell {fmt.kg(goal.current)}</span>
            </div>
            {goal.target !== undefined && goal.target !== goal.start && <span className={styles.goalPct}>{goal.percent} %</span>}
            <Icon name="chevronRight" size={18} className={styles.chevron} />
          </a>
          {goal.target !== undefined && goal.target !== goal.start && <ProgressBar value={goal.percent} max={100} label="Fortschritt zum Ziel" />}
          {weighReminder && (
            <button type="button" className={styles.weighReminder} onClick={() => setWeightOpen(true)}>
              <Icon name="scale" size={18} /> Wiege dich für einen aktuellen Trend
            </button>
          )}
        </Card>
      )}

      <Sheet open={quickOpen} onClose={() => setQuickOpen(false)} title="Schnell erfassen">
        <div className={styles.quickGrid}>
          <QuickAction
            icon="food"
            label="Essen"
            onClick={() => {
              setQuickOpen(false);
              setLogTarget({ date: t, slot: logSlot() });
            }}
          />
          <QuickAction
            icon="scale"
            label="Gewicht"
            onClick={() => {
              setQuickOpen(false);
              setWeightOpen(true);
            }}
          />
          <QuickAction
            icon="dumbbell"
            label="Training"
            onClick={() => {
              setQuickOpen(false);
              navigate(running ? 'session' : 'training');
            }}
          />
          <QuickAction
            icon="cart"
            label="Einkauf"
            onClick={() => {
              setQuickOpen(false);
              navigate('shopping');
            }}
          />
        </div>
      </Sheet>

      <WeekAutopilot
        week={planningWeek}
        onClose={() => setPlanningWeek(null)}
        onDone={(w) => {
          setPlanningWeek(null);
          navigate('nutrition', { view: 'week', date: w === start ? undefined : w });
        }}
      />
      <WorkoutPlanSheet session={planOpen ? (todaysSession ?? null) : null} week={week} today={t} onClose={() => setPlanOpen(false)} />
      {/* Keyed by mode: "Ersetzen" from the card starts a fresh sheet in that view. */}
      <MealSheet key={replaceFirst ? "replace" : "details"} mealId={openMeal} startReplacing={replaceFirst} onClose={() => setOpenMeal(null)} />
      <LogFoodSheet target={logTarget} onClose={() => setLogTarget(null)} />
      <WeightSheet open={weightOpen} onClose={() => setWeightOpen(false)} />
    </Screen>
  );
}

function QuickAction({ icon, label, onClick }: { icon: 'food' | 'scale' | 'dumbbell' | 'cart'; label: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.quickAction} onClick={onClick}>
      <span className={styles.quickIcon}>
        <Icon name={icon} size={24} />
      </span>
      {label}
    </button>
  );
}
