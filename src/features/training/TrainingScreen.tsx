import { useMemo, useState } from 'react';
import { EXTRA_TEMPLATES, getExercise, getProgram } from '../../data/exercises';
import { today, weekStart, weekdayIndex } from '../../domain/dates';
import { programWeek } from '../../domain/programs';
import { appStartDate } from '../../domain/progress';
import { nextScheduled, resolveWorkouts, type PlannedWorkout } from '../../domain/training';
import type { WorkoutTemplate } from '../../domain/types';
import { fmt, formatDuration, relativeDay, weekdayShort } from '../../lib/format';
import { href, navigate } from '../../lib/router';
import { showToast } from '../../lib/toast';
import { withUndo } from '../../lib/undo';
import { deleteRoutine, duplicateRoutine } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Screen, Section } from '../../components/Screen';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/Feedback';
import { Icon, type IconName } from '../../components/ui/Icon';
import { ProgressBar } from '../../components/ui/Progress';
import { Sheet } from '../../components/ui/Sheet';
import { estimateMinutes } from './trainingUtils';
import { WorkoutPlanSheet } from './WorkoutPlanSheet';
import { MuscleWeek, WorkoutRow } from './HistoryScreen';
import { StartSheet } from './StartSheet';
import { CoachCard } from '../today/CoachCard';
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
    [state.training, state.workoutOverrides, state.workouts, state.dayContexts, start, startDate],
  );
  const schedule = week.filter((s) => s.status !== 'skipped');
  const [planning, setPlanning] = useState<string | null>(null);
  const [menu, setMenu] = useState<WorkoutTemplate | null>(null);
  const planningSession = week.find((s) => s.id === planning) ?? null;
  const next = nextScheduled(state.training, state.workouts, t, start, state.workoutOverrides, state.dayContexts);
  const running = state.workouts.find((w) => w.status === 'in_progress');
  const doneThisWeek = state.workouts.filter((w) => w.status === 'completed' && w.date >= start).length;
  const history = state.workouts
    .filter((w) => w.status === 'completed')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 3);
  const routines = Object.values(state.routines).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const programWeekInfo = programWeek(state.training, t);

  // Every start goes through the short check (time, discomfort, energy) – adaptations only when accepted.
  const [starting, setStarting] = useState<WorkoutTemplate | null>(null);
  const begin = (template: WorkoutTemplate) => setStarting(template);

  if (!program || !state.training) {
    return (
      <Screen title="Training">
        <EmptyState
          icon="dumbbell"
          title="Noch kein Trainingsplan"
          text="Wähle ein Programm und deine Trainingstage. Wir planen deine Woche."
          action={<Button onClick={() => navigate('profile', { section: 'training' })}>Programm wählen</Button>}
        />
        <Links />
      </Screen>
    );
  }

  return (
    <Screen title="Training" eyebrow={programWeekInfo ? `${program.name} · Woche ${Math.min(programWeekInfo.week, programWeekInfo.of)} von ${programWeekInfo.of}` : program.name}>
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

      {next && !running && (
        <Card>
          <p className={styles.eyebrow}>{next.date === t ? 'Heute trainieren' : `Als Nächstes · ${relativeDay(next.date)}`}</p>
          <h2 className={styles.nextTitle}>{next.template.name}</h2>
          <p className={styles.muted}>
            {next.template.focus} · ~{estimateMinutes(next.template)} min
          </p>
          <ul className={styles.exercisePreview}>
            {next.template.exercises.map((e, i) => (
              <li key={`${e.exerciseId}-${i}`}>
                <span>{getExercise(e.exerciseId)?.name}</span>
                <span className={styles.muted}>{e.durationMin ? `${e.durationMin} min` : `${e.sets} × ${e.repMin}–${e.repMax}`}</span>
              </li>
            ))}
          </ul>
          <Button block size="lg" icon="play" onClick={() => begin(next.template)}>
            Training starten
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
                      {done ? (done.volumeKg ? `${fmt.int(done.volumeKg)} kg` : '✓') : skipped ? 'Fällt aus' : missed ? 'Ausgelassen' : s.date === t ? 'Heute' : ''}
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

      <WorkoutPlanSheet session={planningSession} week={week} today={t} onClose={() => setPlanning(null)} />

      <Links />

      <MuscleWeek workouts={state.workouts} week={start} />

      {/* Training hints belong here, next to the plan they refer to. */}
      <CoachCard domains={['training']} title="Hinweise zum Training" />

      <Section
        title="Meine Routinen"
        action={
          <Button variant="ghost" size="sm" icon="plus" onClick={() => navigate('routine')}>
            Neu
          </Button>
        }
      >
        {routines.length === 0 ? (
          <Card>
            <EmptyState compact emoji="📋" title="Noch keine eigene Routine" text="Stell dir ein Workout zusammen oder kopiere eine Einheit unten und passe sie an." />
          </Card>
        ) : (
          <Card padded={false}>
            {routines.map((r) => (
              <TemplateRow key={r.id} template={r} disabled={!!running} onStart={() => begin(r)} onMenu={() => setMenu(r)} />
            ))}
          </Card>
        )}
      </Section>

      <Section title="Einheiten aus deinem Programm">
        <Card padded={false}>
          {program.templates.map((tpl, i) => (
            <TemplateRow key={`${tpl.id}-${i}`} template={tpl} disabled={!!running} onStart={() => begin(tpl)} onMenu={() => setMenu(tpl)} />
          ))}
        </Card>
      </Section>

      <Section title="Cardio & Erholung">
        <Card padded={false}>
          {EXTRA_TEMPLATES.map((tpl) => (
            <TemplateRow key={tpl.id} template={tpl} icon="flame" disabled={!!running} onStart={() => begin(tpl)} onMenu={() => setMenu(tpl)} />
          ))}
        </Card>
      </Section>

      <Section
        title="Verlauf"
        action={
          history.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => navigate('history')}>
              Alle
            </Button>
          )
        }
      >
        {history.length === 0 ? (
          <Card>
            <EmptyState compact emoji="🏁" title="Dein erstes Training erscheint hier" text="Nach jeder Einheit siehst du Volumen, Dauer und neue Rekorde." />
          </Card>
        ) : (
          <Card padded={false}>
            {history.map((w) => (
              <WorkoutRow key={w.id} workout={w} />
            ))}
          </Card>
        )}
      </Section>

      <RoutineMenu template={menu} running={!!running} onClose={() => setMenu(null)} onStart={begin} />
      <StartSheet template={starting} onClose={() => setStarting(null)} />
    </Screen>
  );
}

