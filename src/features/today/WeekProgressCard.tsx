import { useMemo, type CSSProperties } from 'react';
import { today, weekStart, weekdayIndex } from '../../domain/dates';
import { formatLitres, waterAverage } from '../../domain/water';
import { weekdayShort } from '../../lib/format';
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
    p.logged ? { icon: '📝', label: 'Erfasst', value: `${p.logged} von ${p.days} Tagen`, full: p.logged === p.days } : undefined,
    p.trainings.planned ? { icon: '🏋️', label: 'Training', value: `${p.trainings.done} / ${p.trainings.planned}`, full: p.trainings.done >= p.trainings.planned } : undefined,
    p.protein !== undefined ? { icon: '💪', label: 'Protein', value: `${p.protein} von ${p.days} Tagen`, full: p.protein === p.days } : undefined,
    p.calories !== undefined ? { icon: '🎯', label: 'Kalorien im Ziel', value: `${p.calories} von ${p.days} Tagen`, full: p.calories === p.days } : undefined,
  ].filter((x): x is NonNullable<typeof x> => !!x);
  // Water is a fixed part of the week once there is a goal – also on days without an entry (then "–").
  const water = p.waterDays;
  const goal = state.nutritionProfile?.waterGoalMl;
  const avg = water ? waterAverage(water) : undefined;
  if (!items.length && !water) return null;
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
        {water && (
          <li className={styles.weekWater} data-full={(p.water ?? 0) === p.days && p.days > 0} aria-label={`Wasser: an ${p.water ?? 0} von ${p.days} Tagen erreicht`}>
            <span aria-hidden>💧</span>
            <span className={styles.weekStatLabel}>Wasser{goal ? ` · Ziel ${formatLitres(goal)} pro Tag` : ''}</span>
            <strong>
              {p.water ?? 0} / {p.days} {p.days === 1 ? 'Tag' : 'Tage'} Ziel erreicht
            </strong>
            <ol className={styles.waterDays}>
              {water.map((d) => {
                const day = weekdayShort(weekdayIndex(d.date));
                const state = d.future ? 'future' : d.reached ? 'reached' : d.ml > 0 ? 'partial' : 'none';
                const text = d.future ? 'noch offen' : d.reached ? `${formatLitres(d.ml)} – Ziel erreicht` : d.ml > 0 ? `${formatLitres(d.ml)} – Ziel nicht erreicht` : 'kein Eintrag';
                return (
                  <li key={d.date} data-state={state} title={`${day}: ${text}`} aria-label={`${day}: ${text}`}>
                    <span className={styles.waterDayBar} style={{ '--fill': d.future ? 0 : (d.share ?? 0) } as CSSProperties} aria-hidden />
                    <span className={styles.waterDayLabel} aria-hidden>
                      {day}
                    </span>
                    <span className={styles.waterDayMark} aria-hidden>
                      {d.future ? '' : d.reached ? '✓' : d.ml > 0 ? '○' : '–'}
                    </span>
                  </li>
                );
              })}
            </ol>
            {avg !== undefined && <span className={styles.waterAvg}>Ø {formatLitres(Math.round(avg / 50) * 50)} pro Tag (an Tagen mit Eintrag)</span>}
          </li>
        )}
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
