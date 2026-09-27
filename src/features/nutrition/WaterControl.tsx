import { useId, type CSSProperties } from 'react';
import type { ISODate } from '../../domain/types';
import { today } from '../../domain/dates';
import { formatLitres, waterOn, waterStreak, WATER_STREAK_MIN_DAYS } from '../../domain/water';
import { href } from '../../lib/router';
import { withUndo } from '../../lib/undo';
import { celebrate } from '../../lib/celebrate';
import { haptic, useCrossing, useIncrease } from '../../lib/motion';
import { CountUp } from '../../components/ui/CountUp';
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
 *
 * Motion: the bottle that was filled rises, a small wave runs over its
 * surface and bubbles go up; the litres count up. Reaching the goal (a real
 * crossing, by a tap) makes the row bounce and shows the water celebration.
 * Taking water back simply lowers the level – never a "negative" animation.
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
  // A real series from the stored day values (today only counts once reached) – shown from 2 days on.
  const streak = date === today() ? waterStreak(state, date, goal) : 0;
  const grew = useIncrease(ml);
  const won = useCrossing(!!goal && ml >= goal);
  // The bottle whose level just rose (the top of the water).
  const top = Math.min(count - 1, ml % unit === 0 ? full - 1 : full);

  const setTo = (next: number) => {
    const delta = next - ml;
    if (delta === 0) return;
    const done = withUndo(`Wasser ${delta > 0 ? '+' : '−'}${Math.abs(delta)} ml · ${formatLitres(next)}`, () => addWaterMl(date, delta));
    if (!done || delta < 0) return;
    if (goal && ml < goal && next >= goal) celebrate({ kind: 'water', icon: '💧', title: 'Wasserziel erreicht', detail: `${formatLitres(next)} heute`, level: 3 });
    else haptic(1);
  };
  const tap = (i: number) => setTo(i === full - 1 ? ml - unit : (i + 1) * unit);

  return (
    <div className={styles.water}>
      <div className={styles.waterHead}>
        <strong>Wasser</strong>
        <span className={styles.waterValue} aria-live="polite">
          <strong>
            <CountUp value={ml} format={formatLitres} />
          </strong>
          {goal ? ` / ${formatLitres(goal)}` : ''}
        </span>
        <button type="button" className={styles.glassAdd} onClick={() => setTo(ml + STEP_ML)} aria-label={`${STEP_ML} ml Wasser hinzufügen`}>
          +{STEP_ML}
          {grew > 0 && <span key={grew} className={styles.addRipple} aria-hidden />}
        </button>
      </div>
      {/* The bottles share the full width – fits every phone without wrapping. */}
      <div
        key={`glasses-${won}`}
        className={won > 0 ? `${styles.glasses} ${styles.waterWin}` : styles.glasses}
        style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
        role="group"
        aria-label={`Wasser: ${unit} ml pro ${unit === 250 ? 'Glas' : 'Flasche'}`}
      >
        {Array.from({ length: count }, (_, i) => {
          const level = i < full ? 1 : i === full ? (ml % unit) / unit : 0;
          // Beyond the goal every bottle is full – tapping one then sets that level.
          const last = i === full - 1;
          return (
            <button
              key={i}
              type="button"
              className={styles.glass}
              style={{ '--i': i } as CSSProperties}
              onClick={() => tap(i)}
              aria-label={last ? `${unit} ml weniger` : i < full ? `Wasser auf ${formatLitres((i + 1) * unit)} setzen` : `Wasser auf ${formatLitres((i + 1) * unit)}`}
            >
              <Bottle level={level} wave={i === top ? grew : 0} />
            </button>
          );
        })}
      </div>
      <p className={styles.waterLeft}>
        <span key={left === 0 ? 'reached' : 'open'} className={left === 0 ? styles.waterReached : undefined}>
          {left === undefined ? (
            <a className={styles.waterGoalLink} href={href('profile', { section: 'water' })}>
              Tagesziel festlegen
            </a>
          ) : left === 0 ? (
            `Tagesziel erreicht 🎉${goal && ml > goal ? ` · ${formatLitres(ml - goal)} darüber` : ''}`
          ) : (
            `Noch ${formatLitres(left)} · ${Math.ceil(left / unit)} ${unit === 250 ? (Math.ceil(left / unit) === 1 ? 'Glas' : 'Gläser') : Math.ceil(left / unit) === 1 ? 'Flasche' : 'Flaschen'}`
          )}
        </span>
        {streak >= WATER_STREAK_MIN_DAYS && goal && (
          <span className={styles.waterStreak}>
            {streak} Tage in Folge ≥ {formatLitres(goal)}
          </span>
        )}
      </p>
    </div>
  );
}

/** A small bottle, filled to `level` (0 … 1). `wave`: counter – each increase plays the wave + bubbles once. */
function Bottle({ level, wave = 0 }: { level: number; wave?: number }) {
  const clip = `bottle${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const surface = 28 - 21 * level;
  return (
    <svg viewBox="0 0 16 30" width="16" height="30" aria-hidden>
      <defs>
        <clipPath id={clip}>
          <path d="M5.5 1.5h5v4l2.5 3v18.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 27V8.5l2.5-3z" />
        </clipPath>
      </defs>
      {/* The water is one rect scaled from the bottom – so filling and emptying glide (CSS transition). */}
      <rect className={styles.bottleWater} x="0" y="7" width="16" height="21" fill="var(--water)" clipPath={`url(#${clip})`} style={{ transform: `scaleY(${level})` }} />
      {wave > 0 && level > 0 && (
        <g key={wave} clipPath={`url(#${clip})`}>
          <g transform={`translate(0 ${surface})`}>
            <path className={styles.bottleWave} d="M-16 0q2-1.6 4 0t4 0t4 0t4 0t4 0t4 0t4 0t4 0v3h-32z" fill="var(--water)" />
          </g>
          {[5.5, 8.5, 10.5].map((x, i) => (
            <circle key={x} className={styles.bottleBubble} cx={x} cy="26.5" r={i === 1 ? 1.1 : 0.8} style={{ '--rise': `${Math.min(-2, surface - 26)}px`, '--delay': `${i * 90}ms` } as CSSProperties} />
          ))}
        </g>
      )}
      <path
        d="M5.5 1.5h5v4l2.5 3v18.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 27V8.5l2.5-3z"
        fill="none"
        stroke={level > 0 ? 'var(--water)' : 'var(--text-3)'}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
