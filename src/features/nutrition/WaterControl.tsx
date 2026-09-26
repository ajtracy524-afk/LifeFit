import { useId } from 'react';
import type { ISODate } from '../../domain/types';
import { formatLitres, waterOn } from '../../domain/water';
import { href } from '../../lib/router';
import { withUndo } from '../../lib/undo';
import { addWaterMl } from '../../store/actions';
import { useAppState } from '../../store/store';
import styles from './nutrition.module.css';

/** Glasses shown without a goal – just a friendly scale, not a target. */
const DEFAULT_GLASSES = 8;
/** More than this many 250-ml glasses get too narrow to tap on a phone – then 500-ml bottles are shown. */
const MAX_GLASSES = 8;
/** The quick button always adds one glass – the fine step, whatever the bottle size. */
const STEP_ML = 250;

/**
 * Water at a glance: goal · drunk · left, and one tap per glass. Tapping an
 * empty glass fills up to it, tapping the last full one takes it back. The
 * goal is the user's own tracking value (profile) – no health claims.
 */
export function WaterControl({ date }: { date: ISODate }) {
  const state = useAppState();
  const ml = waterOn(state, date);
  const goal = state.nutritionProfile?.waterGoalMl;
  // One glass = 250 ml; big goals use 500 ml bottles so the row stays short.
  const unit = goal && goal / 250 > MAX_GLASSES ? 500 : 250;
  const count = goal ? Math.max(1, Math.ceil(goal / unit)) : DEFAULT_GLASSES;
  const full = Math.floor(ml / unit);
  const left = goal ? Math.max(0, goal - ml) : undefined;

  const setTo = (next: number) => {
    const delta = next - ml;
    if (delta === 0) return;
    withUndo(`Wasser ${delta > 0 ? '+' : '−'}${Math.abs(delta)} ml · ${formatLitres(next)}`, () => addWaterMl(date, delta));
  };
  const tap = (i: number) => setTo(i === full - 1 ? ml - unit : (i + 1) * unit);

  return (
    <div className={styles.water}>
      <div className={styles.waterHead}>
        <strong>Wasser</strong>
        <span className={styles.waterValue} aria-live="polite">
          <strong>{formatLitres(ml)}</strong>
          {goal ? ` / ${formatLitres(goal)}` : ''}
        </span>
        <button type="button" className={styles.glassAdd} onClick={() => setTo(ml + STEP_ML)} aria-label={`${STEP_ML} ml Wasser hinzufügen`}>
          +{STEP_ML}
        </button>
      </div>
      {/* The bottles share the full width – fits every phone without wrapping. */}
      <div className={styles.glasses} style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }} role="group" aria-label={`Wasser: ${unit} ml pro ${unit === 250 ? 'Glas' : 'Flasche'}`}>
        {Array.from({ length: count }, (_, i) => {
          const level = i < full ? 1 : i === full ? (ml % unit) / unit : 0;
          // Beyond the goal every bottle is full – tapping one then sets that level.
          const last = i === full - 1;
          return (
            <button
              key={i}
              type="button"
              className={styles.glass}
              onClick={() => tap(i)}
              aria-label={last ? `${unit} ml weniger` : i < full ? `Wasser auf ${formatLitres((i + 1) * unit)} setzen` : `Wasser auf ${formatLitres((i + 1) * unit)}`}
            >
              <Bottle level={level} />
            </button>
          );
        })}
      </div>
      <p className={styles.waterLeft}>
        {left === undefined ? (
          <a className={styles.waterGoalLink} href={href('profile', { section: 'water' })}>
            Tagesziel festlegen
          </a>
        ) : left === 0 ? (
          `Tagesziel erreicht ✓${goal && ml > goal ? ` · ${formatLitres(ml - goal)} darüber` : ''}`
        ) : (
          `Noch ${formatLitres(left)} · ${Math.ceil(left / unit)} ${unit === 250 ? (Math.ceil(left / unit) === 1 ? 'Glas' : 'Gläser') : Math.ceil(left / unit) === 1 ? 'Flasche' : 'Flaschen'}`
        )}
      </p>
    </div>
  );
}

/** A small bottle, filled to `level` (0 … 1). */
function Bottle({ level }: { level: number }) {
  const clip = `bottle${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const top = 7 + 21 * (1 - level);
  return (
    <svg viewBox="0 0 16 30" width="16" height="30" aria-hidden>
      <defs>
        <clipPath id={clip}>
          <path d="M5.5 1.5h5v4l2.5 3v18.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 27V8.5l2.5-3z" />
        </clipPath>
      </defs>
      {level > 0 && <rect x="0" y={top} width="16" height={30 - top} fill="var(--water)" clipPath={`url(#${clip})`} />}
      <path d="M5.5 1.5h5v4l2.5 3v18.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 27V8.5l2.5-3z" fill="none" stroke={level > 0 ? 'var(--water)' : 'var(--text-3)'} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}
