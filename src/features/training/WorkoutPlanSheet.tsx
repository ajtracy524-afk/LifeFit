import { weekDays, weekStart, weekdayIndex } from '../../domain/dates';
import type { PlannedWorkout } from '../../domain/training';
import { weekdayLong, weekdayShort } from '../../lib/format';
import { applyWithUndo } from '../../lib/undo';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Controls';
import { Sheet } from '../../components/ui/Sheet';
import styles from './training.module.css';

interface Props {
  /** Session to plan; `null` closes the sheet. */
  session: PlannedWorkout | null;
  /** All sessions of the session's week (incl. skipped) – to find free days. */
  week: PlannedWorkout[];
  today: string;
  onClose: () => void;
}

/**
 * Move or skip one session of this week. The sheet only picks the change –
 * the cascade adjusts day targets, servings and shopping and offers undo.
 */
export function WorkoutPlanSheet({ session, week, today, onClose }: Props) {
  const run = (ok: boolean) => ok && onClose();

  // Days from today on in the session's week that have no other session.
  const freeDays = session
    ? weekDays(weekStart(session.originalDate)).filter(
        (d) =>
          d >= today &&
          (d !== session.date || session.status === 'skipped') &&
          !week.some((w) => w.id !== session.id && w.status !== 'skipped' && w.date === d),
      )
    : [];
  const changed = session && session.status !== 'scheduled';
  const canRestore = changed && session.originalDate >= today;

  return (
    <Sheet
      open={!!session}
      onClose={onClose}
      title={session?.template.name ?? ''}
      subtitle={session ? subtitle(session) : undefined}
    >
      {session && (
        <div className={styles.planSheet}>
          <p className={styles.planLabel}>Verschieben auf</p>
          {freeDays.length > 0 ? (
            <div className={styles.planDays}>
              {freeDays.map((d) => (
                <Chip key={d} selected={false} onClick={() => run(applyWithUndo({ type: 'moveWorkout', slotId: session.id, toDate: d }))}>
                  {`${weekdayShort(weekdayIndex(d))} ${Number(d.slice(8))}.`}
                </Chip>
              ))}
            </div>
          ) : (
            <p className={styles.muted}>Diese Woche ist kein freier Tag mehr.</p>
          )}
          <p className={styles.muted}>Tagesziele, Portionen und Einkaufsliste passen sich automatisch an.</p>

          <div className={styles.planActions}>
            {canRestore && (
              <Button variant="secondary" block onClick={() => run(applyWithUndo({ type: 'restoreWorkout', slotId: session.id }))}>
                Wie geplant am {weekdayLong(weekdayIndex(session.originalDate))}
              </Button>
            )}
            {session.status !== 'skipped' && (
              <Button variant="secondary" block onClick={() => run(applyWithUndo({ type: 'skipWorkout', slotId: session.id }))}>
                Diese Woche ausfallen lassen
              </Button>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}

function subtitle(s: PlannedWorkout): string {
  const day = weekdayLong(weekdayIndex(s.date));
  if (s.status === 'skipped') return `Fällt diese Woche aus (war ${day})`;
  if (s.status === 'moved') return `${day} · ursprünglich ${weekdayLong(weekdayIndex(s.originalDate))}`;
  return day;
}
