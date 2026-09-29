import { useEffect } from 'react';
import { getExercise } from '../../data/exercises';
import { planSummary, planVsActual, PLAN_STATUS_LABEL, workoutStats } from '../../domain/trainingHistory';
import { recordText } from '../../domain/workoutRecords';
import { AREA_LABEL } from '../../domain/adaptive/sessionAdapt';
import type { Effort } from '../../domain/types';

const EFFORT_LABEL: Record<Effort, string> = { easy: 'Leicht', ok: 'Passend', hard: 'Hart', too_hard: 'Zu hart' };
import { celebrate } from '../../lib/celebrate';
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

/**
 * Summary right after finishing (`done=1`) and detail view from the history:
 * duration, exercises, sets, reps, volume, real records – and per exercise
 * what was planned and what really happened.
 */
export function WorkoutSummary() {
  const { params } = useRoute();
  const state = useAppState();
  const workout = state.workouts.find((w) => w.id === params.get('id') && w.status === 'completed');
  const justFinished = params.get('done') === '1';
  const records = workout?.records ?? [];
  const achievements = workout?.achievements ?? [];

  // Right after finishing: one celebration – records first, otherwise the strongest data-based achievement.
  useEffect(() => {
    if (!justFinished) return;
    if (records.length) celebrate({ kind: 'power', icon: '🏆', title: records.length === 1 ? 'Neue Bestleistung' : `${records.length} neue Bestleistungen`, detail: workout?.name, level: 3 });
    else if (achievements[0]) celebrate({ kind: achievements[0].kind === 'streak' || achievements[0].kind === 'week_complete' ? 'sparkle' : 'power', icon: achievements[0].icon, title: achievements[0].title, detail: achievements[0].detail, level: achievements[0].kind === 'week_complete' ? 3 : 2 });
    // Always a small, calm confirmation – finishing is itself the real event.
    else if (workout) celebrate({ kind: 'check', icon: '✓', title: 'Training abgeschlossen', detail: `${workoutStats(workout).sets} Sätze · ${formatDuration(workoutStats(workout).durationMin * 60000)}`, level: 2 });
    // Only on arrival.
  }, []);

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

  const stats = workoutStats(workout);
  const previous = state.workouts
    .filter((w) => w.status === 'completed' && w.templateId === workout.templateId && w.startedAt < workout.startedAt)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const volumeDelta = previous?.volumeKg && stats.volumeKg ? (stats.volumeKg - previous.volumeKg) / previous.volumeKg : undefined;
  const plan = planSummary(workout);

  return (
    <Screen
      eyebrow={formatDateLong(workout.date)}
      title={justFinished ? 'Stark gemacht! 💪' : workout.name}
      actions={!justFinished && <IconButton icon="close" label="Schließen" onClick={() => navigate('training')} />}
    >
      {justFinished && <p className={styles.muted}>{workout.name} ist gespeichert. Dein Fortschritt wurde aktualisiert.</p>}

      {records.length > 0 && (
        <Card tone="accent">
          <h2 className={styles.cardTitle}>🏆 {records.length === 1 ? 'Neue Bestleistung' : `${records.length} neue Bestleistungen`}</h2>
          <ul className={styles.recordList}>
            {records.map((r) => {
              const t = recordText(r);
              return (
                <li key={r.exerciseId}>
                  <span>
                    {t.icon} {t.title}
                  </span>
                  <strong>{t.detail}</strong>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {achievements.length > 0 && (
        <Card aria-label="Fortschritte">
          <ul className={styles.recordList}>
            {achievements.map((a) => (
              <li key={a.kind}>
                <span>
                  {a.icon} {a.title}
                </span>
                <strong>{a.detail}</strong>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className={styles.statGrid} aria-label="Zusammenfassung">
        <Stat label="Dauer" value={formatDuration(stats.durationMin * 60000)} />
        <Stat label="Übungen" value={String(stats.exercises)} />
        <Stat label="Sätze" value={String(stats.sets)} />
        {stats.volumeKg > 0 && (
          <Stat
            label="Volumen"
            value={`${fmt.int(stats.volumeKg)} kg`}
            sub={volumeDelta !== undefined ? `${volumeDelta >= 0 ? '+' : '−'}${fmt.int(Math.abs(volumeDelta * 100))} % zum letzten Mal` : undefined}
          />
        )}
        {stats.reps > 0 && <Stat label="Wdh." value={fmt.int(stats.reps)} />}
        {stats.cardioMin > 0 && <Stat label="Cardio" value={`${fmt.int(stats.cardioMin)} min`} />}
      </div>

      <Card>
        {plan && <p className={styles.planLine}>{plan}</p>}
        <ul className={styles.summaryList}>
          {workout.exercises.map((ex) => {
            const row = planVsActual(ex);
            return (
              <li key={ex.id} data-status={row.status}>
                <div className={styles.summaryHead}>
                  <strong>{getExercise(ex.exerciseId)?.name ?? 'Übung'}</strong>
                  {row.status !== 'as_planned' && PLAN_STATUS_LABEL[row.status] && (
                    <span className={styles.statusTag} data-status={row.status}>
                      {PLAN_STATUS_LABEL[row.status]}
                    </span>
                  )}
                </div>
                {row.replacedFrom && <span className={styles.muted}>statt {row.replacedFrom}</span>}
                {row.planned && <span className={styles.planRow}>Geplant: {row.planned}</span>}
                <span className={styles.muted}>{row.actual ? `${row.planned ? 'Gemacht: ' : ''}${row.actual}` : 'Nicht gemacht'}</span>
              </li>
            );
          })}
        </ul>
      </Card>

      {(workout.adaptations?.length || workout.feedback) && (
        <Card aria-label="Anpassungen und Feedback">
          {workout.adaptations?.map((a) => (
            <p key={a.title} className={styles.muted}>
              <strong>Angepasst: {a.title}</strong> – {a.reason}
            </p>
          ))}
          {workout.feedback?.effort && <p className={styles.muted}>Dein Eindruck: {EFFORT_LABEL[workout.feedback.effort]}</p>}
          {workout.feedback?.discomfort?.length ? (
            <p className={styles.muted}>Beschwerden: {workout.feedback.discomfort.map((d) => AREA_LABEL[d]).join(', ')} – beim nächsten Start bietet LifeFit dafür Alternativen an.</p>
          ) : null}
        </Card>
      )}

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
