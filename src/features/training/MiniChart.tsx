import { fmt, formatDateShort } from '../../lib/format';
import styles from './library.module.css';

interface Props {
  points: Array<{ date: string; value: number }>;
  unit: string;
  label: string;
}

const W = 300;
const H = 110;
const PAD = { top: 12, right: 10, bottom: 20, left: 34 };

/** One value per session as a line (plain SVG, scales with the container). Shown from two sessions on. */
export function MiniChart({ points, unit, label }: Props) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 1) {
    min -= 1;
    max += 1;
  }
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * (H - PAD.top - PAD.bottom);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = points[points.length - 1]!;
  return (
    <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: von ${fmt.int(points[0]!.value)} auf ${fmt.int(last.value)} ${unit}`}>
      <text x={PAD.left - 6} y={y(max) + 4} textAnchor="end" className={styles.chartAxis}>
        {fmt.int(max)}
      </text>
      <text x={PAD.left - 6} y={y(min) + 4} textAnchor="end" className={styles.chartAxis}>
        {fmt.int(min)}
      </text>
      <line x1={PAD.left} x2={W - PAD.right} y1={y(min)} y2={y(min)} className={styles.chartGrid} />
      <path d={path} className={styles.chartLine} />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.value)} r={i === points.length - 1 ? 4 : 2.5} className={styles.chartDot} />
      ))}
      <text x={PAD.left} y={H - 4} className={styles.chartAxis}>
        {formatDateShort(points[0]!.date)}
      </text>
      <text x={W - PAD.right} y={H - 4} textAnchor="end" className={styles.chartAxis}>
        {formatDateShort(last.date)}
      </text>
    </svg>
  );
}
