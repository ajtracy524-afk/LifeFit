import { useEffect, useMemo, useState } from 'react';
import { DISCLAIMER, runEngine, type EngineAction, type EngineDomain, type Recommendation, type RecommendationKind } from '../../domain/engine';
import { formatCostRange } from '../../domain/costs';
import { Icon } from '../../components/ui/Icon';
import { today } from '../../domain/dates';
import { navigate } from '../../lib/router';
import { withUndo } from '../../lib/undo';
import { applyEngineAction, dismissRecommendation, recordTopics } from '../../store/actions';
import { getState, useAppState } from '../../store/store';
import { celebrate } from '../../lib/celebrate';
import { dishEntry } from '../../domain/dishes';
import { runLog } from '../nutrition/logFeedback';
import { useEnergyText } from '../nutrition/useEnergyText';
import { changeWater } from '../nutrition/waterActions';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import styles from './coach.module.css';

const VISIBLE = 3;

/**
 * Recommendations of the adaptive engine for ONE area of the app. Each screen
 * shows only what belongs to it; recommendations come with actions that run
 * through the cascade where they change the plan.
 */
export function CoachCard({ domains, title = 'Für dich', kinds, show = VISIBLE }: { domains: EngineDomain[]; title?: string; kinds?: RecommendationKind[]; show?: number }) {
  const state = useAppState();
  const t = today();
  const now = new Date();
  const hour = now.getHours();
  // The exact minute: "Training in 45 min" and "Nach dem Training" (ended 17:58) depend on it. The card only
  // recomputes when the data changes (the engine takes ~1 ms), so there is nothing to save by rounding.
  const minute = now.getMinutes();
  const [expanded, setExpanded] = useState(false);
  const key = `${domains.join()}|${kinds?.join() ?? ''}`;

  // `key` stands in for the `domains` / `kinds` arrays (new arrays each render).
  const recs = useMemo(() => runEngine(state, { date: t, hour, minute, limit: 6, domains }).filter((r) => !kinds || kinds.includes(r.kind)), [state, t, hour, minute, key]);

  const visible = expanded ? recs : recs.slice(0, show);
  // The coach's memory: what was really on screen today (and which resolved patterns were acknowledged).
  const seenKey = visible.map((r) => r.id).join();
  useEffect(() => {
    const topics = visible.filter((r) => r.topic);
    if (!topics.length) return;
    recordTopics(
      t,
      topics.filter((r) => r.kind !== 'tip_progress').map((r) => r.topic!),
      topics.filter((r) => r.kind === 'tip_progress').map((r) => r.topic!),
    );
    // Only when what is visible changes.
  }, [seenKey, t]);

  // No data, no recommendation – the card simply does not appear.
  if (recs.length === 0) return null;

  return (
    <Card className={styles.card}>
      <CardHeader title={title} meta={recs.length > 1 ? `${recs.length}` : undefined} />

      <ul className={styles.list}>
        {visible.map((r) => (
          <RecommendationItem key={r.id} rec={r} />
        ))}
      </ul>

      {recs.length > show && (
        <button type="button" className={styles.more} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Weniger anzeigen' : `${recs.length - show} weitere`}
        </button>
      )}
      {domains.some((d) => d !== 'training') && <p className={styles.disclaimer}>{DISCLAIMER}</p>}
    </Card>
  );
}

