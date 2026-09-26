import { useState } from 'react';
import { getRecipe } from '../../data/recipes';
import { addDays } from '../../domain/dates';
import { explainDay } from '../../domain/explain';
import { plannedMealMacros } from '../../domain/nutrition';
import { dayTimeline } from '../../domain/schedule';
import { estimateMinutes, nextScheduled, type PlannedWorkout } from '../../domain/training';
import type { ISODate, WorkoutTemplate } from '../../domain/types';
import { weekShopping } from '../../domain/week';
import { fmt, relativeDay, SLOT_LABEL } from '../../lib/format';
import { href } from '../../lib/router';
import { useAppState } from '../../store/store';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Icon } from '../../components/ui/Icon';
import styles from './today.module.css';

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
  const meals = items.filter((i) => i.kind === 'meal');
  const eaten = meals.filter((i) => i.kind === 'meal' && i.meal.status === 'eaten').length;
  const hasTraining = items.some((i) => i.kind === 'training');
  const extrasKcal = state.logEntries.filter((e) => e.date === date && !e.plannedMealId).reduce((s, e) => s + e.macros.kcal, 0);
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
              <li key={item.session.id} className={styles.timelineItem}>
                <span className={styles.time}>{item.time}</span>
                <span className={done ? styles.doneBadge : styles.trainingIcon} aria-hidden>
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
          const recipe = getRecipe(item.meal.recipeId);
          const macros = plannedMealMacros(item.meal);
          const done = item.meal.status === 'eaten';
          return (
            <li key={item.meal.id}>
              <button type="button" className={styles.timelineItem} onClick={() => onOpenMeal(item.meal.id)}>
                <span className={styles.time}>{item.time}</span>
                <span className={done ? styles.doneBadge : styles.mealIcon} aria-hidden>
                  {done ? <Icon name="check" size={16} strokeWidth={2.6} /> : recipe?.emoji}
                </span>
                <span className={styles.flex}>
                  <span className={styles.timelineLabel}>
                    {SLOT_LABEL[item.meal.slot]}
                    {item.role === 'post' ? ' · nach dem Training' : item.role === 'pre' ? ' · vor dem Training' : ''}
                  </span>
                  <strong className={styles.timelineTitle}>{recipe?.title ?? 'Mahlzeit'}</strong>
                  <span className={styles.muted}>
                    {fmt.kcal(macros.kcal)} · {fmt.g(macros.protein)} Protein · {recipe?.prepMin ?? 0} min
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
