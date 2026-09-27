import type { CSSProperties } from 'react';
import styles from './Thermometer.module.css';

export type ThermoTone = 'green' | 'orange' | 'red' | 'none';
export type ThermoKind = 'min' | 'range' | 'max';

interface Props {
  label: string;
  /** "92 / 120 g" – already formatted. */
  value: string;
  message: string;
  tone: ThermoTone;
  kind?: ThermoKind;
  /** amount / reference (0 … 1.3); undefined = no bar (no data). */
  ratio?: number;
  /** For 'range': half band width relative to the reference (tolerance / reference). */
  band?: number;
  note?: string;
}

/** The scale shows up to 130 % of the reference, so "over" stays visible without breaking the bar. */
const SCALE = 1.3;
const TONE_WORD: Record<ThermoTone, string> = { green: 'im Bereich', orange: 'beobachten', red: 'außerhalb', none: 'ohne Bewertung' };

/**
 * One nutrient at a glance – value, a thermometer and a plain status:
 * the fill in the status colour, a marker where the reference is (for a
 * limit: the limit line; for a range: the green band), and the words. The
 * colour is never the only signal (dot + text + aria).
 */
export function Thermometer({ label, value, message, tone, kind = 'min', ratio, band, note }: Props) {
  const fill = ratio === undefined ? 0 : Math.min(SCALE, Math.max(0, ratio)) / SCALE;
  const mark = 1 / SCALE;
  return (
    <div className={styles.row} data-tone={tone} aria-label={`${label}: ${value}, ${message} (${TONE_WORD[tone]})`}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{value}</span>
      </div>
      {ratio !== undefined && (
        <div className={styles.track} aria-hidden>
          {kind === 'range' && band !== undefined && <span className={styles.band} style={{ left: `${((1 - band) / SCALE) * 100}%`, width: `${((2 * band) / SCALE) * 100}%` }} />}
          {kind === 'max' && <span className={styles.caution} style={{ left: `${(0.8 / SCALE) * 100}%`, width: `${((1 - 0.8) / SCALE) * 100}%` }} />}
          <span className={styles.fill} style={{ '--fill': fill } as CSSProperties} />
          <span className={kind === 'max' ? `${styles.mark} ${styles.limit}` : styles.mark} style={{ left: `${mark * 100}%` }} />
        </div>
      )}
      <div className={styles.status}>
        <span className={styles.dot} aria-hidden />
        <span>{message}</span>
      </div>
      {note && <p className={styles.note}>{note}</p>}
    </div>
  );
}
