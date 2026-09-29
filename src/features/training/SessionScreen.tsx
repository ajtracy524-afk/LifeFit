import { useEffect, useRef, useState } from 'react';
import { getExercise } from '../../data/exercises';
import { alternativesFor, EQUIPMENT_LABEL, SET_TYPE_LABEL, SET_TYPE_SHORT } from '../../domain/exerciseLibrary';
import { completedSetCount, formatKg, formatSet, isTimed, lastSetsFor } from '../../domain/training';
import { bestSet } from '../../domain/trainingHistory';
import { exerciseBests, recordText, setRecord, volumeRecord } from '../../domain/workoutRecords';
import type { BodyArea, Effort, SetType, Workout, WorkoutExercise, WorkoutSet } from '../../domain/types';
import { changeLabel } from '../../domain/adaptive/progression';
import { RIR_OPTIONS, rirChoice, rirLabel, rpeFromRir } from '../../domain/effort';
import { AREA_LABEL, DISCOMFORT_NOTE } from '../../domain/adaptive/sessionAdapt';
import { Chip, parseNumber } from '../../components/ui/Controls';
import { celebrate } from '../../lib/celebrate';
import { formatClock } from '../../lib/format';
import { haptic } from '../../lib/motion';
import { navigate } from '../../lib/router';
import {
  addExerciseToWorkout,
  addSet,
  completeSet,
  decidePrescription,
  setSetRpe,
  discardWorkout,
  finishWorkout,
  removeSet,
  replaceExercise,
  setSetType,
  skipExercise,
  skipSet,
  updateSet,
} from '../../store/actions';
import { getState, useAppState } from '../../store/store';
import { Button, IconButton } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { ProgressBar } from '../../components/ui/Progress';
import { Sheet } from '../../components/ui/Sheet';
import { ExercisePicker } from './ExerciseLibrary';
import { ExerciseSheet } from './ExerciseSheet';
import { useNow, useWakeLock } from './hooks';
import styles from './training.module.css';

const EFFORT: Array<{ value: Effort; label: string }> = [
  { value: 'easy', label: 'Leicht' },
  { value: 'ok', label: 'Passend' },
  { value: 'hard', label: 'Hart' },
  { value: 'too_hard', label: 'Zu hart' },
];

interface Rest {
  endsAt: number;
  total: number;
  /** The set just finished – its RIR can be tapped right in the timer. */
  set?: { exerciseEntryId: string; setId: string };
  /** "Bankdrücken · Satz 2 · 80 kg × 8" – what comes after the rest. */
  next?: string;
}

type Picker = { mode: 'add' } | { mode: 'replace'; exerciseEntryId: string };

/**
 * Full-screen live session – the gym flow: exercise → set → ✓ → rest timer →
 * next set, all on one screen. Sets are prefilled with today's target (from
 * the last session), so a tap confirms; every value stays editable. Plan and
 * reality stay separate: skipping, replacing, adding sets or exercises and
 * stopping early only change what really happened.
 */
