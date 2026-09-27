import { useMemo } from 'react';
import { addDays, today, weekStart } from '../../domain/dates';
import { REGION_LABEL, regionLoad, type Region } from '../../domain/engine/trainingRules';
import { historyByWeek, workoutStats } from '../../domain/trainingHistory';
import { fmt, formatDateShort, formatDuration, relativeDay } from '../../lib/format';
import { href, navigate } from '../../lib/router';
import { useAppState } from '../../store/store';
import { Screen, Section } from '../../components/Screen';
import { IconButton } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import type { ISODate, Workout } from '../../domain/types';
import styles from './training.module.css';

/** All completed workouts by week – date, duration, sets, volume, records. A tap opens the details. */
export function HistoryScreen() {
  const state = useAppState();
  const weeks = useMemo(() => historyByWeek(state.workouts, weekStart), [state.workouts]);
  return (
    <Screen title="Verlauf" eyebrow="Training" actions={<IconButton icon="close" label="Zurück zum Training" onClick={() => navigate('training')} />}>
      {weeks.length === 0 ? (
        <Card>
          <EmptyState compact emoji="🏁" title="Noch kein Training gespeichert" text="Nach jeder Einheit siehst du hier Dauer, Sätze, Volumen und Rekorde." />
        </Card>
      ) : (
        weeks.map((w) => {
          const volume = w.workouts.reduce((v, x) => v + workoutStats(x).volumeKg, 0);
          return (
            <Section key={w.week} title={weekTitle(w.week)} action={<span className={styles.muted}>{volume > 0 ? `${fmt.int(volume)} kg` : ''}</span>}>
              <Card padded={false}>
                {w.workouts.map((x) => (
                  <WorkoutRow key={x.id} workout={x} />
                ))}
              </Card>
            </Section>
          );
        })
      )}
    </Screen>
  );
}

function weekTitle(week: ISODate): string {
  const current = weekStart(today());
  if (week === current) return 'Diese Woche';
  if (week === addDays(current, -7)) return 'Letzte Woche';
  return `${formatDateShort(week)} – ${formatDateShort(addDays(week, 6))}`;
}

export function WorkoutRow({ workout: w }: { workout: Workout }) {
  const s = workoutStats(w);
  const detail = [relativeDay(w.date), formatDuration(s.durationMin * 60000), `${s.sets} Sätze`, s.volumeKg > 0 ? `${fmt.int(s.volumeKg)} kg` : s.cardioMin > 0 ? `${s.cardioMin} min Cardio` : undefined]
    .filter(Boolean)
    .join(' · ');
  return (
    <a href={href('workout', { id: w.id })} className={styles.templateRow}>
      <span className={styles.templateIcon}>{s.records ? '🏆' : <Icon name="check" size={18} />}</span>
      <span className={styles.weekText}>
        <strong>{w.name}</strong>
        <span>
          {detail}
          {s.records ? ` · ${s.records} ${s.records === 1 ? 'Rekord' : 'Rekorde'}` : ''}
        </span>
      </span>
      <Icon name="chevronRight" size={18} className={styles.muted} />
    </a>
  );
}

const REGIONS: Region[] = ['chest', 'back', 'shoulders', 'arms', 'legs', 'core'];

/**
 * Sets per muscle region this week (primary mover 1, helper ½ – the engine's
 * counting). A plain overview of what was trained, no rating of the body.
 */
export function MuscleWeek({ workouts, week }: { workouts: Workout[]; week: ISODate }) {
  const load = useMemo(() => regionLoad(workouts, week, addDays(week, 6)), [workouts, week]);
  const max = Math.max(1, ...REGIONS.map((r) => load[r].sets));
  const any = REGIONS.some((r) => load[r].sets > 0);
  const cardio = useMemo(() => workouts.filter((w) => w.status === 'completed' && w.date >= week && w.date <= addDays(week, 6)).reduce((m, w) => m + workoutStats(w).cardioMin, 0), [workouts, week]);
  return (
    <Card>
      <CardHeader title="Diese Woche trainiert" meta="Sätze je Muskelgruppe" />
      {!any && !cardio ? (
        <p className={styles.muted}>Nach deinem ersten Training dieser Woche siehst du hier, welche Muskelgruppen dran waren.</p>
      ) : (
        <ul className={styles.muscleBars}>
          {REGIONS.map((r) => (
            <li key={r} aria-label={`${REGION_LABEL[r]}: ${fmt.dec(load[r].sets)} Sätze`}>
              <span>{REGION_LABEL[r]}</span>
              <span className={styles.muscleTrack} aria-hidden>
                <span style={{ width: `${(load[r].sets / max) * 100}%` }} />
              </span>
              <strong>{fmt.dec(load[r].sets)}</strong>
            </li>
          ))}
        </ul>
      )}
      {cardio > 0 && <p className={styles.muted}>Cardio diese Woche: {fmt.int(cardio)} min</p>}
    </Card>
  );
}
