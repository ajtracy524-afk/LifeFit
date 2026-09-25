import { useMemo, useState } from 'react';
import { addDays, daysBetween, today, weekDays, weekStart, weekdayIndex } from '../../domain/dates';
import { dayTotals } from '../../domain/nutrition';
import { SLOT_ORDER } from '../../domain/planner';
import { goalProgress, latestWeight } from '../../domain/progress';
import { isCompletedOn, nextScheduled, resolveWorkouts } from '../../domain/training';
import { dayTargetFor, weekShopping } from '../../domain/week';
import type { MealSlot, WorkoutTemplate } from '../../domain/types';
import { fmt, formatDateLong, formatDuration, greeting, relativeDay, weekdayShort } from '../../lib/format';
import { href, navigate } from '../../lib/router';
import { showToast } from '../../lib/toast';
import { withUndo } from '../../lib/undo';
import { markEaten, startWorkoutFrom } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Screen } from '../../components/Screen';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader, LinkCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { MacroRow, ProgressBar, ProgressRing } from '../../components/ui/Progress';
import { Sheet } from '../../components/ui/Sheet';
import { LogFoodSheet, type LogTarget } from '../nutrition/LogFoodSheet';
import { MealRow } from '../nutrition/MealRow';
import { MealSheet } from '../nutrition/MealSheet';
import { WeightSheet } from '../progress/WeightSheet';
import { estimateMinutes } from '../training/trainingUtils';
import { WorkoutPlanSheet } from '../training/WorkoutPlanSheet';
import { WeekAutopilot } from '../plan/WeekAutopilot';
import { CoachCard } from './CoachCard';
import { TimeBudgetControl } from './TimeBudgetControl';
import styles from './today.module.css';

