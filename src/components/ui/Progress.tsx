import type { ReactNode } from 'react';
import { useCrossing, useIncrease } from '../../lib/motion';
import { CountUp } from './CountUp';
import styles from './Progress.module.css';

interface RingProps {
  value: number;
  max: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
  label: string;
  /** Goes up on every real increase – replays the short "impact" glow (see useIncrease). */
  impact?: number;
  /** Goes up when a goal is reached – replays the success sweep + ripple (see useCrossing). */
  success?: number;
  /** 'over': calmly amber instead of green – information, never an alarm. */
  tone?: 'default' | 'over';
}

/**
 * Circular progress. The arc sweeps to its new value; a real increase adds a
 * brief glow, reaching the goal a light sweep around the ring and a ripple.
 * Going over the target is shown calmly – full ring, amber, no red.
 */
export function ProgressRing({ value, max, size = 132, stroke = 12, children, label, impact = 0, success = 0, tone = 'default' }: RingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = max > 0 ? Math.min(value / max, 1) : 0;
  const color = tone === 'over' ? 'var(--carbs)' : 'var(--accent)';
  const arc = { cx: size / 2, cy: size / 2, r, fill: 'none', transform: `rotate(-90 ${size / 2} ${size / 2})` };
  return (
    <div className={styles.ring} style={{ width: size, height: size }} role="img" aria-label={label} data-impact={impact} data-success={success} data-tone={tone}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <circle className={styles.ringValue} {...arc} stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - ratio)} />
        {impact > 0 && <circle key={`i${impact}`} className={styles.ringImpact} {...arc} stroke={color} strokeWidth={stroke + 8} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - ratio)} />}
        {success > 0 && <circle key={`s${success}`} className={styles.ringSweep} {...arc} stroke="var(--on-accent)" strokeWidth={stroke - 4} strokeLinecap="round" strokeDasharray={`${c * 0.1} ${c}`} />}
      </svg>
      {success > 0 && <span key={`w${success}`} className={styles.ringWave} aria-hidden />}
      <div key={`c${impact}`} className={impact > 0 ? `${styles.ringCenter} ${styles.ringThump}` : styles.ringCenter}>
        {children}
      </div>
    </div>
  );
}

interface BarProps {
  value: number;
  max: number;
  color?: string;
  height?: number;
  label?: string;
}

/** Thin progress bar. The fill glides; every real increase adds a short shine running along the fill. */
export function ProgressBar({ value, max, color = 'var(--accent)', height = 8, label }: BarProps) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const grew = useIncrease(value);
  return (
    <div className={styles.bar} style={{ height }} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={Math.round(max)} aria-valuenow={Math.round(value)}>
      <div className={styles.barFill} style={{ width: `${pct}%`, background: color }}>
        {grew > 0 && <span key={grew} className={styles.barShine} />}
      </div>
    </div>
  );
}

interface MacroRowProps {
  label: string;
  value: number;
  target: number;
  unit?: string;
  color?: string;
}

export function MacroRow({ label, value, target, unit = 'g', color }: MacroRowProps) {
  return (
    <div className={styles.macroRow}>
      <div className={styles.macroText}>
        <span>{label}</span>
        <span className={styles.macroValue}>
          <strong>{Math.round(value)}</strong> / {Math.round(target)} {unit}
        </span>
      </div>
      <ProgressBar value={value} max={target} color={color} label={label} />
    </div>
  );
}

interface MacroStripProps {
  protein: number;
  carbs: number;
  fat: number;
  target: { protein: number; carbs: number; fat: number };
}

/**
 * Protein · Kohlenhydrate · Fett side by side: value / target and a thin bar.
 * Values glide, bars shine on every increase. Reaching the protein target is a
 * goal: the column gets a short "power" pulse and a check that snaps in –
 * carbs and fat have no "reached" moment, they are budgets, not goals.
 */
export function MacroStrip({ protein, carbs, fat, target }: MacroStripProps) {
  const proteinReached = target.protein > 0 && protein >= target.protein;
  const power = useCrossing(proteinReached);
  const items = [
    { label: 'Protein', value: protein, max: target.protein, color: 'var(--accent)', reached: proteinReached },
    { label: 'Kohlenhydrate', value: carbs, max: target.carbs, color: 'var(--carbs)', reached: false },
    { label: 'Fett', value: fat, max: target.fat, color: 'var(--fat)', reached: false },
  ];
  return (
    <div className={styles.macroStrip} role="group" aria-label="Makros">
      {items.map((m) => (
        <div
          key={m.reached && power ? `${m.label}-${power}` : m.label}
          className={[styles.macroCol, m.reached && styles.macroReached, m.reached && power > 0 && styles.macroPower].filter(Boolean).join(' ')}
        >
          <span className={styles.macroColLabel}>
            {m.label}
            {m.reached && (
              <span className={styles.macroCheck} aria-label=" – Ziel erreicht">
                {' '}
                ✓
              </span>
            )}
          </span>
          <span className={styles.macroColValue}>
            <strong>
              <CountUp value={m.value} />
            </strong>{' '}
            / {Math.round(m.max)} g
          </span>
          <ProgressBar value={m.value} max={m.max} color={m.color} height={5} label={m.label} />
        </div>
      ))}
    </div>
  );
}
