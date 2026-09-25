import { useMemo, useState } from 'react';
import { getExercise, getProgram } from '../../data/exercises';
import { today, weekStart, weekdayIndex } from '../../domain/dates';
import { appStartDate } from '../../domain/progress';
import { nextScheduled, resolveWorkouts, type PlannedWorkout } from '../../domain/training';
import type { WorkoutTemplate } from '../../domain/types';
import { fmt, formatDuration, relativeDay, weekdayShort } from '../../lib/format';
import { href, navigate } from '../../lib/router';
import { showToast } from '../../lib/toast';
import { startWorkoutFrom } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Screen, Section } from '../../components/Screen';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { ProgressBar } from '../../components/ui/Progress';
import { estimateMinutes } from './trainingUtils';
import { WorkoutPlanSheet } from './WorkoutPlanSheet';
import styles from './training.module.css';

export function TrainingScreen() {
  const state = useAppState();
  const t = today();
  const start = weekStart(t);
  const program = state.training ? getProgram(state.training.programId) : undefined;
  const startDate = appStartDate(state);
  // Training days before the user started are simply not shown.
  // Incl. skipped sessions – the week shows what was planned and what changed.
  const week = useMemo(
    () => resolveWorkouts(state.training, state.workoutOverrides, state.workouts, start, state.dayContexts).filter((s) => s.originalDate >= startDate || s.date >= startDate),
    [state.training, state.workoutOverrides, state.workouts, start, startDate],
  );
  const schedule = week.filter((s) => s.status !== 'skipped');
  const [planning, setPlanning] = useState<string | null>(null);
  const planningSession = week.find((s) => s.id === planning) ?? null;
  const next = nextScheduled(state.training, state.workouts, t, start, state.workoutOverrides, state.dayContexts);
  const running = state.workouts.find((w) => w.status === 'in_progress');
  const doneThisWeek = state.workouts.filter((w) => w.status === 'completed' && w.date >= start).length;
  const history = state.workouts
    .filter((w) => w.status === 'completed')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 6);

  const begin = (template: WorkoutTemplate) => {
    const id = startWorkoutFrom(template);
    if (id) navigate('session');
    else showToast('Training konnte nicht gestartet werden.', { tone: 'error' });
  };

  if (!program || !state.training) {
    return (
      <Screen title="Training">
        <EmptyState
          icon="dumbbell"
          title="Noch kein Trainingsplan"
          text="Wähle ein Programm und deine Trainingstage. Wir planen deine Woche."
          action={<Button onClick={() => navigate('profile', { section: 'training' })}>Programm wählen</Button>}
        />
      </Screen>
    );
  }

  return (
    <Screen title="Training" eyebrow={program.name}>
      {running && (
        <Card tone="accent" className={styles.running}>
          <div>
            <strong>{running.name} läuft</strong>
            <p className={styles.muted}>Seit {formatDuration(Date.now() - new Date(running.startedAt).getTime())}</p>
          </div>
          <Button icon="play" onClick={() => navigate('session')}>
            Fortsetzen
          </Button>
        </Card>
      )}

      <Card>
        <CardHeader title="Diese Woche" meta={`${doneThisWeek} / ${schedule.length} Einheiten`} />
        <ProgressBar value={doneThisWeek} max={schedule.length} label="Trainings diese Woche" />
        <ul className={styles.weekList}>
          {week.map((s) => {
            const done = s.completedWorkoutId ? state.workouts.find((w) => w.id === s.completedWorkoutId) : undefined;
            const skipped = s.status === 'skipped';
            const missed = !done && !skipped && s.date < t;
            return (
              <li key={s.id}>
                <div className={[styles.weekItem, skipped && styles.rowSkipped].filter(Boolean).join(' ')}>
                  <a href={done ? href('workout', { id: done.id }) : undefined} className={styles.weekRow} aria-disabled={!done}>
                    <span className={done ? styles.dotDone : s.date === t && !skipped ? styles.dotToday : styles.dot}>{done && <Icon name="check" size={14} strokeWidth={2.6} />}</span>
                    <span className={styles.weekText}>
                      <strong>{s.template.name}</strong>
                      <span>{dayLabel(s)}</span>
                    </span>
                    <span className={styles.weekStatus}>
                      {done ? `${fmt.int(done.volumeKg ?? 0)} kg` : skipped ? 'Fällt aus' : missed ? 'Ausgelassen' : s.date === t ? 'Heute' : ''}
                    </span>
                  </a>
                  {!done && (skipped ? s.originalDate >= t : true) && (
                    <IconButton icon="more" label={`${s.template.name} verschieben oder ausfallen lassen`} onClick={() => setPlanning(s.id)} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {next && !running && (
        <Card>
          <p className={styles.eyebrow}>{next.date === t ? 'Heute' : `Als Nächstes · ${relativeDay(next.date)}`}</p>
          <h2 className={styles.nextTitle}>{next.template.name}</h2>
          <p className={styles.muted}>
            {next.template.focus} · ~{estimateMinutes(next.template)} min
          </p>
          <ul className={styles.exercisePreview}>
            {next.template.exercises.map((e) => (
              <li key={e.exerciseId}>
                <span>{getExercise(e.exerciseId)?.name}</span>
                <span className={styles.muted}>
                  {e.sets} × {e.repMin}–{e.repMax}
                </span>
              </li>
            ))}
          </ul>
          <Button block size="lg" icon="play" onClick={() => begin(next.template)}>
            Training starten
          </Button>
        </Card>
      )}

      <WorkoutPlanSheet session={planningSession} week={week} today={t} onClose={() => setPlanning(null)} />

      <Section title="Andere Einheit starten">
        <Card padded={false}>
          {program.templates.map((tpl) => (
            <button key={tpl.id} type="button" className={styles.templateRow} onClick={() => begin(tpl)} disabled={!!running}>
              <span className={styles.templateIcon}>
                <Icon name="dumbbell" size={18} />
              </span>
              <span className={styles.weekText}>
                <strong>{tpl.name}</strong>
                <span>
                  {tpl.exercises.length} Übungen · ~{estimateMinutes(tpl)} min
                </span>
              </span>
              <Icon name="play" size={16} className={styles.muted} />
            </button>
          ))}
        </Card>
      </Section>

      <Section title="Verlauf">
        {history.length === 0 ? (
          <Card>
            <EmptyState compact emoji="🏁" title="Dein erstes Training erscheint hier" text="Nach jeder Einheit siehst du Volumen, Dauer und neue Rekorde." />
          </Card>
        ) : (
          <Card padded={false}>
            {history.map((w) => (
              <a key={w.id} href={href('workout', { id: w.id })} className={styles.templateRow}>
                <span className={styles.templateIcon}>{w.records?.length ? '🏆' : <Icon name="check" size={18} />}</span>
                <span className={styles.weekText}>
                  <strong>{w.name}</strong>
                  <span>
                    {relativeDay(w.date)} · {formatDuration(new Date(w.endedAt ?? w.startedAt).getTime() - new Date(w.startedAt).getTime())} · {fmt.int(w.volumeKg ?? 0)} kg
                  </span>
                </span>
                <Icon name="chevronRight" size={18} className={styles.muted} />
              </a>
            ))}
          </Card>
        )}
      </Section>
    </Screen>
  );
}

/** "Freitag · verschoben von Do" – the original plan stays visible. */
function dayLabel(s: PlannedWorkout): string {
  const day = relativeDay(s.status === 'skipped' ? s.originalDate : s.date);
  return s.status === 'moved' ? `${day} · verschoben von ${weekdayShort(weekdayIndex(s.originalDate))}` : day;
}