export function TodayScreen() {
  const state = useAppState();
  const t = today();
  const start = weekStart(t);

  const [openMeal, setOpenMeal] = useState<string | null>(null);
  const [logTarget, setLogTarget] = useState<LogTarget | null>(null);
  const [weightOpen, setWeightOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [showMacros, setShowMacros] = useState(false);

  const target = dayTargetFor(state, t);
  const totals = dayTotals(state.logEntries, t);
  const slots = state.nutritionProfile?.slots ?? SLOT_ORDER;
  const meals = state.plannedMeals.filter((m) => m.date === t).sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  const nextMeal = meals.find((m) => m.status === 'planned');
  const extrasKcal = state.logEntries.filter((e) => e.date === t && !e.plannedMealId).reduce((s, e) => s + e.macros.kcal, 0);
  const weekHasMeals = state.plannedMeals.some((m) => m.date >= t && m.date <= addDays(start, 6));

  const week = useMemo(() => resolveWorkouts(state.training, state.workoutOverrides, state.workouts, start, state.dayContexts), [state.training, state.workoutOverrides, state.workouts, start]);
  const schedule = week.filter((s) => s.status !== 'skipped');
  const [planOpen, setPlanOpen] = useState(false);
  const [planningWeek, setPlanningWeek] = useState<string | null>(null);
  const todaysSession = schedule.find((s) => s.date === t);
  const doneToday = isCompletedOn(state.workouts, t);
  const running = state.workouts.find((w) => w.status === 'in_progress');
  const upcoming = nextScheduled(state.training, state.workouts, addDays(t, 1), start, state.workoutOverrides, state.dayContexts);

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
        <a href={href('profile')} className={styles.avatar} aria-label="Profil & Einstellungen">
          {state.profile?.name?.[0]?.toUpperCase() ?? <Icon name="user" size={20} />}
        </a>
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

      <Card>
        <TimeBudgetControl date={t} />
      </Card>

      {running && (
        <Card tone="accent" className={styles.inlineCard}>
          <div>
            <strong>{running.name} läuft</strong>
            <p className={styles.muted}>Seit {formatDuration(Date.now() - new Date(running.startedAt).getTime())}</p>
          </div>
          <Button icon="play" onClick={() => navigate('session')}>
            Fortsetzen
          </Button>
        </Card>
      )}

      {isSunday && !nextWeekPlanned && (
        <Card tone="accent" className={styles.inlineCard}>
          <div>
            <strong>Nächste Woche planen</strong>
            <p className={styles.muted}>In 2 Minuten steht dein Plan – inklusive Einkaufsliste.</p>
          </div>
          <Button onClick={() => setPlanningWeek(nextWeekStart)}>Planen</Button>
        </Card>
      )}

      {/* Daily target */}
      {target && (
        <Card>
          <div className={styles.target}>
            <ProgressRing value={totals.kcal} max={target.kcal} label={`${fmt.int(totals.kcal)} von ${fmt.int(target.kcal)} Kilokalorien`}>
              <span className={styles.ringValue}>{fmt.int(Math.abs(target.kcal - totals.kcal))}</span>
              <span className={styles.ringLabel}>{totals.kcal <= target.kcal ? 'kcal übrig' : 'kcal drüber'}</span>
            </ProgressRing>
            <div className={styles.targetSide}>
              <p className={styles.targetKcal}>
                <strong>{fmt.int(totals.kcal)}</strong> / {fmt.kcal(target.kcal)}
              </p>
              <MacroRow label="Protein" value={totals.protein} target={target.protein} />
              <button type="button" className={styles.macroToggle} onClick={() => setShowMacros(!showMacros)} aria-expanded={showMacros}>
                Makros <Icon name={showMacros ? 'chevronDown' : 'chevronRight'} size={14} />
              </button>
            </div>
          </div>
          {showMacros && (
            <div className={styles.moreMacros}>
              <MacroRow label="Kohlenhydrate" value={totals.carbs} target={target.carbs} color="var(--carbs)" />
              <MacroRow label="Fett" value={totals.fat} target={target.fat} color="var(--fat)" />
            </div>
          )}
        </Card>
      )}

      {/* Adaptive engine */}
      <CoachCard />

      {/* Meals */}
      {!weekHasMeals ? (
        <Card>
          <EmptyState
            emoji="🗓️"
            title="Deine Woche ist noch leer"
            text="Wir schlagen dir passende Mahlzeiten vor – die Einkaufsliste entsteht automatisch."
            action={
              <Button icon="sparkle" onClick={() => setPlanningWeek(start)}>
                Woche planen
              </Button>
            }
          />
        </Card>
      ) : (
        <Card padded={false} className={styles.mealsCard}>
          <div className={styles.cardPad}>
            <CardHeader title="Mahlzeiten" meta={meals.length ? `${meals.filter((m) => m.status === 'eaten').length} / ${meals.length}` : undefined} />
          </div>
          {meals.length === 0 ? (
            <p className={styles.emptyLine}>Heute ist nichts geplant.</p>
          ) : (
            meals.map((m) => (
              <div key={m.id}>
                <MealRow meal={m} label={slotLabel(m.slot)} highlight={m.id === nextMeal?.id} onOpen={() => setOpenMeal(m.id)} />
                {m.id === nextMeal?.id && (
                  <div className={styles.nextActions}>
                    <Button size="sm" icon="check" onClick={() => withUndo(`${slotLabel(m.slot)} erfasst`, () => markEaten(m.id))}>
                      Gegessen
                    </Button>
                    <Button size="sm" variant="secondary" icon="swap" onClick={() => setOpenMeal(m.id)}>
                      Details & Tauschen
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
          <div className={styles.mealsFooter}>
            {extrasKcal > 0 && <span className={styles.muted}>+ {fmt.kcal(extrasKcal)} zusätzlich erfasst</span>}
            <Button variant="ghost" size="sm" icon="plus" onClick={() => setLogTarget({ date: t, slot: logSlot() })}>
              Essen erfassen
            </Button>
          </div>
        </Card>
      )}

      {/* Training */}
      {state.training && (
        <Card>
          {doneToday ? (
            <div className={styles.trainingRow}>
              <span className={styles.doneBadge}>
                <Icon name="check" size={18} strokeWidth={2.6} />
              </span>
              <div className={styles.flex}>
                <strong>{doneToday.name} erledigt</strong>
                <p className={styles.muted}>
                  {fmt.int(doneToday.volumeKg ?? 0)} kg Volumen
                  {doneToday.records?.length ? ` · ${doneToday.records.length} ${doneToday.records.length === 1 ? 'neuer Rekord' : 'neue Rekorde'} 🏆` : ''}
                </p>
              </div>
              <a href={href('workout', { id: doneToday.id })} className={styles.link}>
                Details
              </a>
            </div>
          ) : todaysSession ? (
            <>
              <p className={styles.eyebrow}>Heutiges Training</p>
              <div className={styles.trainingRow}>
                <div className={styles.flex}>
                  <strong className={styles.trainingTitle}>{todaysSession.template.name}</strong>
                  <p className={styles.muted}>
                    {todaysSession.template.exercises.length} Übungen · ~{estimateMinutes(todaysSession.template)} min
                  </p>
                </div>
                {!running && (
                  <Button icon="play" onClick={() => begin(todaysSession.template)}>
                    Starten
                  </Button>
                )}
              </div>
              {!running && (
                <button type="button" className={styles.planLink} onClick={() => setPlanOpen(true)}>
                  Heute nicht? Verschieben oder ausfallen lassen
                </button>
              )}
            </>
          ) : (
            <div className={styles.trainingRow}>
              <span className={styles.restBadge}>🌿</span>
              <div className={styles.flex}>
                <strong>Ruhetag</strong>
                <p className={styles.muted}>
                  {upcoming ? `Als Nächstes: ${upcoming.template.name}, ${relativeDay(upcoming.date)}` : 'Muskeln wachsen in der Pause.'}
                </p>
              </div>
              <a href={href('training')} className={styles.link}>
                Plan
              </a>
            </div>
          )}
        </Card>
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

      <button type="button" className={styles.fab} onClick={() => setQuickOpen(true)} aria-label="Schnell erfassen">
        <Icon name="plus" size={26} strokeWidth={2.2} />
      </button>

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
      <MealSheet mealId={openMeal} onClose={() => setOpenMeal(null)} onLogInstead={(m) => setLogTarget({ date: m.date, slot: m.slot })} />
      <LogFoodSheet target={logTarget} onClose={() => setLogTarget(null)} />
      <WeightSheet open={weightOpen} onClose={() => setWeightOpen(false)} />
    </Screen>
  );
}

function slotLabel(slot: MealSlot): string {
  return { breakfast: 'Frühstück', snack: 'Snack', lunch: 'Mittag', dinner: 'Abend' }[slot];
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
