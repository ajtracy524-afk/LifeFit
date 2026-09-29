import { useMemo } from 'react';
import { today, weekStart } from '../../domain/dates';
import { weekProgress } from '../../domain/weekProgress';
import { href } from '../../lib/router';
import { useAppState } from '../../store/store';
import { Card, CardHeader } from '../../components/ui/Card';
import styles from './today.module.css';

/**
 * "Diese Woche" – what was done, what is next, what improved. Plain counts
 * from real data ("an 4 von 5 Tagen"); a goal without data is not shown.
 */
export function WeekProgressCard() {
  const state = useAppState();
  const t = today();
  const p = useMemo(() => weekProgress(state, weekStart(t), t), [state, t]);
  const items = [
    p.trainings.planned ? { icon: '🏋️', label: 'Training', value: `${p.trainings.done} / ${p.trainings.planned}`, full: p.trainings.done >= p.trainings.planned } : undefined,
    p.protein !== undefined ? { icon: '💪', label: 'Protein', value: `${p.protein} von ${p.days} Tagen`, full: p.protein === p.days } : undefined,
    p.calories !== undefined ? { icon: '🎯', label: 'Kalorien im Ziel', value: `${p.calories} von ${p.days} Tagen`, full: p.calories === p.days } : undefined,
    p.water !== undefined ? { icon: '💧', label: 'Wasser', value: `${p.water} von ${p.days} Tagen`, full: p.water === p.days } : undefined,
  ].filter((x): x is NonNullable<typeof x> => !!x);
  if (!items.length) return null;
  return (
    <Card aria-label="Diese Woche">
      <CardHeader title="Diese Woche" action={<a href={href('nutrition', { view: 'week' })} className={styles.weekLink}>Wochenplan</a>} />
      <ul className={styles.weekStats}>
        {items.map((i) => (
          <li key={i.label} data-full={i.full} aria-label={`${i.label}: ${i.value}`}>
            <span aria-hidden>{i.icon}</span>
            <span className={styles.weekStatLabel}>{i.label}</span>
            <strong>{i.value}</strong>
          </li>
        ))}
      </ul>
      {p.next && <p className={styles.muted}>Als Nächstes: {p.next}</p>}
      {p.improvements.map((x) => (
        <p key={x} className={styles.weekImproved}>
          {x}
        </p>
      ))}
    </Card>
  );
}
