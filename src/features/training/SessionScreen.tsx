import { useEffect, useState } from 'react';
import { getExercise } from '../../data/exercises';
import { completedSetCount, formatSet, lastSetsFor, progressionSuggestion } from '../../domain/training';
import type { Workout, WorkoutExercise, WorkoutSet } from '../../domain/types';
import { formatClock } from '../../lib/format';
import { navigate } from '../../lib/router';
import { addSet, completeSet, discardWorkout, finishWorkout, removeLastSet, updateSet } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Button, IconButton } from '../../components/ui/Button';
import { parseNumber } from '../../components/ui/Controls';
import { EmptyState } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { ProgressBar } from '../../components/ui/Progress';
import { Sheet } from '../../components/ui/Sheet';
import { useNow, useWakeLock } from './hooks';
import styles from './training.module.css';

interface Rest {
  endsAt: number;
  total: number;
}

/** Full-screen live session: prefilled sets, one tap per set, automatic rest timer. */
export function SessionScreen() {
  const state = useAppState();
  const workout = state.workouts.find((w) => w.status === 'in_progress');
  const [rest, setRest] = useState<Rest | null>(null);
  const [confirm, setConfirm] = useState<'finish' | 'discard' | null>(null);
  const now = useNow(workout ? 1000 : null);
  useWakeLock(!!workout);

  if (!workout) {
    return (
      <main className={styles.session}>
        <EmptyState
          icon="dumbbell"
          title="Kein aktives Training"
          text="Starte eine Einheit aus deinem Trainingsplan."
          action={<Button onClick={() => navigate('training', undefined, { replace: true })}>Zum Training</Button>}
        />
      </main>
    );
  }

  const total = workout.exercises.reduce((n, e) => n + e.sets.length, 0);
  const done = completedSetCount(workout);
  const elapsed = (now - new Date(workout.startedAt).getTime()) / 1000;

  const onSetDone = (exercise: WorkoutExercise, set: WorkoutSet) => {
    const nowDone = !set.done;
    completeSet(workout.id, exercise.id, set.id, nowDone);
    if (nowDone) {
      navigator.vibrate?.(15);
      setRest({ endsAt: Date.now() + exercise.restSec * 1000, total: exercise.restSec });
    }
  };

  const finish = () => {
    finishWorkout(workout.id);
    navigate('workout', { id: workout.id, done: '1' }, { replace: true });
  };

  return (
    <main className={styles.session}>
      <header className={styles.sessionHeader}>
        <IconButton icon="chevronLeft" label="Zur Übersicht (Training läuft weiter)" onClick={() => navigate('training')} />
        <div className={styles.sessionTitle}>
          <strong>{workout.name}</strong>
          <span>
            <Icon name="clock" size={14} /> {formatClock(elapsed)}
          </span>
        </div>
        <Button size="sm" onClick={() => setConfirm('finish')}>
          Beenden
        </Button>
      </header>
      <div className={styles.sessionProgress}>
        <ProgressBar value={done} max={total} height={4} label="Erledigte Sätze" />
        <span>
          {done} / {total} Sätze
        </span>
      </div>

      <div className={styles.exerciseList}>
        {workout.exercises.map((ex) => (
          <ExerciseCard key={ex.id} workout={workout} exercise={ex} history={state.workouts} onSetDone={(set) => onSetDone(ex, set)} />
        ))}
        <Button variant="ghost" className={styles.discard} onClick={() => setConfirm('discard')}>
          Training verwerfen
        </Button>
      </div>

      {rest && <RestTimer rest={rest} now={now} onChange={setRest} />}

      <Sheet
        open={confirm === 'finish'}
        onClose={() => setConfirm(null)}
        title={done === 0 ? 'Noch keine Sätze erledigt' : done < total ? `${total - done} Sätze noch offen` : 'Training abschließen?'}
        subtitle={done === 0 ? 'Ohne erledigte Sätze wird nichts gespeichert.' : 'Nur erledigte Sätze werden gespeichert.'}
        footer={
          done === 0 ? (
            <>
              <Button variant="secondary" block onClick={() => setConfirm(null)}>
                Weiter trainieren
              </Button>
              <Button
                variant="danger"
                block
                onClick={() => {
                  discardWorkout(workout.id);
                  navigate('training', undefined, { replace: true });
                }}
              >
                Verwerfen
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" block onClick={() => setConfirm(null)}>
                Weiter
              </Button>
              <Button block icon="check" onClick={finish}>
                Speichern
              </Button>
            </>
          )
        }
      >
        <p className={styles.muted}>Dauer bisher: {formatClock(elapsed)}</p>
      </Sheet>

      <Sheet
        open={confirm === 'discard'}
        onClose={() => setConfirm(null)}
        title="Training verwerfen?"
        subtitle="Alle Sätze dieser Einheit werden gelöscht."
        footer={
          <>
            <Button variant="secondary" block onClick={() => setConfirm(null)}>
              Abbrechen
            </Button>
            <Button
              variant="danger"
              block
              onClick={() => {
                discardWorkout(workout.id);
                navigate('training', undefined, { replace: true });
              }}
            >
              Verwerfen
            </Button>
          </>
        }
      >
        <p className={styles.muted}>Das lässt sich nicht rückgängig machen.</p>
      </Sheet>
    </main>
  );
}

