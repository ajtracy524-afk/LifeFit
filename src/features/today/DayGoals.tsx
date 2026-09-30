import { useEffect, useMemo, type CSSProperties } from 'react';
import { dayGoals, type DayGoal } from '../../domain/dayGoals';
import type { ISODate } from '../../domain/types';
import { celebrate } from '../../lib/celebrate';
import { useCrossing } from '../../lib/motion';
import { useAppState } from '../../store/store';
import styles from './today.module.css';

/** Days already celebrated as complete in this session – the big moment happens once per day. */
const celebratedDays = new Set<string>();

/**
 * "Tagesziele": small chips that close one by one (check drawn when a goal is
 * reached right now), and – when every goal is
 * done – the biggest moment of the day: "Tag abgeschlossen".
 */
export function DayGoals({ date }: { date: ISODate }) {
  const state = useAppState();
  const { goals, done, complete } = useMemo(() => dayGoals(state, date), [state, date]);
  const finished = useCrossing(complete);

  useEffect(() => {
    if (!finished || celebratedDays.has(date)) return;
    celebratedDays.add(date);
    celebrate({ kind: 'day', icon: '✨', title: 'Tag abgeschlossen', detail: 'Alle Tagesziele erreicht – stark!', level: 4 });
  }, [finished, date]);

  if (goals.length < 2) return null;
  return (
    <section className={[styles.dayGoals, complete && styles.dayGoalsComplete, finished > 0 && styles.dayGoalsFinish].filter(Boolean).join(' ')} aria-label="Tagesziele" key={`goals-${finished}`}>
      <div className={styles.dayGoalsHead}>
        <span className={styles.dayGoalsTitle}>{complete ? 'Tag abgeschlossen ✨' : `Tagesziele ${done} / ${goals.length}`}</span>
      </div>
      <ul className={styles.goalChips} style={{ '--n': goals.length } as CSSProperties}>
        {goals.map((g, i) => (
          <GoalChip key={g.key} goal={g} index={i} />
        ))}
      </ul>
    </section>
  );
}

function GoalChip({ goal, index }: { goal: DayGoal; index: number }) {
  const reached = useCrossing(goal.done);
  return (
    <li
      className={[styles.goalChip, goal.done && styles.goalDone, reached > 0 && styles.goalJustDone].filter(Boolean).join(' ')}
      style={{ '--i': index } as CSSProperties}
      title={goal.detail}
      aria-label={`${goal.label}: ${goal.done ? 'erreicht' : 'offen'} (${goal.detail})`}
      data-done={goal.done}
    >
      <span className={styles.goalIcon} aria-hidden>
        {goal.done ? (
          <svg key={reached} viewBox="0 0 24 24" className={styles.goalCheck}>
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        ) : (
          goal.icon
        )}
      </span>
      <span className={styles.goalLabel}>{goal.label}</span>
      <span className={styles.goalValue}>{goal.value}</span>
    </li>
  );
}
