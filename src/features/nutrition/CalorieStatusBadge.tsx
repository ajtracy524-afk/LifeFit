import { useMemo } from 'react';
import { calorieStatus, isDayFinished } from '../../domain/calorieStatus';
import { today } from '../../domain/dates';
import { plannedMealMacros } from '../../domain/nutrition';
import type { ISODate } from '../../domain/types';
import { useAppState } from '../../store/store';
import styles from './nutrition.module.css';

/**
 * Small status next to the calorie numbers ("Im Ziel 🎯", "Noch Platz" …) –
 * the same zone on Heute and Ernährung (domain/calorieStatus). Uses the eaten
 * total the screen already shows, plus today's still planned meals.
 */
export function CalorieStatusBadge({ date, eatenKcal, targetKcal }: { date: ISODate; eatenKcal: number; targetKcal: number }) {
  const state = useAppState();
  const planned = useMemo(
    () => state.plannedMeals.filter((m) => m.date === date && m.status === 'planned').reduce((sum, m) => sum + plannedMealMacros(m).kcal, 0),
    [state.plannedMeals, date],
  );
  const status = calorieStatus({ eaten: eatenKcal, planned, targetKcal, finished: isDayFinished(date, today(), new Date().getHours()) });
  if (!status) return null;
  return (
    // Keyed by the status: a change ("Noch Platz" → "Im Ziel") plays the short entrance again.
    <span key={status.key} className={`${styles.calorieBadge} ${styles[`tone_${status.tone}`]}`} role="status" aria-label={`${status.label.replace(' 🎯', '')}: ${status.detail}`}>
      <strong>{status.label}</strong>
      <span className={styles.calorieDetail}>{status.detail}</span>
    </span>
  );
}
