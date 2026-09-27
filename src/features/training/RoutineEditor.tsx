import { useState } from 'react';
import { findTemplate, getExercise } from '../../data/exercises';
import { estimateMinutes, isTimed } from '../../domain/training';
import type { TemplateExercise } from '../../domain/types';
import { navigate, useRoute } from '../../lib/router';
import { showToast } from '../../lib/toast';
import { withUndo } from '../../lib/undo';
import { deleteRoutine, saveRoutine, validRoutine } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Screen } from '../../components/Screen';
import { Button, IconButton } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Controls';
import { EmptyState } from '../../components/ui/Feedback';
import { ExercisePicker } from './ExerciseLibrary';
import styles from './training.module.css';

const GROUPS = 'ABCDEFGH';

/**
 * Create or edit an own routine: name, exercises with sets × rep range and
 * rest (cardio / mobility: minutes), order, supersets. `?id=routine:…` edits,
 * `?from=<template>` starts from a copy of a built-in session, nothing = new.
 */
export function RoutineEditor() {
  const { params } = useRoute();
  const state = useAppState();
  const id = params.get('id') ?? undefined;
  const existing = id ? state.routines[id] : undefined;
  const source = existing ?? (params.get('from') ? findTemplate(params.get('from')!) : undefined);
  const [name, setName] = useState(existing?.name ?? (source ? `${source.name} (Kopie)` : ''));
  const [exercises, setExercises] = useState<TemplateExercise[]>(() => source?.exercises.map((e) => ({ ...e })) ?? []);
  const [picking, setPicking] = useState(false);
  const [tried, setTried] = useState(false);

  if (id && !existing) {
    return (
      <Screen title="Routine">
        <EmptyState icon="dumbbell" title="Routine nicht gefunden" text="Sie wurde vielleicht gelöscht." action={<Button onClick={() => navigate('training')}>Zum Training</Button>} />
      </Screen>
    );
  }

  const error = validRoutine({ name, exercises });
  const patch = (i: number, p: Partial<TemplateExercise>) => setExercises((list) => list.map((e, k) => (k === i ? { ...e, ...p } : e)));
  const move = (i: number, d: -1 | 1) =>
    setExercises((list) => {
      const next = [...list];
      const [item] = next.splice(i, 1);
      next.splice(i + d, 0, item!);
      return next;
    });
  // Superset: this exercise and the next one share a group letter.
  const toggleSuperset = (i: number) =>
    setExercises((list) => {
      const a = list[i]!;
      const b = list[i + 1];
      if (!b) return list;
      const linked = !!a.supersetGroup && a.supersetGroup === b.supersetGroup;
      const used = new Set(list.map((e) => e.supersetGroup).filter(Boolean));
      const group = a.supersetGroup ?? [...GROUPS].find((g) => !used.has(g))!;
      return list.map((e, k) => (k === i + 1 ? { ...e, supersetGroup: linked ? undefined : group } : k === i ? { ...e, supersetGroup: linked && list[i - 1]?.supersetGroup !== group ? undefined : group } : e));
    });

  const save = () => {
    setTried(true);
    if (error) return;
    const saved = saveRoutine({ name, exercises }, existing?.id);
    if (!saved) return;
    showToast(existing ? 'Routine gespeichert' : 'Routine erstellt');
    navigate('training', undefined, { replace: true });
  };

  return (
    <Screen title={existing ? 'Routine bearbeiten' : 'Neue Routine'} eyebrow="Training" actions={<IconButton icon="close" label="Abbrechen" onClick={() => navigate('training')} />}>
      <Card>
        <Field label="Name" value={name} placeholder="z. B. Push – Brust & Schulter" onChange={(e) => setName(e.target.value)} error={tried && !name.trim() ? 'Bitte gib der Routine einen Namen.' : undefined} />
        {exercises.length > 0 && <p className={styles.muted}>{exercises.length} Übungen · ~{estimateMinutes({ exercises })} min</p>}
      </Card>

      {exercises.length === 0 ? (
        <Card>
          <EmptyState compact emoji="🏋️" title="Noch keine Übung" text="Füge die Übungen hinzu, die du in dieser Routine machst." />
        </Card>
      ) : (
        <ol className={styles.editorList}>
          {exercises.map((e, i) => {
            const info = getExercise(e.exerciseId);
            const timed = isTimed(e.exerciseId);
            const linkedNext = !!e.supersetGroup && exercises[i + 1]?.supersetGroup === e.supersetGroup;
            return (
              <li key={`${e.exerciseId}-${i}`} className={styles.editorItem}>
                <div className={styles.editorHead}>
                  <div className={styles.exerciseHeading}>
                    {e.supersetGroup && <span className={styles.badge}>Superset {e.supersetGroup}</span>}
                    <strong>{info?.name ?? 'Übung'}</strong>
                  </div>
                  <IconButton icon="chevronDown" label={`${info?.name} nach oben`} className={styles.up} onClick={() => move(i, -1)} disabled={i === 0} />
                  <IconButton icon="chevronDown" label={`${info?.name} nach unten`} onClick={() => move(i, 1)} disabled={i === exercises.length - 1} />
                  <IconButton icon="trash" label={`${info?.name} entfernen`} onClick={() => setExercises((list) => list.filter((_, k) => k !== i))} />
                </div>
                <div className={styles.editorFields}>
                  <SmallNumber label="Sätze" value={e.sets} onChange={(v) => patch(i, { sets: v })} />
                  {timed ? (
                    <SmallNumber label="Minuten" value={e.durationMin ?? 20} onChange={(v) => patch(i, { durationMin: v })} />
                  ) : (
                    <>
                      <SmallNumber label="Wdh. von" value={e.repMin} onChange={(v) => patch(i, { repMin: v })} />
                      <SmallNumber label="bis" value={e.repMax} onChange={(v) => patch(i, { repMax: v })} />
                    </>
                  )}
                  <SmallNumber label="Pause s" value={e.restSec} onChange={(v) => patch(i, { restSec: v })} />
                </div>
                {i < exercises.length - 1 && (
                  <button type="button" className={styles.linkButton} aria-pressed={linkedNext} onClick={() => toggleSuperset(i)}>
                    {linkedNext ? 'Superset mit nächster Übung lösen' : 'Mit nächster Übung als Superset'}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <Button variant="secondary" icon="plus" onClick={() => setPicking(true)}>
        Übung hinzufügen
      </Button>
      {tried && error && <p className={styles.errorText}>{error}</p>}
      <Button block size="lg" icon="check" onClick={save}>
        Routine speichern
      </Button>
      {existing && (
        <Button
          variant="ghost"
          className={styles.discard}
          onClick={() => {
            withUndo('Routine gelöscht', () => deleteRoutine(existing.id));
            navigate('training', undefined, { replace: true });
          }}
        >
          Routine löschen
        </Button>
      )}

      <ExercisePicker
        open={picking}
        title="Übung hinzufügen"
        onClose={() => setPicking(false)}
        onPick={(exerciseId) => {
          setExercises((list) => [...list, isTimed(exerciseId) ? { exerciseId, sets: 1, repMin: 0, repMax: 0, restSec: 60, durationMin: 20 } : { exerciseId, sets: 3, repMin: 8, repMax: 12, restSec: 90 }]);
          setPicking(false);
        }}
      />
    </Screen>
  );
}

function SmallNumber({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  return (
    <label className={styles.smallNumber}>
      <span>{label}</span>
      <input
        inputMode="numeric"
        value={draft}
        aria-label={label}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, 3);
          setDraft(v);
          if (v !== '') onChange(Number(v));
        }}
        onBlur={() => setDraft(String(value))}
      />
    </label>
  );
}
