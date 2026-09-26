import type { ISODate } from '../../domain/types';
import { formatLitres, WATER_QUICK_ML, waterOn } from '../../domain/water';
import { href } from '../../lib/router';
import { withUndo } from '../../lib/undo';
import { addWaterMl } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Icon } from '../../components/ui/Icon';
import { ProgressBar } from '../../components/ui/Progress';
import styles from './nutrition.module.css';

/**
 * Water in one row: amount, personal goal, one tap per glass. No extra page,
 * no reminders, no health claims – the goal is the user's own number.
 */
export function WaterControl({ date }: { date: ISODate }) {
  const state = useAppState();
  const ml = waterOn(state, date);
  const goal = state.nutritionProfile?.waterGoalMl;
  const add = (delta: number) => withUndo(`Wasser ${delta > 0 ? '+' : '−'}${Math.abs(delta)} ml · ${formatLitres(Math.max(0, ml + delta))}`, () => addWaterMl(date, delta));

  return (
    <div className={styles.water}>
      <div className={styles.waterHead}>
        <span className={styles.waterIcon} aria-hidden>
          <Icon name="drop" size={18} />
        </span>
        <strong>Wasser</strong>
        <span className={styles.waterValue} aria-live="polite">
          <strong>{formatLitres(ml)}</strong>
          {goal ? ` / ${formatLitres(goal)}` : ''}
        </span>
      </div>
      {goal ? <ProgressBar value={ml} max={goal} color="#3b82c4" height={6} label="Wasser heute" /> : null}
      <div className={styles.waterButtons}>
        <button type="button" className={styles.waterMinus} onClick={() => add(-250)} disabled={ml === 0} aria-label="250 ml weniger">
          −250
        </button>
        {WATER_QUICK_ML.map((q) => (
          <button key={q} type="button" className={styles.waterBtn} onClick={() => add(q)} aria-label={`${q} ml Wasser hinzufügen`}>
            +{q >= 1000 ? `${q / 1000} L` : q}
          </button>
        ))}
      </div>
      {!goal && (
        <a className={styles.waterGoalLink} href={href('profile', { section: 'water' })}>
          Tagesziel festlegen
        </a>
      )}
    </div>
  );
}