/** Library, history, programs – one tap away. */
function Links() {
  const items: Array<{ icon: IconName; label: string; go: () => void }> = [
    { icon: 'search', label: 'Übungen', go: () => navigate('exercises') },
    { icon: 'chart', label: 'Verlauf', go: () => navigate('history') },
    { icon: 'calendar', label: 'Programme', go: () => navigate('programs') },
  ];
  return (
    <nav className={styles.links} aria-label="Trainingsbereiche">
      {items.map((i) => (
        <button key={i.label} type="button" className={styles.linkTile} onClick={i.go}>
          <Icon name={i.icon} size={20} />
          {i.label}
        </button>
      ))}
    </nav>
  );
}

function TemplateRow({ template, onStart, onMenu, disabled, icon = 'dumbbell' }: { template: WorkoutTemplate; onStart: () => void; onMenu: () => void; disabled: boolean; icon?: IconName }) {
  return (
    <div className={styles.templateItem}>
      <button type="button" className={styles.templateRow} onClick={onStart} disabled={disabled} aria-label={`${template.name} starten`}>
        <span className={styles.templateIcon}>
          <Icon name={icon} size={18} />
        </span>
        <span className={styles.weekText}>
          <strong>{template.name}</strong>
          <span>
            {template.exercises.length} {template.exercises.length === 1 ? 'Übung' : 'Übungen'} · ~{estimateMinutes(template)} min
          </span>
        </span>
        <Icon name="play" size={16} className={styles.muted} />
      </button>
      <IconButton icon="more" label={`Optionen für ${template.name}`} onClick={onMenu} />
    </div>
  );
}

/** Start · edit · duplicate · delete (own routines); start · copy as own routine (built-in). */
function RoutineMenu({ template, running, onClose, onStart }: { template: WorkoutTemplate | null; running: boolean; onClose: () => void; onStart: (t: WorkoutTemplate) => void }) {
  const own = !!template?.id.startsWith('routine:');
  return (
    <Sheet open={!!template} onClose={onClose} title={template?.name ?? ''} subtitle={template?.focus}>
      {template && (
        <div className={styles.menu}>
          <ul className={styles.exercisePreview}>
            {template.exercises.map((e, i) => (
              <li key={`${e.exerciseId}-${i}`}>
                <span>{getExercise(e.exerciseId)?.name}</span>
                <span className={styles.muted}>{e.durationMin ? `${e.durationMin} min` : `${e.sets} × ${e.repMin}–${e.repMax}`}</span>
              </li>
            ))}
          </ul>
          <Button block icon="play" disabled={running} onClick={() => (onClose(), onStart(template))}>
            Starten
          </Button>
          {own ? (
            <>
              <Button variant="secondary" block icon="edit" onClick={() => (onClose(), navigate('routine', { id: template.id }))}>
                Bearbeiten
              </Button>
              <Button variant="secondary" block onClick={() => (duplicateRoutine(template.id) && showToast('Routine dupliziert'), onClose())}>
                Duplizieren
              </Button>
              <Button variant="ghost" block icon="trash" onClick={() => (withUndo('Routine gelöscht', () => deleteRoutine(template.id)), onClose())}>
                Löschen
              </Button>
            </>
          ) : (
            <Button variant="secondary" block icon="edit" onClick={() => (onClose(), navigate('routine', { from: template.id }))}>
              Als eigene Routine anpassen
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
}

/** "Freitag · verschoben von Do" – the original plan stays visible. */
function dayLabel(s: PlannedWorkout): string {
  const day = relativeDay(s.status === 'skipped' ? s.originalDate : s.date);
  return s.status === 'moved' ? `${day} · verschoben von ${weekdayShort(weekdayIndex(s.originalDate))}` : day;
}