function RecommendationItem({ rec }: { rec: Recommendation }) {
  const [showReasons, setShowReasons] = useState(false);
  // Number-free mode (E14): kcal parts of the engine texts are left out.
  const energy = useEnergyText();
  const message = energy.text(rec.message);
  const reasons = energy.texts(rec.reasons);
  // Meal suggestions with facts get the richer layout; everything else stays a row of buttons.
  const meals = rec.actions.filter((a): a is MealAction => (a.type === 'add_meal' || a.type === 'log_dish') && !!a.details);

  const run = (action: EngineAction) => {
    if (action.type === 'open') return navigate(action.route);
    // Water runs through the one water action (undo + the same feedback as the water block).
    if (action.type === 'add_water') return void changeWater(action.date, action.ml);
    if (action.type === 'snooze_water') return void applyEngineAction(action);
    if (action.type === 'start_workout') {
      applyEngineAction(action);
      return navigate('session');
    }
    // Logging an own dish is a real log: same loop as everywhere (feedback from its values, "wieder verwendet" otherwise).
    if (action.type === 'log_dish') {
      const s = getState();
      const dish = s.customDishes?.[action.dishId];
      const before = s.logEntries.filter((e) => e.dishId === action.dishId).length;
      runLog(action.date, doneMessage(action), dish ? dishEntry(dish, action.portions) : undefined, () => applyEngineAction(action), () =>
        dish ? { kind: 'dish', icon: '🍽️', title: before ? 'Wieder verwendet' : 'Erfasst', detail: `${dish.name}${before ? ` · ${before + 1}. Mal erfasst` : ''}`, level: 2 } : undefined,
      );
      return;
    }
    if (withUndo(doneMessage(action), () => applyEngineAction(action)) && action.type === 'add_meal') {
      celebrate({ kind: 'check', icon: '✓', title: 'Eingeplant', detail: action.details?.title ?? 'Einkaufsliste aktualisiert', level: 1 });
    }
  };

  return (
    <li className={`${styles.item} ${styles[rec.priority]}`}>
      <div className={styles.head}>
        <strong className={styles.title}>{energy.text(rec.title) ?? 'Hinweis zu deinem Tagesziel'}</strong>
        {rec.kind !== 'safety' && <IconButton icon="close" label="Ausblenden" onClick={() => dismissRecommendation(rec.id, rec.topic)} />}
      </div>
      {message && <p className={styles.message}>{message}</p>}

      {meals.length > 0 ? (
        <MealSuggestions actions={meals} onRun={run} />
      ) : (
        rec.actions.length > 0 && (
          <div className={styles.actions}>
            {rec.actions.map((a, i) => (
              <Button key={a.label} size="sm" variant={i === 0 ? 'primary' : 'secondary'} onClick={() => run(a)} className={styles.action}>
                {energy.text(a.label) ?? 'Übernehmen'}
              </Button>
            ))}
          </div>
        )
      )}
      {reasons.length > 0 && (
        <>
          <button type="button" className={styles.why} onClick={() => setShowReasons(!showReasons)} aria-expanded={showReasons}>
            Warum?
          </button>
          {showReasons && (
            <ul className={styles.reasons}>
              {reasons.map((reason) => (
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
  const energy = useEnergyText();
  const because = energy.texts(d.because);
  return (
    <div className={styles.suggestion}>
      {/* Three or more real reasons = an especially good fit: the card glows once. */}
      <div className={because.length >= 3 ? `${styles.featured} ${styles.bestFit}` : styles.featured} data-fit={because.length >= 3 ? "best" : undefined}>
        <strong className={styles.featuredTitle}>{d.title}</strong>
        <ul className={styles.facts} aria-label="Eckdaten">
          {d.prepMin !== undefined && (
            <li>
              <Icon name="clock" size={14} /> {d.prepMin} min
            </li>
          )}
          <li>{d.protein} g Protein</li>
          <li>{energy.kcal(d.kcal)}</li>
          {d.cost && <li>{formatCostRange(d.cost)}</li>}
        </ul>
        {because.length > 0 && <p className={styles.because}>Empfohlen, weil {joinReasons(because.slice(0, 2))}.</p>}
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
                  {[a.details.prepMin !== undefined && `${a.details.prepMin} min`, `${a.details.protein} g P`, energy.kcal(a.details.kcal), a.details.cost && formatCostRange(a.details.cost)]
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
    case 'set_program':
      return 'Trainingsplan angepasst – ab heute gilt der neue Plan';
    default:
      return 'Erledigt';
  }
}
