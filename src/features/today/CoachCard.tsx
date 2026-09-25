import { useMemo, useState } from 'react';
import { DISCLAIMER, runEngine, type EngineAction, type Recommendation } from '../../domain/engine';
import { today } from '../../domain/dates';
import { navigate } from '../../lib/router';
import { withUndo } from '../../lib/undo';
import { applyEngineAction, dismissRecommendation } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import styles from './coach.module.css';

const VISIBLE = 3;

/** Recommendations of the Adaptive Fitness Engine on the "Heute" screen. */
export function CoachCard() {
  const state = useAppState();
  const t = today();
  const hour = new Date().getHours();
  const [expanded, setExpanded] = useState(false);

  const recs = useMemo(() => runEngine(state, { date: t, hour, limit: 6 }), [state, t, hour]);

  // Available time is set per day on "Heute" (time budget) – no second time control here.
  if (recs.length === 0) return null;
  const visible = expanded ? recs : recs.slice(0, VISIBLE);

  return (
    <Card className={styles.card}>
      <CardHeader title="Für dich heute" meta={recs.length > 0 ? `${recs.length}` : undefined} />

      <ul className={styles.list}>
        {visible.map((r) => (
          <RecommendationItem key={r.id} rec={r} />
        ))}
      </ul>

      {recs.length > VISIBLE && (
        <button type="button" className={styles.more} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Weniger anzeigen' : `${recs.length - VISIBLE} weitere`}
        </button>
      )}
      <p className={styles.disclaimer}>{DISCLAIMER}</p>
    </Card>
  );
}

function RecommendationItem({ rec }: { rec: Recommendation }) {
  const [showReasons, setShowReasons] = useState(false);

  const run = (action: EngineAction) => {
    if (action.type === 'open') return navigate(action.route);
    if (action.type === 'start_workout') {
      applyEngineAction(action);
      return navigate('session');
    }
    withUndo(doneMessage(action), () => applyEngineAction(action));
  };

  return (
    <li className={`${styles.item} ${styles[rec.priority]}`}>
      <div className={styles.head}>
        <strong className={styles.title}>{rec.title}</strong>
        {rec.kind !== 'safety' && <IconButton icon="close" label="Ausblenden" onClick={() => dismissRecommendation(rec.id)} />}
      </div>
      <p className={styles.message}>{rec.message}</p>

      {rec.reasons.length > 0 && (
        <>
          <button type="button" className={styles.why} onClick={() => setShowReasons(!showReasons)} aria-expanded={showReasons}>
            Warum?
          </button>
          {showReasons && (
            <ul className={styles.reasons}>
              {rec.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {rec.actions.length > 0 && (
        <div className={styles.actions}>
          {rec.actions.map((a, i) => (
            <Button key={a.label} size="sm" variant={i === 0 ? 'primary' : 'secondary'} onClick={() => run(a)} className={styles.action}>
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </li>
  );
}

function doneMessage(action: EngineAction): string {
  switch (action.type) {
    case 'add_meal':
      return 'Mahlzeit eingeplant – Einkaufsliste aktualisiert';
    case 'log_food':
      return 'Erfasst';
    case 'swap_meal':
      return 'Mahlzeit getauscht';
    case 'set_targets':
      return 'Kalorienziel angepasst';
    default:
      return 'Erledigt';
  }
}
