import { fmt } from '../lib/format';
import { NUTRITION_RULES } from './engine/nutritionRules';
import type { ISODate } from './types';

/**
 * Where the day stands against its calorie target – a small, friendly signal
 * next to the ring. Informs and motivates, never judges: no scores, no
 * compensation advice, no health claims.
 *
 * The target zone is ONE definition, used everywhere:
 *   tolerance = 10 % of the day target, at least 150 kcal, at most 300 kcal.
 * - 10 % is the same share the coach already uses for "über dem Ziel"
 *   (NUTRITION_RULES.overShare), so both never disagree.
 * - 150 kcal minimum: portion estimates and labels are that inexact anyway –
 *   a small target (1'500 kcal) must not turn a yoghurt into "daneben".
 * - 300 kcal maximum: on big targets (3'000+ kcal) 10 % would be very loose.
 * "Deutlich darüber" starts at twice the tolerance.
 */
export const CALORIE_ZONE = {
  share: NUTRITION_RULES.overShare,
  minKcal: 150,
  maxKcal: 300,
  /** Over by more than this many tolerances → "deutlich darüber". */
  clearlyOverFactor: 2,
  /** From this hour on, a day below the zone is "etwas darunter" instead of "noch Platz". */
  lateHour: 20,
} as const;

export type CalorieStatusKey = 'in_zone' | 'on_track' | 'room' | 'under' | 'over' | 'well_over';

export interface CalorieStatus {
  key: CalorieStatusKey;
  label: string;
  /** One short line with the number behind the label. */
  detail: string;
  /** good = green, neutral = grey, attention = soft yellow, strong = soft red – never loud. */
  tone: 'good' | 'neutral' | 'attention' | 'strong';
}

export function calorieTolerance(targetKcal: number): number {
  return Math.round(Math.min(CALORIE_ZONE.maxKcal, Math.max(CALORIE_ZONE.minKcal, targetKcal * CALORIE_ZONE.share)));
}

const kcal = (n: number) => fmt.kcal(n);

/** A past day, or today from the late evening on – only then is "below the zone" a result. */
export function isDayFinished(date: ISODate, today: ISODate, hour: number): boolean {
  return date < today || (date === today && hour >= CALORIE_ZONE.lateHour);
}

/**
 * @param eaten   kcal logged today
 * @param planned kcal of today's meals that are still planned (not eaten)
 * @param finished the day is over (a past day, or late evening) – only then
 *                 "below the zone" is a result instead of "still room"
 */
export function calorieStatus({ eaten, planned, targetKcal, finished }: { eaten: number; planned: number; targetKcal: number; finished: boolean }): CalorieStatus | undefined {
  if (!(targetKcal > 0)) return undefined;
  const tol = calorieTolerance(targetKcal);
  const diff = eaten - targetKcal;

  if (diff > tol * CALORIE_ZONE.clearlyOverFactor) return { key: 'well_over', label: 'Heute deutlich darüber', detail: `${kcal(diff)} über dem Ziel – morgen einfach normal weiter`, tone: 'strong' };
  if (diff > tol) return { key: 'over', label: 'Etwas darüber', detail: `${kcal(diff)} über dem Ziel`, tone: 'attention' };
  if (diff >= -tol) return { key: 'in_zone', label: 'Im Ziel 🎯', detail: `Zielbereich ±${kcal(tol)}`, tone: 'good' };

  // Below the zone: during the day that is simply room left – unless the plan already fills it.
  if (!finished) {
    const projected = eaten + planned - targetKcal;
    if (planned > 0 && Math.abs(projected) <= tol) return { key: 'on_track', label: 'Auf Kurs', detail: 'Mit den geplanten Mahlzeiten im Ziel', tone: 'good' };
    return { key: 'room', label: 'Noch Platz', detail: `${kcal(-diff)} offen`, tone: 'neutral' };
  }
  return { key: 'under', label: 'Etwas darunter', detail: `${kcal(-diff)} unter dem Ziel`, tone: 'attention' };
}
