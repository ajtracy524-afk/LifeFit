import type { ReactNode } from 'react';
import styles from './Progress.module.css';

interface RingProps {
  value: number;
  max: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
  label: string;
}

/** Circular progress. Going over the target is shown calmly – the ring is simply full. */
export function ProgressRing({ value, max, size = 132, stroke = 12, children, label }: RingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <div className={styles.ring} style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <circle
          className={styles.ringValue}
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className={styles.ringCenter}>{children}</div>
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

export function ProgressBar({ value, max, color = 'var(--accent)', height = 8, label }: BarProps) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      className={styles.bar}
      style={{ height }}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
    >
      <div className={styles.barFill} style={{ width: `${pct}%`, background: color }} />
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

/** Protein · Kohlenhydrate · Fett side by side: value / target and a thin bar. No accordion. */
export function MacroStrip({ protein, carbs, fat, target }: MacroStripProps) {
  const items = [
    { label: 'Protein', value: protein, max: target.protein, color: 'var(--accent)' },
    { label: 'Kohlenhydrate', value: carbs, max: target.carbs, color: 'var(--carbs)' },
    { label: 'Fett', value: fat, max: target.fat, color: 'var(--fat)' },
  ];
  return (
    <div className={styles.macroStrip} role="group" aria-label="Makros">
      {items.map((m) => (
        <div key={m.label} className={styles.macroCol}>
          <span className={styles.macroColLabel}>{m.label}</span>
          <span className={styles.macroColValue}>
            <strong>{Math.round(m.value)}</strong> / {Math.round(m.max)} g
          </span>
          <ProgressBar value={m.value} max={m.max} color={m.color} height={5} label={m.label} />
        </div>
      ))}
    </div>
  );
}
