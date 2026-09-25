import { daysBetween } from '../../domain/dates';
import type { ISODate } from '../../domain/types';
import { fmt, formatDateShort } from '../../lib/format';
import styles from './progress.module.css';

interface Point {
  date: ISODate;
  kg: number;
  trend: number;
}

interface WeightChartProps {
  points: Point[];
  target?: number;
}

const W = 320;
const H = 160;
const PAD = { top: 12, right: 12, bottom: 22, left: 36 };

/**
 * Daily weigh-ins as dots, the 7-day average as the line – the line is the message.
 * Plain SVG, scales to the container width.
 */
export function WeightChart({ points, target }: WeightChartProps) {
  if (points.length === 0) return null;

  const first = points[0]!.date;
  const last = points[points.length - 1]!.date;
  const span = Math.max(daysBetween(first, last), 1);
  const values = points.flatMap((p) => [p.kg, p.trend]);
  const showTarget = target !== undefined && Math.abs(target - values[values.length - 1]!) < 6;
  if (showTarget) values.push(target!);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 2) {
    const mid = (max + min) / 2;
    min = mid - 1;
    max = mid + 1;
  }
  min -= 0.3;
  max += 0.3;

  const x = (d: ISODate) => PAD.left + (daysBetween(first, d) / span) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * (H - PAD.top - PAD.bottom);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.trend).toFixed(1)}`).join(' ');
  const ticks = [max - 0.3, (max + min) / 2, min + 0.3];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.chart} role="img" aria-label={`Gewichtsverlauf, aktueller Trend ${fmt.kg(points[points.length - 1]!.trend)}`}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="1" />
          <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" className={styles.axis}>
            {fmt.dec(Math.round(v * 10) / 10)}
          </text>
        </g>
      ))}
      {showTarget && (
        <g>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(target!)} y2={y(target!)} stroke="var(--accent)" strokeDasharray="4 4" strokeWidth="1.2" />
          <text x={W - PAD.right} y={y(target!) - 5} textAnchor="end" className={styles.axisAccent}>
            Ziel
          </text>
        </g>
      )}
      {points.map((p) => (
        <circle key={p.date} cx={x(p.date)} cy={y(p.kg)} r="3" fill="var(--text-3)" opacity="0.45" />
      ))}
      {points.length > 1 && <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
      <circle cx={x(last)} cy={y(points[points.length - 1]!.trend)} r="5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
      <text x={PAD.left} y={H - 4} className={styles.axis}>
        {formatDateShort(first)}
      </text>
      <text x={W - PAD.right} y={H - 4} textAnchor="end" className={styles.axis}>
        {formatDateShort(last)}
      </text>
    </svg>
  );
}