// ---------------------------------------------------------------------------

interface ExerciseCardProps {
  workout: Workout;
  exercise: WorkoutExercise;
  history: Workout[];
  onSetDone: (set: WorkoutSet) => void;
}

function ExerciseCard({ workout, exercise, history, onSetDone }: ExerciseCardProps) {
  const info = getExercise(exercise.exerciseId);
  const last = lastSetsFor(history, exercise.exerciseId, workout.id);
  const suggestion = progressionSuggestion(last, exercise.repMax, exercise.exerciseId);
  const allDone = exercise.sets.every((s) => s.done);

  return (
    <section className={allDone ? `${styles.exerciseCard} ${styles.exerciseDone}` : styles.exerciseCard} aria-label={info?.name}>
      <header className={styles.exerciseHeader}>
        <div>
          <h2>{info?.name ?? 'Übung'}</h2>
          <p className={styles.muted}>
            {info?.muscle} · Ziel {exercise.repMin}–{exercise.repMax} Wdh.
          </p>
        </div>
        {allDone && <Icon name="check" size={20} className={styles.accentText} strokeWidth={2.4} />}
      </header>

      {last ? (
        <p className={styles.lastTime}>
          Letztes Mal: {last.map((s) => formatSet(s)).join(', ')}
          {suggestion && <span className={styles.hint}> · Heute {String(suggestion).replace('.', ',')} kg versuchen</span>}
        </p>
      ) : (
        <p className={styles.lastTime}>Erstes Mal – wähle ein Gewicht, mit dem du {exercise.repMax} saubere Wiederholungen schaffst.</p>
      )}

      <div className={styles.setTable} role="table" aria-label={`Sätze ${info?.name ?? ''}`}>
        <div className={styles.setHead} role="row">
          <span role="columnheader">Satz</span>
          <span role="columnheader">{info?.bodyweight ? '+ kg' : 'kg'}</span>
          <span role="columnheader">Wdh.</span>
          <span role="columnheader" className="visually-hidden">
            Erledigt
          </span>
        </div>
        {exercise.sets.map((set, i) => (
          <div key={set.id} className={set.done ? styles.setRowDone : styles.setRow} role="row">
            <span className={styles.setIndex} role="cell">
              {i + 1}
            </span>
            <NumberCell
              value={set.weightKg}
              placeholder={info?.bodyweight ? '0' : '–'}
              label={`Gewicht Satz ${i + 1}`}
              onCommit={(v) => updateSet(workout.id, exercise.id, set.id, { weightKg: v })}
            />
            <NumberCell
              value={set.reps}
              placeholder={String(exercise.repMax)}
              integer
              label={`Wiederholungen Satz ${i + 1}`}
              onCommit={(v) => updateSet(workout.id, exercise.id, set.id, { reps: v })}
            />
            <span role="cell">
              <button
                type="button"
                className={set.done ? styles.setCheckDone : styles.setCheck}
                aria-pressed={set.done}
                aria-label={`Satz ${i + 1} ${set.done ? 'nicht erledigt' : 'erledigt'}`}
                onClick={() => onSetDone(set)}
              >
                <Icon name="check" size={20} strokeWidth={2.6} />
              </button>
            </span>
          </div>
        ))}
      </div>
      <div className={styles.setActions}>
        <Button variant="ghost" size="sm" icon="plus" onClick={() => addSet(workout.id, exercise.id)}>
          Satz
        </Button>
        {exercise.sets.length > 1 && !exercise.sets[exercise.sets.length - 1]!.done && (
          <Button variant="ghost" size="sm" icon="minus" onClick={() => removeLastSet(workout.id, exercise.id)}>
            Satz
          </Button>
        )}
      </div>
    </section>
  );
}

