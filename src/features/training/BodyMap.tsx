import { MUSCLE_LABEL } from '../../domain/exerciseLibrary';
import type { MuscleGroup } from '../../domain/types';
import styles from './library.module.css';

interface Props {
  primary: MuscleGroup;
  secondary: MuscleGroup[];
  size?: 'sm' | 'md';
}

type Zone = { group: MuscleGroup | null; x: number; y: number; w: number; h: number; r?: number };

/**
 * A stylized figure, front and back, built from rounded zones: the primary
 * muscle in the accent colour, secondary ones lighter, the rest neutral. It
 * shows WHERE an exercise works – an orientation, not an anatomical chart.
 */
const FRONT: Zone[] = [
  { group: 'shoulders', x: 17, y: 34, w: 16, h: 13, r: 7 },
  { group: 'shoulders', x: 57, y: 34, w: 16, h: 13, r: 7 },
  { group: 'chest', x: 32, y: 36, w: 13, h: 19, r: 5 },
  { group: 'chest', x: 45, y: 36, w: 13, h: 19, r: 5 },
  { group: 'core', x: 34, y: 57, w: 22, h: 30, r: 6 },
  { group: 'biceps', x: 15, y: 49, w: 11, h: 24, r: 5 },
  { group: 'biceps', x: 64, y: 49, w: 11, h: 24, r: 5 },
  { group: 'forearms', x: 12, y: 75, w: 10, h: 25, r: 5 },
  { group: 'forearms', x: 68, y: 75, w: 10, h: 25, r: 5 },
  { group: null, x: 33, y: 89, w: 24, h: 11, r: 5 },
  { group: 'quads', x: 31, y: 102, w: 13, h: 40, r: 6 },
  { group: 'quads', x: 46, y: 102, w: 13, h: 40, r: 6 },
  { group: null, x: 32, y: 146, w: 11, h: 36, r: 5 },
  { group: null, x: 47, y: 146, w: 11, h: 36, r: 5 },
];
const BACK: Zone[] = [
  { group: 'shoulders', x: 17, y: 34, w: 16, h: 13, r: 7 },
  { group: 'shoulders', x: 57, y: 34, w: 16, h: 13, r: 7 },
  { group: 'back', x: 32, y: 36, w: 26, h: 48, r: 7 },
  { group: 'triceps', x: 15, y: 49, w: 11, h: 24, r: 5 },
  { group: 'triceps', x: 64, y: 49, w: 11, h: 24, r: 5 },
  { group: 'forearms', x: 12, y: 75, w: 10, h: 25, r: 5 },
  { group: 'forearms', x: 68, y: 75, w: 10, h: 25, r: 5 },
  { group: 'glutes', x: 32, y: 86, w: 13, h: 16, r: 6 },
  { group: 'glutes', x: 45, y: 86, w: 13, h: 16, r: 6 },
  { group: 'hamstrings', x: 31, y: 104, w: 13, h: 38, r: 6 },
  { group: 'hamstrings', x: 46, y: 104, w: 13, h: 38, r: 6 },
  { group: 'calves', x: 32, y: 146, w: 11, h: 36, r: 5 },
  { group: 'calves', x: 47, y: 146, w: 11, h: 36, r: 5 },
];

export function BodyMap({ primary, secondary, size = 'md' }: Props) {
  const level = (g: MuscleGroup | null) => (g && g === primary ? 'primary' : g && secondary.includes(g) ? 'secondary' : 'none');
  const label =
    primary === 'cardio'
      ? 'Ausdauer – der ganze Körper arbeitet'
      : `Trainiert: ${MUSCLE_LABEL[primary]} (hauptsächlich)${secondary.length ? `, ${secondary.filter((g) => g !== 'cardio').map((g) => MUSCLE_LABEL[g]).join(', ')}` : ''}`;
  const figure = (zones: Zone[], dx: number, caption: string) => (
    <g transform={`translate(${dx} 0)`}>
      <circle cx="45" cy="18" r="11" className={styles.zone} data-level="none" />
      {zones.map((z, i) => (
        <rect key={i} x={z.x} y={z.y} width={z.w} height={z.h} rx={z.r ?? 4} className={styles.zone} data-level={primary === 'cardio' ? 'secondary' : level(z.group)} />
      ))}
      {size === 'md' && (
        <text x="45" y="197" textAnchor="middle" className={styles.mapCaption}>
          {caption}
        </text>
      )}
    </g>
  );
  return (
    <svg className={size === 'sm' ? styles.bodyMapSm : styles.bodyMap} viewBox="0 0 190 200" role="img" aria-label={label}>
      {figure(FRONT, 0, 'Vorne')}
      {figure(BACK, 100, 'Hinten')}
    </svg>
  );
}
