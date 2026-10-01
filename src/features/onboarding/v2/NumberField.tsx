import { useEffect, useId, useState } from 'react';
import { fmt } from '../../../lib/format';
import { parseNumber } from '../../../components/ui/Controls';
import { Icon } from '../../../components/ui/Icon';
import styles from './onboardingV2.module.css';

const dec = (n: number, digits = 1) => n.toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: digits });

// ---------- Number input with big −/+ ----------

export function NumberField({
  label,
  unit,
  value,
  step,
  start,
  decimals = 0,
  plausible,
  plain = false,
  hint,
  onChange,
}: {
  label: string;
  unit?: string;
  value: number | undefined;
  step: number;
  start: number;
  decimals?: number;
  plausible: readonly [number, number];
  /** Years: no thousands separator. */
  plain?: boolean;
  hint?: string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const show = (v: number | undefined) => (v === undefined ? '' : plain ? String(v) : decimals ? dec(v, decimals).replace(/,0$/, '') : String(v));
  const [text, setText] = useState(show(value));
  // A value changed elsewhere (e.g. the stepper) – show it.
  useEffect(() => setText((t) => (parseNumber(t) === value ? t : show(value))), [value]);
  const round = (v: number) => Math.round(v * 10 ** decimals) / 10 ** decimals;
  const commit = (v: number) => {
    const r = round(v);
    setText(show(r));
    onChange(r);
  };
  const n = parseNumber(text);
  const outside = Number.isFinite(n) && (n < plausible[0] || n > plausible[1]);
  return (
    <div className={styles.number}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.numberRow}>
        <button type="button" className={styles.numberBtn} aria-label={`${label} verringern`} onClick={() => commit((value ?? start) - step)}>
          <Icon name="minus" size={22} />
        </button>
        <span className={styles.numberInput}>
          <input
            id={id}
            inputMode={decimals ? 'decimal' : 'numeric'}
            value={text}
            placeholder={show(start)}
            aria-describedby={`${id}-hint`}
            onChange={(e) => {
              setText(e.target.value);
              const v = parseNumber(e.target.value);
              if (Number.isFinite(v) && v > 0) onChange(round(v));
            }}
          />
          {unit && <span>{unit}</span>}
        </span>
        <button type="button" className={styles.numberBtn} aria-label={`${label} erhöhen`} onClick={() => commit((value ?? start) + step)}>
          <Icon name="plus" size={22} />
        </button>
      </div>
      <p id={`${id}-hint`} className={outside ? styles.notice : styles.hint} role={outside ? 'status' : undefined}>
        {outside ? `Bitte kurz prüfen – üblich sind ${plain ? plausible[0] : fmt.int(plausible[0])}–${plain ? plausible[1] : fmt.int(plausible[1])}${unit ? ` ${unit}` : ''}. Du kannst trotzdem weiter.` : hint}
      </p>
    </div>
  );
}

