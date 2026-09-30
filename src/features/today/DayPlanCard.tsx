import { useMemo, useState } from 'react';
import { getRecipe } from '../../data/recipes';
import { addDays, today } from '../../domain/dates';
import { formatChf, formatCostRange, priceLookup, recipeCostRange } from '../../domain/costs';
import { explainDay } from '../../domain/explain';
import { plannedMealMacros } from '../../domain/nutrition';
import { dayTimeline } from '../../domain/schedule';
import { mealTimeState } from '../../domain/today';
import { estimateMinutes, nextScheduled, type PlannedWorkout } from '../../domain/training';
import type { ISODate, WorkoutTemplate } from '../../domain/types';
import { dayContextFor, weekShopping } from '../../domain/week';
import { fmt, relativeDay, SLOT_LABEL } from '../../lib/format';
import { href } from '../../lib/router';
import { useAppState } from '../../store/store';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Icon } from '../../components/ui/Icon';
import { SwapText, motionStyles } from '../../components/ui/SwapText';
import { useJustChanged, useLateMount } from '../../lib/motion';
import styles from './today.module.css';

/** The meal's mark: its emoji, or a check that snaps in the moment it is eaten (or set in as a replacement). */
function MealMark({ done, emoji }: { done: boolean; emoji?: string }) {
  const changed = useJustChanged(done);
  const late = useLateMount();
  return (
    <span className={[done ? styles.doneMark : styles.mealIcon, done && (changed || late) && motionStyles.snap].filter(Boolean).join(' ')} aria-hidden>
      {done ? <Icon name="check" size={16} strokeWidth={2.6} /> : emoji}
    </span>
  );
}

interface Props {
  date: ISODate;
  weekStartDate: ISODate;
  /** Hide the start button when the next-action card already offers it. */
  startInNextAction: boolean;
  running: boolean;
  onOpenMeal: (mealId: string) => void;
  onStart: (template: WorkoutTemplate) => void;
  onMoveTraining: (session: PlannedWorkout) => void;
  onLogFood: () => void;
}

/**
 * "Dein Plan" – the day as a timeline: meals and training in time order.
 * Decisions are already made; the user just follows (or changes) them.
 */