interface NumberCellProps {
  value: number | null;
  placeholder: string;
  label: string;
  integer?: boolean;
  onCommit: (v: number | null) => void;
}

/** Keeps a local draft so typing "82," works; commits valid numbers immediately. */
function NumberCell({ value, placeholder, label, integer, onCommit }: NumberCellProps) {
  const [draft, setDraft] = useState(value === null ? '' : String(value).replace('.', ','));

  useEffect(() => {
    const parsed = parseNumber(draft);
    if ((value ?? NaN) !== parsed && !(value === null && draft === '')) {
      setDraft(value === null ? '' : String(value).replace('.', ','));
    }
    // Only react to external changes (e.g. "+ Satz" copying the previous values).
  }, [value]);

  return (
    <span role="cell">
      <input
        className={styles.setInput}
        inputMode={integer ? 'numeric' : 'decimal'}
        enterKeyHint="done"
        aria-label={label}
        placeholder={placeholder}
        value={draft}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const next = e.target.value.replace(/[^\d.,]/g, '');
          setDraft(next);
          if (next === '') return onCommit(null);
          const n = parseNumber(next);
          if (Number.isFinite(n) && n >= 0 && n < 1000) onCommit(integer ? Math.round(n) : Math.round(n * 100) / 100);
        }}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------

function RestTimer({ rest, now, onChange }: { rest: Rest; now: number; onChange: (r: Rest | null) => void }) {
  const remaining = Math.ceil((rest.endsAt - now) / 1000);
  const over = remaining <= 0;

  useEffect(() => {
    if (over) navigator.vibrate?.([120, 80, 120]);
  }, [over]);

  useEffect(() => {
    if (!over) return;
    const id = window.setTimeout(() => onChange(null), 4000);
    return () => window.clearTimeout(id);
  }, [over, onChange]);

  return (
    <div className={over ? `${styles.rest} ${styles.restOver}` : styles.rest} role="timer" aria-live="off">
      <div className={styles.restFill} style={{ width: `${over ? 100 : (1 - remaining / rest.total) * 100}%` }} />
      <span className={styles.restLabel}>{over ? 'Pause vorbei – weiter geht’s' : 'Pause'}</span>
      {!over && <strong className={styles.restTime}>{formatClock(remaining)}</strong>}
      {!over && (
        <button type="button" className={styles.restBtn} onClick={() => onChange({ ...rest, endsAt: rest.endsAt + 30_000, total: rest.total + 30 })}>
          +30 s
        </button>
      )}
      <button type="button" className={styles.restBtn} onClick={() => onChange(null)}>
        {over ? 'OK' : 'Überspringen'}
      </button>
    </div>
  );
}
