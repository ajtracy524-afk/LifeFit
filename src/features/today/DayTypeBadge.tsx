import type { PlannedWorkout } from '../../domain/training';
import { estimateMinutes } from '../../domain/training';
import type { Workout } from '../../domain/types';
import { href } from '../../lib/router';
import { Icon } from '../../components/ui/Icon';
import styles from './today.module.css';

interface Props {
  session?: PlannedWorkout;
  completed?: Workout;
  running?: Workout;
}

/**
 * "Training" or "Ruhetag" at a glance. A training day links to what exists
 * already: the running session, the finished workout or the Training tab –
 * a rest day is plain information, nothing to tap.
 */
export function DayTypeBadge({ session, completed, running }: Props) {
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
      </span>
    </div>
  );
}
