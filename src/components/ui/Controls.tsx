import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon } from './Icon';
import styles from './Controls.module.css';

// ---------- Segmented control ----------

interface SegmentedProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}

export function Segmented<T extends string>({ options, value, onChange, label }: SegmentedProps<T>) {
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          className={o.value === value ? styles.segmentActive : styles.segment}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Stepper ----------

interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  step: number;
  min: number;
  max: number;
  format?: (v: number) => string;
  label: string;
}

export function Stepper({ value, onChange, step, min, max, format = String, label }: StepperProps) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v / step) * step)));
  return (
    <div className={styles.stepper} role="group" aria-label={label}>
      <button type="button" className={styles.stepBtn} onClick={() => set(value - step)} disabled={value <= min} aria-label={`${label} verringern`}>
        <Icon name="minus" size={18} />
      </button>
      <output className={styles.stepValue} aria-live="polite">
        {format(value)}
      </output>
      <button type="button" className={styles.stepBtn} onClick={() => set(value + step)} disabled={value >= max} aria-label={`${label} erhöhen`}>
        <Icon name="plus" size={18} />
      </button>
    </div>
  );
}

// ---------- Chip ----------

interface ChipProps {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}

export function Chip({ selected, onClick, children }: ChipProps) {
  return (
    <button type="button" className={selected ? styles.chipActive : styles.chip} aria-pressed={selected} onClick={onClick}>
      {selected && <Icon name="check" size={16} />}
      {children}
    </button>
  );
}

// ---------- Weekday picker ----------

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

interface WeekdayPickerProps {
  value: number[];
  onChange: (days: number[]) => void;
}

/** Multi-select Monday (0) … Sunday (6), always returned sorted. */
export function WeekdayPicker({ value, onChange }: WeekdayPickerProps) {
  return (
    <div className={styles.weekdays} role="group" aria-label="Trainingstage">
      {WEEKDAYS.map((label, i) => {
        const on = value.includes(i);
        return (
          <button
            key={label}
            type="button"
            className={on ? styles.weekdayActive : styles.weekday}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((d) => d !== i) : [...value, i].sort((a, b) => a - b))}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Option card (large single choice) ----------

interface OptionCardProps {
  selected: boolean;
  onClick: () => void;
  title: string;
  description?: string;
  emoji?: string;
}

export function OptionCard({ selected, onClick, title, description, emoji }: OptionCardProps) {
  return (
    <button type="button" className={selected ? styles.optionActive : styles.option} aria-pressed={selected} onClick={onClick}>
      {emoji && <span className={styles.optionEmoji}>{emoji}</span>}
      <span className={styles.optionText}>
        <strong>{title}</strong>
        {description && <span>{description}</span>}
      </span>
      <span className={styles.radio} aria-hidden>
        {selected && <Icon name="check" size={16} strokeWidth={2.4} />}
      </span>
    </button>
  );
}

// ---------- Field ----------

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  suffix?: string;
  error?: string;
  hint?: string;
}

export function Field({ label, suffix, error, hint, className, ...input }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={error ? styles.inputWrapError : styles.inputWrap}>
        <input id={id} className={styles.input} aria-invalid={!!error} aria-describedby={describedBy} {...input} />
        {suffix && <span className={styles.suffix}>{suffix}</span>}
      </div>
      {error ? (
        <span id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </span>
      ) : (
        hint && (
          <span id={`${id}-hint`} className={styles.hint}>
            {hint}
          </span>
        )
      )}
    </div>
  );
}

/** Parses German number input ("78,5") – returns NaN for invalid input. */
export function parseNumber(value: string): number {
  if (value.trim() === '') return NaN;
  return Number(value.replace(',', '.'));
}