export function SessionScreen() {
  const state = useAppState();
  const workout = state.workouts.find((w) => w.status === 'in_progress');
  const [rest, setRest] = useState<Rest | null>(null);
  const [confirm, setConfirm] = useState<'finish' | 'discard' | null>(null);
  const [setMenu, setSetMenu] = useState<{ exerciseEntryId: string; setId: string } | null>(null);
  const [exMenu, setExMenu] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [effort, setEffort] = useState<Effort | undefined>(undefined);
  const [pain, setPain] = useState<BodyArea[]>([]);
  // Each record is celebrated once per exercise and kind in a session (un-ticking and ticking again does not repeat it).
  const celebrated = useRef(new Set<string>());
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

  const open = workout.exercises.flatMap((e) => e.sets.filter((s) => !s.skipped));
  const total = open.length;
  const done = completedSetCount(workout);
  const elapsed = (now - new Date(workout.startedAt).getTime()) / 1000;
  const menuExercise = workout.exercises.find((e) => e.id === exMenu);
  const menuSet = setMenu ? workout.exercises.find((e) => e.id === setMenu.exerciseEntryId)?.sets.find((s) => s.id === setMenu.setId) : undefined;
  const replacing = picker?.mode === 'replace' ? workout.exercises.find((e) => e.id === picker.exerciseEntryId) : undefined;

  const onSetDone = (exercise: WorkoutExercise, set: WorkoutSet) => {
    const nowDone = !set.done;
    completeSet(workout.id, exercise.id, set.id, nowDone);
    if (!nowDone) return;
    if (!celebrateRecord(workout, exercise, set, celebrated.current)) haptic(1);
    // Superset: straight to the next exercise of the group, the rest comes after the last one.
    const group = exercise.supersetGroup ? workout.exercises.filter((e) => e.supersetGroup === exercise.supersetGroup && !e.skipped) : [];
    if (group.length > 1 && group[group.length - 1]!.id !== exercise.id) return setRest(null);
    setRest({
      endsAt: Date.now() + exercise.restSec * 1000,
      total: exercise.restSec,
      next: nextSetText(getState().workouts.find((w) => w.id === workout.id) ?? workout),
      ...(isTimed(exercise.exerciseId) ? {} : { set: { exerciseEntryId: exercise.id, setId: set.id } }),
    });
  };

  const finish = () => {
    finishWorkout(workout.id, { ...(effort ? { effort } : {}), ...(pain.length ? { discomfort: pain } : {}) });
    navigate('workout', { id: workout.id, done: '1' }, { replace: true });
  };
  const discard = () => {
    discardWorkout(workout.id);
    navigate('training', undefined, { replace: true });
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
        {workout.adaptations && workout.adaptations.length > 0 && (
          <details className={styles.adaptedBanner}>
            <summary>
              Heute angepasst: {workout.adaptations.map((a) => a.title).join(' · ')}
            </summary>
            <ul>
              {workout.adaptations.map((a) => (
                <li key={a.title}>
                  <strong>{a.title}</strong> – {a.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
        {workout.exercises.map((ex) => (
          <ExerciseCard
            key={ex.id}
            workout={workout}
            exercise={ex}
            history={state.workouts}
            onSetDone={(set) => onSetDone(ex, set)}
            onSetMenu={(setId) => setSetMenu({ exerciseEntryId: ex.id, setId })}
            onMenu={() => setExMenu(ex.id)}
            onInfo={() => setInfo(ex.exerciseId)}
          />
        ))}
        <Button variant="secondary" icon="plus" onClick={() => setPicker({ mode: 'add' })}>
          Übung hinzufügen
        </Button>
        <Button variant="ghost" className={styles.discard} onClick={() => setConfirm('discard')}>
          Training verwerfen
        </Button>
      </div>

      {rest && (
        <RestTimer
          rest={rest}
          now={now}
          onChange={setRest}
          rpe={rest.set ? workout.exercises.find((e) => e.id === rest.set!.exerciseEntryId)?.sets.find((s) => s.id === rest.set!.setId)?.rpe : undefined}
          onRir={rest.set ? (rpe) => setSetRpe(workout.id, rest.set!.exerciseEntryId, rest.set!.setId, rpe) : undefined}
        />
      )}

      {/* Set options: type, skip, remove. */}
      <Sheet open={!!menuSet} onClose={() => setSetMenu(null)} title="Satz" subtitle={menuSet ? formatSet(menuSet) : undefined}>
        {menuSet && setMenu && (
          <div className={styles.menu}>
            <p className={styles.planLabel}>Satz-Typ</p>
            <div className={styles.typeGrid} role="radiogroup" aria-label="Satz-Typ">
              {(Object.keys(SET_TYPE_LABEL) as SetType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={menuSet.type === t}
                  className={menuSet.type === t ? styles.typeOptionActive : styles.typeOption}
                  onClick={() => {
                    setSetType(workout.id, setMenu.exerciseEntryId, setMenu.setId, t);
                    setSetMenu(null);
                  }}
                >
                  <span className={styles.typeBadge}>{SET_TYPE_SHORT[t] || '1'}</span>
                  {SET_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
            <p className={styles.muted}>Aufwärmsätze zählen nicht fürs Volumen und nicht für Rekorde.</p>
            <p className={styles.planLabel}>Wie viele Wiederholungen wären noch gegangen? (RIR, optional)</p>
            <RirChips rpe={menuSet.rpe} onPick={(rpe) => setSetRpe(workout.id, setMenu.exerciseEntryId, setMenu.setId, rpe)} />
            <p className={styles.muted}>0 = nichts mehr drin, 2 = noch zwei Wiederholungen möglich. Hilft bei den nächsten Vorschlägen.</p>
            <Button
              variant="secondary"
              block
              onClick={() => {
                skipSet(workout.id, setMenu.exerciseEntryId, setMenu.setId, !menuSet.skipped);
                setSetMenu(null);
              }}
            >
              {menuSet.skipped ? 'Satz wieder aufnehmen' : 'Satz überspringen'}
            </Button>
            {!menuSet.done && (workout.exercises.find((e) => e.id === setMenu.exerciseEntryId)?.sets.length ?? 0) > 1 && (
              <Button
                variant="ghost"
                block
                icon="trash"
                onClick={() => {
                  removeSet(workout.id, setMenu.exerciseEntryId, setMenu.setId);
                  setSetMenu(null);
                }}
              >
                Satz entfernen
              </Button>
            )}
          </div>
        )}
      </Sheet>

      {/* Exercise options: details, replace, skip, add a set. */}
      <Sheet open={!!menuExercise} onClose={() => setExMenu(null)} title={menuExercise ? (getExercise(menuExercise.exerciseId)?.name ?? 'Übung') : ''}>
        {menuExercise && (
          <div className={styles.menu}>
            <Button variant="secondary" block icon="info" onClick={() => (setExMenu(null), setInfo(menuExercise.exerciseId))}>
              Anleitung & Details
            </Button>
            <Button variant="secondary" block icon="swap" onClick={() => (setExMenu(null), setPicker({ mode: 'replace', exerciseEntryId: menuExercise.id }))}>
              Übung ersetzen
            </Button>
            <Button variant="secondary" block icon="plus" onClick={() => (addSet(workout.id, menuExercise.id), setExMenu(null))}>
              Satz hinzufügen
            </Button>
            <Button variant="secondary" block onClick={() => (skipExercise(workout.id, menuExercise.id, !menuExercise.skipped), setExMenu(null))}>
              {menuExercise.skipped ? 'Übung doch machen' : 'Übung überspringen'}
            </Button>
          </div>
        )}
      </Sheet>

      <ExercisePicker
        open={!!picker}
        title={picker?.mode === 'replace' ? 'Übung ersetzen' : 'Übung hinzufügen'}
        onClose={() => setPicker(null)}
        onPick={(id) => {
          if (picker?.mode === 'replace') replaceExercise(workout.id, picker.exerciseEntryId, id);
          else addExerciseToWorkout(workout.id, id, isTimed(id) ? { sets: 1, repMin: 0, repMax: 0, durationMin: 20, restSec: 60 } : undefined);
          setPicker(null);
        }}
        top={
          replacing && (
            <div className={styles.alternatives}>
              <p className={styles.planLabel}>Trainiert dasselbe</p>
              {alternativesFor(replacing.exerciseId, state.training)
                .slice(0, 4)
                .map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={styles.altRow}
                    onClick={() => {
                      replaceExercise(workout.id, replacing.id, a.id);
                      setPicker(null);
                    }}
                  >
                    <strong>{a.name}</strong>
                    <span>{EQUIPMENT_LABEL[a.equipment]}</span>
                  </button>
                ))}
              <p className={styles.planLabel}>Oder aus allen Übungen</p>
            </div>
          )
        }
      />

      <ExerciseSheet exerciseId={info} onClose={() => setInfo(null)} />

      <Sheet
        open={confirm === 'finish'}
        onClose={() => setConfirm(null)}
        title={done === 0 ? 'Noch keine Sätze erledigt' : done < total ? `${total - done} Sätze noch offen` : 'Training abschließen?'}
        subtitle={done === 0 ? 'Ohne erledigte Sätze wird nichts gespeichert.' : 'Nur erledigte Sätze werden gespeichert – offene zählen als ausgelassen.'}
        footer={
          done === 0 ? (
            <>
              <Button variant="secondary" block onClick={() => setConfirm(null)}>
                Weiter trainieren
              </Button>
              <Button variant="danger" block onClick={discard}>
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
        {done > 0 && (
          <div className={styles.menu}>
            <p className={styles.planLabel}>Wie war das Training? (optional)</p>
            <div className={styles.planDays} role="group" aria-label="Wie war das Training">
              {EFFORT.map((e) => (
                <Chip key={e.value} selected={effort === e.value} onClick={() => setEffort(effort === e.value ? undefined : e.value)}>
                  {e.label}
                </Chip>
              ))}
            </div>
            <p className={styles.planLabel}>Beschwerden?</p>
            <div className={styles.planDays} role="group" aria-label="Beschwerden nach dem Training">
              {(Object.keys(AREA_LABEL) as BodyArea[]).map((a) => (
                <Chip key={a} selected={pain.includes(a)} onClick={() => setPain((xs) => (xs.includes(a) ? xs.filter((x) => x !== a) : [...xs, a]))}>
                  {AREA_LABEL[a]}
                </Chip>
              ))}
            </div>
            {pain.length > 0 && <p className={styles.note}>{DISCOMFORT_NOTE}</p>}
            <p className={styles.muted}>Deine Angaben fließen in die nächsten Vorschläge ein.</p>
          </div>
        )}
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
            <Button variant="danger" block onClick={discard}>
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

/**
 * A real record the moment it happens – against earlier completed workouts
 * only (a first time is never a record). Returns true when something was
 * celebrated. Warm-ups never count.
 */
function celebrateRecord(workout: Workout, exercise: WorkoutExercise, set: WorkoutSet, seen: Set<string>): boolean {
  if (set.type === 'warmup' || isTimed(exercise.exerciseId)) return false;
  const bests = exerciseBests(getState().workouts, exercise.exerciseId, { excludeId: workout.id });
  if (!bests) return false;
  const value = { weightKg: set.weightKg, reps: set.reps ?? exercise.repMax };
  const withThis = exercise.sets.map((s) => (s.id === set.id ? { ...s, ...value, done: true } : s));
  const record = setRecord(exercise.exerciseId, value, bests) ?? volumeRecord({ exerciseId: exercise.exerciseId, sets: withThis }, bests);
  const key = record && `${exercise.id}|${record.kind}`;
  if (!record || seen.has(key!)) return false;
  seen.add(key!);
  const text = recordText(record);
  celebrate({ kind: 'power', icon: text.icon, title: text.title, detail: text.detail, level: 3 });
  return true;
}

/** The next open set of the session – shown in the rest timer. */
function nextSetText(w: Workout): string | undefined {
  for (const ex of w.exercises) {
    if (ex.skipped) continue;
    const i = ex.sets.findIndex((s) => !s.done && !s.skipped);
    if (i < 0) continue;
    const s = ex.sets[i]!;
    const value = s.durationMin ? `${formatKg(s.durationMin)} min` : s.weightKg || s.reps ? formatSet(s) : undefined;
    return [getExercise(ex.exerciseId)?.name, `Satz ${i + 1}`, value].filter(Boolean).join(' · ');
  }
  return undefined;
}

// ---------------------------------------------------------------------------

interface ExerciseCardProps {
  workout: Workout;
  exercise: WorkoutExercise;
  history: Workout[];
  onSetDone: (set: WorkoutSet) => void;
  onSetMenu: (setId: string) => void;
  onMenu: () => void;
  onInfo: () => void;
}

function ExerciseCard({ workout, exercise, history, onSetDone, onSetMenu, onMenu, onInfo }: ExerciseCardProps) {
  const info = getExercise(exercise.exerciseId);
  const timed = isTimed(exercise.exerciseId);
  const last = lastSetsFor(history, exercise.exerciseId, workout.id);
  const best = timed ? undefined : bestSet(history.filter((w) => w.id !== workout.id), exercise.exerciseId);
  const allDone = exercise.sets.every((s) => s.done || s.skipped) && exercise.sets.some((s) => s.done);
  const replacedFrom = exercise.replacedFrom ? getExercise(exercise.replacedFrom)?.name : undefined;
  let workIndex = 0;

  return (
    <section
      className={[styles.exerciseCard, allDone && styles.exerciseDone, exercise.skipped && styles.exerciseSkipped].filter(Boolean).join(' ')}
      aria-label={info?.name}
      data-state={exercise.skipped ? 'skipped' : allDone ? 'done' : 'open'}
      data-entry={exercise.id}
    >
      <header className={styles.exerciseHeader}>
        <div className={styles.exerciseHeading}>
          {(exercise.supersetGroup || replacedFrom || exercise.extra) && (
            <div className={styles.badges}>
              {exercise.supersetGroup && <span className={styles.badge}>Superset {exercise.supersetGroup}</span>}
              {replacedFrom && <span className={styles.badge}>Ersetzt · statt {replacedFrom}</span>}
              {exercise.extra && !replacedFrom && <span className={styles.badge}>Zusätzlich</span>}
            </div>
          )}
          <button type="button" className={styles.exerciseName} onClick={onInfo} aria-label={`${info?.name ?? 'Übung'} – Anleitung`}>
            {info?.name ?? 'Übung'}
          </button>
          <p className={styles.muted}>
            {info?.muscle}
            {timed ? (exercise.planned?.durationMin ? ` · Ziel ${exercise.planned.durationMin} min` : '') : ` · Ziel ${exercise.repMin}–${exercise.repMax} Wdh.`}
          </p>
        </div>
        {allDone && <Icon name="check" size={20} className={styles.accentText} strokeWidth={2.4} />}
        <IconButton icon="more" label={`Optionen für ${info?.name ?? 'Übung'}`} onClick={onMenu} />
      </header>

      {exercise.skipped ? (
        <p className={styles.lastTime}>Ausgelassen – zählt nicht in dieses Training. Über „…“ kannst du sie doch machen.</p>
      ) : (
        <>
          {last ? (
            <p className={styles.lastTime}>
              Letztes Training: {last.map((s) => formatSet(s)).join(', ')}
              {best && (
                <>
                  <br />
                  Bestleistung: {formatSet(best)}
                </>
              )}
            </p>
          ) : (
            <p className={styles.lastTime}>{timed ? 'Trag die Minuten ein, die du machst.' : `Erstes Mal – wähle ein Gewicht, mit dem du ${exercise.repMax} saubere Wiederholungen schaffst.`}</p>
          )}

          {exercise.prescription && <PrescriptionBar workoutId={workout.id} exercise={exercise} />}

          <div className={styles.setTable} role="table" aria-label={`Sätze ${info?.name ?? ''}`}>
            <div className={styles.setHead} role="row">
              <span role="columnheader">Satz</span>
              <span role="columnheader">Vorher</span>
              <span role="columnheader">{timed ? 'Min' : info?.bodyweight ? '+ kg' : 'kg'}</span>
              <span role="columnheader">{timed ? 'km' : 'Wdh.'}</span>
              <span role="columnheader" className="visually-hidden">
                Erledigt
              </span>
            </div>
            {exercise.sets.map((set, i) => {
              const label = set.type === 'working' ? String(++workIndex) : SET_TYPE_SHORT[set.type];
              const prev = last?.[Math.min(i, last.length - 1)];
              return (
                <div key={set.id} className={set.skipped ? styles.setRowSkipped : set.done ? styles.setRowDone : styles.setRow} role="row" data-type={set.type}>
                  <span role="cell">
                    <button type="button" className={styles.setIndex} data-type={set.type} aria-label={`Satz ${i + 1}: ${SET_TYPE_LABEL[set.type]}${set.skipped ? ', übersprungen' : ''} – Optionen`} onClick={() => onSetMenu(set.id)}>
                      {label}
                    </button>
                  </span>
                  <span role="cell" className={styles.prev}>
                    {prev ? (timed ? formatSet(prev) : prev.weightKg ? `${formatKg(prev.weightKg)}×${prev.reps ?? 0}` : `${prev.reps ?? 0}`) : '–'}
                  </span>
                  {timed ? (
                    <>
                      <NumberCell value={set.durationMin ?? null} placeholder={String(exercise.planned?.durationMin ?? 20)} label={`Minuten Satz ${i + 1}`} disabled={set.skipped} onCommit={(v) => updateSet(workout.id, exercise.id, set.id, { durationMin: v })} />
                      <NumberCell value={set.distanceKm ?? null} placeholder="–" label={`Kilometer Satz ${i + 1}`} disabled={set.skipped} onCommit={(v) => updateSet(workout.id, exercise.id, set.id, { distanceKm: v })} />
                    </>
                  ) : (
                    <>
                      <NumberCell value={set.weightKg} placeholder={info?.bodyweight ? '0' : '–'} label={`Gewicht Satz ${i + 1}`} disabled={set.skipped} onCommit={(v) => updateSet(workout.id, exercise.id, set.id, { weightKg: v })} />
                      <NumberCell value={set.reps} placeholder={String(exercise.repMax)} integer label={`Wiederholungen Satz ${i + 1}`} disabled={set.skipped} onCommit={(v) => updateSet(workout.id, exercise.id, set.id, { reps: v })} />
                    </>
                  )}
                  <span role="cell">
                    <button
                      type="button"
                      className={set.done ? styles.setCheckDone : styles.setCheck}
                      aria-pressed={set.done}
                      aria-label={`Satz ${i + 1} ${set.done ? 'nicht erledigt' : 'erledigt'}`}
                      disabled={set.skipped}
                      onClick={() => onSetDone(set)}
                    >
                      <Icon name={set.skipped ? 'minus' : 'check'} size={20} strokeWidth={2.6} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
          <div className={styles.setActions}>
            <Button variant="ghost" size="sm" icon="plus" onClick={() => addSet(workout.id, exercise.id)}>
              Satz
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

const CHANGE_ICON: Record<string, string> = { increase: '📈', reps: '➕', hold: '⏸️', reduce: '📉' };

/**
 * The suggestion for this exercise and why – the sets are prefilled with it.
 * Übernehmen keeps it, Ändern jumps into the first open value, "Wie letztes
 * Mal" declines it (last session's values). The decision is stored and
 * shapes the next suggestion.
 */
function PrescriptionBar({ workoutId, exercise }: { workoutId: string; exercise: WorkoutExercise }) {
  const p = exercise.prescription!;
  if (p.change === 'first') return null;
  if (p.change === 'same') return <p className={styles.rxSame}>{p.reason}</p>;
  const value = p.durationMin ? `${formatKg(p.durationMin)} min` : formatSet({ weightKg: p.weightKg, reps: p.reps });
  if (p.decision) {
    const word = p.decision === 'accepted' ? `Vorschlag übernommen · ${value}` : p.decision === 'declined' ? 'Wie letztes Mal – Vorschlag nicht übernommen' : 'Vorschlag von dir angepasst';
    return (
      <p className={styles.rxDone} data-decision={p.decision}>
        {p.decision === 'accepted' ? '✓' : '↩'} {word}
      </p>
    );
  }
  const edit = () => {
    const input = document.querySelector<HTMLInputElement>(`section[data-entry="${exercise.id}"] input:not(:disabled)`);
    input?.focus();
  };
  return (
    <div className={styles.rx} data-change={p.change} role="group" aria-label={`Vorschlag: ${value}`}>
      <div className={styles.rxHead}>
        <span aria-hidden>{CHANGE_ICON[p.change]}</span>
        <strong>
          Vorschlag: {value}
          <span className={styles.rxDelta}>{changeLabel(p)}</span>
        </strong>
      </div>
      <p className={styles.rxReason}>{p.reason}</p>
      <div className={styles.proposalActions}>
        <Button size="sm" onClick={() => decidePrescription(workoutId, exercise.id, 'accepted')}>
          Übernehmen
        </Button>
        <Button size="sm" variant="secondary" onClick={edit}>
          Ändern
        </Button>
        <Button size="sm" variant="ghost" onClick={() => decidePrescription(workoutId, exercise.id, 'declined')}>
          Wie letztes Mal
        </Button>
      </div>
    </div>
  );
}

interface NumberCellProps {
  value: number | null;
  placeholder: string;
  label: string;
  integer?: boolean;
  disabled?: boolean;
  onCommit: (v: number | null) => void;
}

/** Keeps a local draft so typing "82," works; commits valid numbers immediately. */
function NumberCell({ value, placeholder, label, integer, disabled, onCommit }: NumberCellProps) {
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
        disabled={disabled}
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

/** Starts by itself after a set; −30 / +30 s adjust it, "Überspringen" ends it. */
/** RIR 0 / 1 / 2 / 3 / 4+ – stored as RPE (domain/effort.ts); tapping the chosen one again clears it. */
function RirChips({ rpe, onPick, compact }: { rpe: number | undefined; onPick: (rpe: number | null) => void; compact?: boolean }) {
  const chosen = rirChoice(rpe);
  return (
    <div className={compact ? styles.rirRow : styles.planDays} role="group" aria-label="Wiederholungen in Reserve">
      {RIR_OPTIONS.map((r) =>
        compact ? (
          <button key={r} type="button" className={chosen === r ? styles.rirActive : styles.rir} aria-pressed={chosen === r} aria-label={`RIR ${rirLabel(r)}`} onClick={() => onPick(chosen === r ? null : rpeFromRir(r))}>
            {rirLabel(r)}
          </button>
        ) : (
          <Chip key={r} selected={chosen === r} onClick={() => onPick(chosen === r ? null : rpeFromRir(r))}>
            {rirLabel(r)}
          </Chip>
        ),
      )}
    </div>
  );
}

function RestTimer({ rest, now, onChange, rpe, onRir }: { rest: Rest; now: number; onChange: (r: Rest | null) => void; rpe?: number; onRir?: (rpe: number | null) => void }) {
  // `now` ticks once per second and can be up to 1 s old when the set is ticked – never show more than the rest itself.
  const remaining = Math.min(rest.total, Math.ceil((rest.endsAt - now) / 1000));
  const over = remaining <= 0;

  useEffect(() => {
    if (over) navigator.vibrate?.([120, 80, 120]);
  }, [over]);

  useEffect(() => {
    if (!over) return;
    const id = window.setTimeout(() => onChange(null), 4000);
    return () => window.clearTimeout(id);
  }, [over, onChange]);

  const shift = (sec: number) => onChange({ ...rest, endsAt: rest.endsAt + sec * 1000, total: Math.max(1, rest.total + sec) });
  return (
    <div className={over ? `${styles.rest} ${styles.restOver}` : styles.rest} role="timer" aria-live="off" aria-label="Pause">
      <div className={styles.restFill} style={{ width: `${over ? 100 : Math.min(100, (1 - remaining / rest.total) * 100)}%` }} />
      <div className={styles.restTop}>
        <span className={styles.restLabel}>{over ? 'Pause vorbei – weiter geht’s' : 'Pause'}</span>
        {rest.next && <span className={styles.restNext}>Als Nächstes: {rest.next}</span>}
      </div>
      {onRir && !over && (
        <div className={styles.restRir}>
          <span>Wie viele wären noch gegangen?</span>
          <RirChips rpe={rpe} onPick={onRir} compact />
        </div>
      )}
      <div className={styles.restControls}>
        {!over && <strong className={styles.restTime}>{formatClock(remaining)}</strong>}
        {!over && (
          <button type="button" className={styles.restBtn} aria-label="30 Sekunden weniger" onClick={() => shift(-30)}>
            −30
          </button>
        )}
        {!over && (
          <button type="button" className={styles.restBtn} aria-label="30 Sekunden mehr" onClick={() => shift(30)}>
            +30
          </button>
        )}
        <button type="button" className={styles.restBtn} onClick={() => onChange(null)}>
          {over ? 'OK' : 'Überspringen'}
        </button>
      </div>
    </div>
  );
}
