import { useEffect, useState, type ReactNode } from 'react';
import { getExercise } from '../../data/exercises';
import { DIFFICULTY_LABEL, EQUIPMENT_LABEL, MUSCLE_LABEL, TYPE_LABEL } from '../../domain/exerciseLibrary';
import { formatSet, lastSetsFor } from '../../domain/training';
import { bestSet, exerciseHistory } from '../../domain/trainingHistory';
import { useAppState } from '../../store/store';
import { Sheet } from '../../components/ui/Sheet';
import { BodyMap } from './BodyMap';
import { MiniChart } from './MiniChart';
import styles from './library.module.css';

interface Props {
  exerciseId: string | null;
  onClose: () => void;
  /** Optional action for the shown exercise (e.g. "Diese Übung nehmen" when replacing). */
  action?: (exerciseId: string) => ReactNode;
}

/**
 * One exercise, understandable at a glance: where it works (figure), with
 * what, how hard to learn, how it is done, what to watch out for, what trains
 * the same – and the user's own numbers (last time, best, trend).
 */
export function ExerciseSheet({ exerciseId, onClose, action }: Props) {
  const state = useAppState();
  const [shown, setShown] = useState(exerciseId);
  useEffect(() => setShown(exerciseId), [exerciseId]);
  const ex = shown ? getExercise(shown) : undefined;

  const history = ex ? exerciseHistory(state.workouts, ex.id) : [];
  const last = ex ? lastSetsFor(state.workouts, ex.id) : undefined;
  const best = ex ? bestSet(state.workouts, ex.id) : undefined;
  const weighted = history.some((h) => h.e1rm > 0);
  const chart = history.slice(-12).map((h) => ({ date: h.date, value: weighted ? h.e1rm : h.reps }));

  return (
    <Sheet open={!!ex} onClose={onClose} title={ex?.name ?? ''} subtitle={ex ? `${TYPE_LABEL[ex.type]} · ${EQUIPMENT_LABEL[ex.equipment]} · ${DIFFICULTY_LABEL[ex.difficulty]}` : undefined} footer={ex && action?.(ex.id)}>
      {ex && (
        <div className={styles.detail}>
          <div className={styles.detailHero}>
            <BodyMap primary={ex.primary} secondary={ex.secondary} />
            <div className={styles.muscles}>
              <p className={styles.detailLabel}>Hauptsächlich</p>
              <span className={styles.musclePrimary}>{MUSCLE_LABEL[ex.primary]}</span>
              {ex.secondary.length > 0 && (
                <>
                  <p className={styles.detailLabel}>Unterstützend</p>
                  <div className={styles.muscleList}>
                    {ex.secondary.map((g) => (
                      <span key={g} className={styles.muscleSecondary}>
                        {MUSCLE_LABEL[g]}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <p className={styles.detailLead}>{ex.description}</p>

          {(last || best) && (
            <div className={styles.personal} role="group" aria-label="Deine Werte">
              {last && (
                <div>
                  <span className={styles.detailLabel}>Letztes Training</span>
                  <strong>{last.map((s) => formatSet(s)).join(' · ')}</strong>
                </div>
              )}
              {best && ex.type === 'strength' && (
                <div>
                  <span className={styles.detailLabel}>Bestleistung</span>
                  <strong>{formatSet(best)}</strong>
                </div>
              )}
            </div>
          )}
          {chart.length >= 2 && (
            <div>
              <p className={styles.detailLabel}>{weighted ? 'Geschätztes 1RM je Training (kg)' : 'Wiederholungen je Training'}</p>
              <MiniChart points={chart} unit={weighted ? 'kg' : 'Wdh.'} label={weighted ? 'Geschätztes 1RM' : 'Wiederholungen'} />
            </div>
          )}

          <section>
            <h3 className={styles.detailHeading}>So geht’s</h3>
            <ol className={styles.steps}>
              {ex.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </section>

          {ex.tips.length > 0 && (
            <section>
              <h3 className={styles.detailHeading}>Darauf achten</h3>
              <ul className={styles.tips}>
                {ex.tips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </section>
          )}

          {ex.alternatives.length > 0 && (
            <section>
              <h3 className={styles.detailHeading}>Alternativen</h3>
              <div className={styles.altList}>
                {ex.alternatives
                  .map((id) => getExercise(id))
                  .filter((a) => !!a)
                  .map((a) => (
                    <button key={a!.id} type="button" className={styles.altChip} onClick={() => setShown(a!.id)}>
                      {a!.name}
                      <span>{EQUIPMENT_LABEL[a!.equipment]}</span>
                    </button>
                  ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Sheet>
  );
}
