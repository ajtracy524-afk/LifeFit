import { getExercise } from '../../data/exercises';
import { completedSetCount, formatSet } from '../../domain/training';
import { fmt, formatDateLong, formatDuration } from '../../lib/format';
import { navigate, useRoute } from '../../lib/router';
import { withUndo } from '../../lib/undo';
import { discardWorkout } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Screen } from '../../components/Screen';
import { Button, IconButton } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { CoachCard } from '../today/CoachCard';
import { today } from '../../domain/dates';
import { EmptyState } from '../../components/ui/Feedback';
import styles from './training.module.css';

/** Summary right after finishing (`done=1`) and detail view from the history. */
export function WorkoutSummary() {
  const { params } = useRoute();
  const state = useAppState();
  const workout = state.workouts.find((w) => w.id === params.get('id') && w.status === 'completed');
  const justFinished = params.get('done') === '1';

  if (!workout) {
    return (
      <Screen title="Training">
        <EmptyState
          icon="dumbbell"
          title="Training nicht gefunden"
          text="Es wurde vielleicht gelöscht."
          action={<Button onClick={() => navigate('training', undefined, { replace: true })}>Zur Übersicht</Button>}
        />
      </Screen>
    );
  }

  const duration = new Date(workout.endedAt ?? workout.startedAt).getTime() - new Date(workout.startedAt).getTime();
  const previous = state.workouts
    .filter((w) => w.status === 'completed' && w.templateId === workout.templateId && w.startedAt < workout.startedAt)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const volumeDelta = previous?.volumeKg ? ((workout.volumeKg ?? 0) - previous.volumeKg) / previous.volumeKg : undefined;
  const records = workout.records ?? [];

  return (
    <Screen
      eyebrow={formatDateLong(workout.date)}
      title={justFinished ? 'Stark gemacht! 💪' : workout.name}
      actions={!justFinished && <IconButton icon="close" label="Schließen" onClick={() => navigate('training')} />}
    >
      {justFinished && <p className={styles.muted}>{workout.name} ist gespeichert. Dein Fortschritt wurde aktualisiert.</p>}

      <div className={styles.statGrid}>
        <Stat label="Dauer" value={formatDuration(duration)} />
        <Stat label="Volumen" value={`${fmt.int(workout.volumeKg ?? 0)} kg`} sub={volumeDelta !== undefined ? `${volumeDelta >= 0 ? '+' : '−'}${fmt.int(Math.abs(volumeDelta * 100))} % zum letzten Mal` : undefined} />
        <Stat label="Sätze" value={String(completedSetCount(workout))} />
      </div>

      {records.length > 0 && (
        <Card tone="accent">
          <h2 className={styles.cardTitle}>🏆 {records.length === 1 ? 'Neuer Rekord' : `${records.length} neue Rekorde`}</h2>
          <ul className={styles.recordList}>
            {records.map((r) => (
              <li key={r.exerciseId}>
                <span>{getExercise(r.exerciseId)?.name}</span>
                <strong>{formatSet(r)}</strong>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <ul className={styles.summaryList}>
          {workout.exercises.map((ex) => (
            <li key={ex.id}>
              <strong>{getExercise(ex.exerciseId)?.name}</strong>
              <span className={styles.muted}>{ex.sets.map((s) => formatSet(s)).join(' · ')}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* Fitness → nutrition: right after training, what is still open today and meals that fit (same engine as Ernährung). */}
      {justFinished && workout.date === today() && <CoachCard domains={['nutrition']} title="Nach dem Training" />}

      {justFinished ? (
        <Button block size="lg" onClick={() => navigate('today', undefined, { replace: true })}>
          Fertig
        </Button>
      ) : (
        <Button
          variant="ghost"
          className={styles.discard}
          onClick={() => {
            withUndo('Training gelöscht', () => discardWorkout(workout.id));
            navigate('training', undefined, { replace: true });
          }}
        >
          Training löschen
        </Button>
      )}
    </Screen>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <strong className={styles.statValue}>{value}</strong>
      {sub && <span className={styles.statSub}>{sub}</span>}
    </div>
  );
}
