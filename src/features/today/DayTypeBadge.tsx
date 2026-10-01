import type { PlannedWorkout } from '../../domain/training';
import { estimateMinutes } from '../../domain/training';
import type { Workout } from '../../domain/types';
import { href } from '../../lib/router';
import { isNumberFree } from '../../domain/numberFree';
import { useAppState } from '../../store/store';
import { Icon } from '../../components/ui/Icon';
import styles from './today.module.css';

interface Props {
  session?: PlannedWorkout;
  completed?: Workout;
  running?: Workout;
  /** Day target minus the stored target (kcal) – training bonus or the rest-day share of it. */
  targetDelta?: number;
  /** "Beintag", "Oberkörper" … of today's session. */
  load?: string;
}

/**
 * "Training" or "Ruhetag" at a glance. A training day links to what exists
 * already: the running session, the finished workout or the Training tab –
 * a rest day is plain information, nothing to tap.
 */
export function DayTypeBadge({ session, completed, running, targetDelta, load }: Props) {
  const numberFree = isNumberFree(useAppState());
  // Number-free mode (E14): the direction in words instead of kcal.
  const delta = targetDelta ? (numberFree ? `Tagesziel heute etwas ${targetDelta > 0 ? 'höher' : 'niedriger'}` : `Tagesziel ${targetDelta > 0 ? '+' : '−'}${Math.abs(targetDelta)} kcal`) : undefined;
  if (running || completed || session) {
    const target = running ? href('session') : completed ? href('workout', { id: completed.id }) : href('training');
    const title = running?.name ?? completed?.name ?? session?.template.name ?? 'Training';
    const meta = running ? 'läuft gerade – weiter' : completed ? 'erledigt ✓' : session ? `~${estimateMinutes(session.template)} min · ${session.template.exercises.length} Übungen` : '';
    return (
      <a href={target} className={`${styles.dayType} ${styles.dayTypeTraining}`} aria-label={`Heute Training: ${title}, ${meta}`}>
        <span className={styles.dayTypeIcon} aria-hidden>
          🏋️
        </span>
        <span className={styles.dayTypeText}>
          <span className={styles.dayTypeKicker}>Training{meta ? ` · ${meta}` : ''}</span>
          <strong>{title}</strong>
          {(load || delta) && <span className={styles.dayTypeNote}>{[load, delta && `${delta} (vor allem Kohlenhydrate)`].filter(Boolean).join(' · ')}</span>}
        </span>
        <Icon name="chevronRight" size={18} />
      </a>
    );
  }
  return (
    <div className={`${styles.dayType} ${styles.dayTypeRest}`} aria-label="Heute Ruhetag: Erholung">
      <span className={styles.dayTypeIcon} aria-hidden>
        🌿
      </span>
      <span className={styles.dayTypeText}>
        <span className={styles.dayTypeKicker}>Ruhetag · kein Training geplant</span>
        <strong>Erholung</strong>
        {delta && <span className={styles.dayTypeNote}>{delta} – Ausgleich zu den Trainingstagen, die Woche bleibt gleich</span>}
      </span>
    </div>
  );
}
