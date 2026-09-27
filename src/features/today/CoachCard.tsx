import { useMemo, useState } from 'react';
import { DISCLAIMER, runEngine, type EngineAction, type EngineDomain, type Recommendation } from '../../domain/engine';
import { formatCostRange } from '../../domain/costs';
import { fmt } from '../../lib/format';
import { Icon } from '../../components/ui/Icon';
import { today } from '../../domain/dates';
import { navigate } from '../../lib/router';
import { withUndo } from '../../lib/undo';
import { applyEngineAction, dismissRecommendation } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import styles from './coach.module.css';

const VISIBLE = 3;

/**
 * Recommendations of the adaptive engine for ONE area of the app. Each screen
 * shows only what belongs to it; recommendations come with actions that run
 * through the cascade where they change the plan.
 */
export function CoachCard({ domains, title = 'Für dich' }: { domains: EngineDomain[]; title?: string }) {
  const state = useAppState();
  const t = today();
  const hour = new Date().getHours();
  const [expanded, setExpanded] = useState(false);
  const key = domains.join();

  // `key` stands in for the `domains` array (a new array each render).
  const recs = useMemo(() => runEngine(state, { date: t, hour, limit: 6, domains }), [state, t, hour, key]);

  // No data, no recommendation – the card simply does not appear.
  if (recs.length === 0) return null;
  const visible = expanded ? recs : recs.slice(0, VISIBLE);

  return (
    <Card className={styles.card}>
      <CardHeader title={title} meta={recs.length > 1 ? `${recs.length}` : undefined} />

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
      {domains.some((d) => d !== 'training') && <p className={styles.disclaimer}>{DISCLAIMER}</p>}
    </Card>
  );
}

function RecommendationItem({ rec }: { rec: Recommendation }) {
  const [showReasons, setShowReasons] = useState(false);
  // Meal suggestions with facts get the richer layout; everything else stays a row of buttons.
  const meals = rec.actions.filter((a): a is MealAction => (a.type === 'add_meal' || a.type === 'log_dish') && !!a.details);

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

      {meals.length > 0 ? (
        <MealSuggestions actions={meals} onRun={run} />
      ) : (
        rec.actions.length > 0 && (
          <div className={styles.actions}>
            {rec.actions.map((a, i) => (
              <Button key={a.label} size="sm" variant={i === 0 ? 'primary' : 'secondary'} onClick={() => run(a)} className={styles.action}>
                {a.label}
              </Button>
            ))}
          </div>
        )
      )}
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
    </li>
  );
}

type MealAction = Extract<EngineAction, { type: 'add_meal' | 'log_dish' }> & { details: NonNullable<Extract<EngineAction, { type: 'add_meal' }>['details']> };

/** A planned recipe is "eingeplant", an own dish is logged as eaten. */
const verb = (a: MealAction) => (a.type === 'log_dish' ? 'Erfassen' : 'Einplanen');
const key = (a: MealAction) => (a.type === 'log_dish' ? a.dishId : a.recipeId);

/**
 * The best meal first – with time, protein, kcal, price (only with enough
 * price data) and why it was chosen – then the alternatives as compact rows.
 */
function MealSuggestions({ actions, onRun }: { actions: MealAction[]; onRun: (a: EngineAction) => void }) {
  const [best, ...others] = actions;
  const d = best!.details;
  return (
    <div className={styles.suggestion}>
      <div className={styles.featured}>
        <strong className={styles.featuredTitle}>{d.title}</strong>
        <ul className={styles.facts} aria-label="Eckdaten">
          {d.prepMin !== undefined && (
            <li>
              <Icon name="clock" size={14} /> {d.prepMin} min
            </li>
          )}
          <li>{d.protein} g Protein</li>
          <li>{fmt.kcal(d.kcal)}</li>
          {d.cost && <li>{formatCostRange(d.cost)}</li>}
        </ul>
        {d.because.length > 0 && <p className={styles.because}>Empfohlen, weil {joinReasons(d.because.slice(0, 2))}.</p>}
        <Button size="sm" icon={best!.type === 'log_dish' ? 'check' : 'plus'} onClick={() => onRun(best!)} className={styles.featuredButton}>
          {verb(best!)}
        </Button>
      </div>
      {others.length > 0 && (
        <ul className={styles.alternatives} aria-label="Weitere passende Gerichte">
          {others.map((a) => (
            <li key={key(a)}>
              <button type="button" className={styles.alternative} onClick={() => onRun(a)} aria-label={`${a.details.title} ${verb(a).toLowerCase()}`}>
                <span className={styles.alternativeTitle}>{a.details.title}</span>
                <span className={styles.alternativeMeta}>
                  {[a.details.prepMin !== undefined && `${a.details.prepMin} min`, `${a.details.protein} g P`, fmt.kcal(a.details.kcal), a.details.cost && formatCostRange(a.details.cost)]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <Icon name="plus" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "a, b und c" */
function joinReasons(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}`;
}

function doneMessage(action: EngineAction): string {
  switch (action.type) {
    case 'add_meal':
      return 'Mahlzeit eingeplant – Einkaufsliste aktualisiert';
    case 'log_food':
    case 'log_dish':
      return 'Erfasst';
    case 'swap_meal':
      return 'Mahlzeit getauscht';
    case 'set_targets':
      return 'Kalorienziel angepasst';
    default:
      return 'Erledigt';
  }
}