export function DayPlanCard({ date, weekStartDate, startInNextAction, running, onOpenMeal, onStart, onMoveTraining, onLogFood }: Props) {
  const state = useAppState();
  const [why, setWhy] = useState(false);
  const items = dayTimeline(state, date);
  // Skipped meals are shown but never counted – "x / y gegessen" is about what is (still) on the plan.
  const meals = items.filter((i) => i.kind === 'meal' || i.kind === 'replaced');
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const overdue = (i: { meal: { status: string }; time: string }) => i.meal.status === 'planned' && mealTimeState(date, i.time, today(), nowMinutes) === 'overdue';
  const eaten = meals.filter((i) => i.kind === 'replaced' || (i.kind === 'meal' && i.meal.status === 'eaten')).length;
  const hasTraining = items.some((i) => i.kind === 'training');
  // Replacements are shown in the timeline – only real extras are summed here.
  const extrasKcal = state.logEntries.filter((e) => e.date === date && !e.plannedMealId && !e.replacedMealId).reduce((s, e) => s + e.macros.kcal, 0);
  // The next open meal is THE next action of the plan – highlighted, everything done steps back.
  // Long-past unlogged meals are "noch offen" (their own state) – the next meal is the first one still ahead.
  const nextMealId = items.flatMap((i) => (i.kind === 'meal' && i.meal.status === 'planned' && !overdue(i) ? [i.meal.id] : []))[0];
  // Costs where known: real prices first, estimates only with reliable coverage (see costs.ts).
  const price = useMemo(() => priceLookup(state.products), [state.products]);
  const upcoming = hasTraining ? undefined : nextScheduled(state.training, state.workouts, addDays(date, 1), weekStartDate, state.workoutOverrides, state.dayContexts);
  const tomorrow = addDays(date, 1);
  const needed = weekShopping(state, weekStartDate, date).filter((i) => i.state === 'open' && i.sources.some((s) => s.date >= date && s.date <= tomorrow)).length;
  const reasons = explainDay(state, date, date);

  return (
    <Card padded={false} className={styles.mealsCard}>
      <div className={styles.cardPad}>
        <CardHeader title="Dein Plan" meta={meals.length ? `${eaten} / ${meals.length} gegessen` : undefined} />
      </div>

      {items.length === 0 && <p className={styles.emptyLine}>Heute ist nichts geplant.</p>}

      <ol className={styles.timeline}>
        {items.map((item) => {
          if (item.kind === 'training') {
            const done = !!item.session.completedWorkoutId;
            return (
              <li key={item.session.id} className={done ? `${styles.timelineItem} ${styles.timelineDone}` : styles.timelineItem} data-state={done ? 'eaten' : 'planned'}>
                <span className={styles.time}>{item.time}</span>
                <span className={done ? styles.doneMark : styles.trainingIcon} aria-hidden>
                  {done ? <Icon name="check" size={16} strokeWidth={2.6} /> : '🏋️'}
                </span>
                <div className={styles.flex}>
                  <strong className={styles.timelineTitle}>{item.session.template.name}</strong>
                  <p className={styles.muted}>
                    {done ? 'Erledigt' : `${item.session.template.exercises.length} Übungen · ~${estimateMinutes(item.session.template)} min`}
                  </p>
                  {!done && !running && (
                    <div className={styles.timelineActions}>
                      {!startInNextAction && (
                        <Button size="sm" variant="secondary" icon="play" onClick={() => onStart(item.session.template)}>
                          Starten
                        </Button>
                      )}
                      <button type="button" className={styles.planLink} onClick={() => onMoveTraining(item.session)}>
                        Heute nicht? Verschieben oder ausfallen lassen
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          }
          if (item.kind === 'closed') {
            const out = item.closed.reason === 'eating_out';
            return (
              <li key={`closed-${item.closed.slot}`}>
                <div className={`${styles.timelineItem} ${styles.timelineSkipped}`} data-state="closed">
                  <span className={styles.time}>{item.time}</span>
                  <span className={styles.skipMark} aria-hidden>
                    {out ? '🍽️' : '–'}
                  </span>
                  <span className={styles.flex}>
                    <span className={styles.timelineLabel}>{SLOT_LABEL[item.closed.slot]}</span>
                    <strong className={styles.timelineTitle}>{out ? 'Auswärts' : 'Nicht geplant'}</strong>
                    <span className={styles.muted}>{out ? 'Nicht im Plan – erfasse einfach, was du isst' : 'Heute bewusst nicht geplant'}</span>
                  </span>
                </div>
              </li>
            );
          }
          const recipe = getRecipe(item.meal.recipeId);
          if (item.kind === 'replaced') {
            const kcal = item.entries.reduce((s, e) => s + e.macros.kcal, 0);
            const protein = item.entries.reduce((s, e) => s + e.macros.protein, 0);
            return (
              <li key={item.meal.id}>
                <button type="button" className={`${styles.timelineItem} ${styles.timelineDone}`} onClick={() => onOpenMeal(item.meal.id)} data-state="eaten">
                  <span className={styles.time}>{item.time}</span>
                  <MealMark done />
                  <span className={styles.flex}>
                    <span className={styles.timelineLabel}>{SLOT_LABEL[item.meal.slot]} · gegessen</span>
                    <strong className={styles.timelineTitle}>
                      <SwapText text={item.entries.map((e) => e.name).join(', ')} />
                    </strong>
                    <span className={styles.muted}>
                      {[fmt.kcal(kcal), `${fmt.g(protein)} Protein`, realCost(item.entries)].filter(Boolean).join(' · ')} · statt {recipe?.title ?? 'Mahlzeit'}
                    </span>
                  </span>
                </button>
              </li>
            );
          }
          if (item.kind === 'skipped') {
            const out = dayContextFor(state, date).mode === 'eating_out' && item.meal.slot === 'dinner';
            return (
              <li key={item.meal.id}>
                <div className={`${styles.timelineItem} ${styles.timelineSkipped}`} data-state="skipped">
                  <span className={styles.time}>{item.time}</span>
                  <span className={styles.skipMark} aria-hidden>
                    –
                  </span>
                  <span className={styles.flex}>
                    <span className={styles.timelineLabel}>
                      {SLOT_LABEL[item.meal.slot]} · {out ? 'auswärts' : 'übersprungen'}
                    </span>
                    <strong className={styles.timelineTitle}>{recipe?.title ?? 'Mahlzeit'}</strong>
                    <span className={styles.muted}>Nicht gegessen – zählt nicht in die Tagesbilanz</span>
                  </span>
                </div>
              </li>
            );
          }
          const macros = plannedMealMacros(item.meal);
          const done = item.meal.status === 'eaten';
          const late = overdue(item);
          const next = item.meal.id === nextMealId;
          const role = item.role === 'post' ? ' · nach dem Training' : item.role === 'pre' ? ' · vor dem Training' : '';
          return (
            <li key={item.meal.id}>
              <button
                type="button"
                className={[styles.timelineItem, done && styles.timelineDone, next && styles.timelineNext, late && styles.timelineOverdue].filter(Boolean).join(' ')}
                onClick={() => onOpenMeal(item.meal.id)}
                data-state={done ? 'eaten' : late ? 'overdue' : next ? 'next' : 'planned'}
              >
                <span className={styles.time}>{item.time}</span>
                <MealMark done={done} emoji={recipe?.emoji} />
                <span className={styles.flex}>
                  <span className={styles.timelineLabel}>
                    {SLOT_LABEL[item.meal.slot]}
                    {done ? ' · gegessen' : late ? ' · noch offen' : next ? ' · als Nächstes' : ' · später'}
                    {role}
                  </span>
                  <strong className={styles.timelineTitle}>
                    <SwapText text={recipe?.title ?? 'Mahlzeit'} />
                  </strong>
                  <span className={styles.muted}>
                    {[fmt.kcal(macros.kcal), `${fmt.g(macros.protein)} Protein`, !done && `${recipe?.prepMin ?? 0} min`, recipe && costRange(recipe, item.meal.servings, price)].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {!hasTraining && state.training && (
        <p className={styles.restLine}>
          🌿 Ruhetag{upcoming ? ` – als Nächstes ${upcoming.template.name}, ${relativeDay(upcoming.date)}` : ''}
        </p>
      )}

      <div className={styles.mealsFooter}>
        {extrasKcal > 0 && <span className={styles.muted}>+ {fmt.kcal(extrasKcal)} zusätzlich erfasst</span>}
        <Button variant="ghost" size="sm" icon="plus" onClick={onLogFood}>
          Essen erfassen
        </Button>
      </div>

      {(needed > 0 || reasons.length > 0) && (
        <div className={styles.planFooter}>
          {needed > 0 && (
            <a href={href('shopping')} className={styles.link}>
              Heute musst du nur {needed} {needed === 1 ? 'Ding' : 'Dinge'} einkaufen ›
            </a>
          )}
          {reasons.length > 0 && (
            <>
              <button type="button" className={styles.whyToggle} onClick={() => setWhy(!why)} aria-expanded={why}>
                Warum dieser Plan?
              </button>
              {why && (
                <ul className={styles.whyList}>
                  {reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

/** Real cost of replacement entries – only if every entry has one (otherwise no number). */
function realCost(entries: { costChf?: number }[]): string | undefined {
  return entries.every((e) => e.costChf !== undefined) ? formatChf(entries.reduce((sum, e) => sum + e.costChf!, 0)) : undefined;
}

function costRange(recipe: Parameters<typeof recipeCostRange>[0], servings: number, price: Parameters<typeof recipeCostRange>[2]): string | undefined {
  const r = recipeCostRange(recipe, servings, price);
  return r ? formatCostRange(r) : undefined;
}
