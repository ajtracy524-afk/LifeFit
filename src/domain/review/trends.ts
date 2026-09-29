import { addDays } from '../dates';
import { dayTotals } from '../nutrition';
import { nutrientReport, type NutrientRow } from '../nutrientReport';
import { appStartDate } from '../progress';
import { waterOn } from '../water';
import type { AppState, ISODate } from '../types';

/**
 * Trends over 7 / 14 / 30 days – deterministic, from the SAME per-day rating
 * as the Nährstoff-Auswertung (references, zones, unknown ≠ 0). Nothing here
 * is estimated: a day counts for a nutrient only when something was logged
 * and the value is complete; otherwise it is "unknown" and simply not counted.
 *
 * Classification, so a single day is never presented as a problem:
 *   insufficient – too few days with data for this window
 *   none         – deviations are rare
 *   single       – only one day deviated (e.g. yesterday)
 *   recurring    – at least half of the days with data deviated (7 / 14 days)
 *   trend        – at least half over 30 days with enough data
 */

export type Metric = 'kcal' | 'protein' | 'carbs' | 'fat' | 'fiber' | 'water' | 'sugar' | 'salt';
export type DayStatus = 'ok' | 'low' | 'high' | 'unknown';
export type Pattern = 'insufficient' | 'none' | 'single' | 'recurring' | 'trend';

export const TREND_RULES = {
  /** Days with data needed per window before anything is said. */
  minDays: { 7: 4, 14: 7, 30: 14 } as Record<7 | 14 | 30, number>,
  /** Share of days with data that must deviate for a pattern. */
  patternShare: 0.5,
  /** Calorie swings: SD at least this much higher than the 14 days before … */
  swingIncrease: 1.4,
  /** … and at least this large in kcal. */
  swingMinSd: 250,
} as const;

export const METRIC_LABEL: Record<Metric, string> = {
  kcal: 'Kalorien',
  protein: 'Protein',
  carbs: 'Kohlenhydrate',
  fat: 'Fett',
  fiber: 'Ballaststoffe',
  water: 'Wasser',
  sugar: 'Zucker',
  salt: 'Salz',
};

const METRICS: Metric[] = ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'water', 'sugar', 'salt'];

export interface DayRecord {
  date: ISODate;
  tracked: boolean;
  status: Record<Metric, DayStatus>;
  amount: Partial<Record<Metric, number>>;
  target: Partial<Record<Metric, number>>;
}

/** One finished day, rated like the Nährstoff-Auswertung rates it. */
export function dayRecord(state: AppState, date: ISODate): DayRecord {
  const report = nutrientReport(state, date, true);
  const rows = new Map(report.groups.flatMap((g) => g.rows).map((r) => [r.key, r]));
  const tracked = report.entries > 0;
  const status = {} as Record<Metric, DayStatus>;
  const amount: DayRecord['amount'] = {};
  const target: DayRecord['target'] = {};
  for (const m of METRICS) {
    const row = rows.get(m);
    // Water stands on its own (tracked even without food entries) – but a day without any water entry is
    // unknown, not "too little": not everybody logs water every day.
    const counts = m === 'water' ? !!row?.reference && waterOn(state, date) > 0 : tracked;
    status[m] = counts && row ? statusOf(row) : 'unknown';
    if (counts && row?.amount !== undefined && !row.partial) amount[m] = row.amount;
    if (row?.reference) target[m] = row.reference.amount;
  }
  return { date, tracked, status, amount, target };
}

function statusOf(row: NutrientRow): DayStatus {
  if (row.amount === undefined || row.partial || !row.reference || row.tone === 'none') return 'unknown';
  if (row.tone === 'green') return 'ok';
  const kind = row.reference.kind;
  if (kind === 'max') return row.tone === 'red' ? 'high' : 'ok';
  if (kind === 'min') return 'low';
  return row.message.includes('über') ? 'high' : 'low';
}

/** Finished days before `today`, newest first, from the app start on. Computed once per state object (immutable store). */
const cache = new WeakMap<AppState, Map<string, DayRecord[]>>();
export function history(state: AppState, today: ISODate, days = 30): DayRecord[] {
  const key = `${today}|${days}`;
  const hit = cache.get(state)?.get(key);
  if (hit) return hit;
  const out = compute(state, today, days);
  if (!cache.has(state)) cache.set(state, new Map());
  cache.get(state)!.set(key, out);
  return out;
}

function compute(state: AppState, today: ISODate, days: number): DayRecord[] {
  const start = appStartDate(state);
  const out: DayRecord[] = [];
  for (let i = 1; i <= days; i++) {
    const d = addDays(today, -i);
    if (d < start) break;
    out.push(dayRecord(state, d));
  }
  return out;
}

export interface MetricTrend {
  metric: Metric;
  window: 7 | 14 | 30;
  /** Days with a rating for this metric. */
  days: number;
  ok: number;
  low: number;
  high: number;
  /** Average over the days with a complete value. */
  avg?: number;
  /** Average reference over the same days. */
  avgTarget?: number;
  /** The dominant deviation, if any. */
  direction?: 'low' | 'high';
  pattern: Pattern;
}

export function metricTrend(records: DayRecord[], metric: Metric, window: 7 | 14 | 30): MetricTrend {
  const inWindow = records.slice(0, window);
  const rated = inWindow.filter((r) => r.status[metric] !== 'unknown');
  const low = rated.filter((r) => r.status[metric] === 'low').length;
  const high = rated.filter((r) => r.status[metric] === 'high').length;
  const ok = rated.length - low - high;
  const values = rated.map((r) => r.amount[metric]).filter((v): v is number => v !== undefined);
  const targets = rated.map((r) => r.target[metric]).filter((v): v is number => v !== undefined);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
  const direction = low > high ? 'low' : high > low ? 'high' : undefined;
  const off = Math.max(low, high);
  let pattern: Pattern;
  if (rated.length < TREND_RULES.minDays[window]) pattern = 'insufficient';
  else if (off >= Math.ceil(rated.length * TREND_RULES.patternShare)) pattern = window === 30 ? 'trend' : 'recurring';
  else if (off === 1) pattern = 'single';
  else pattern = 'none';
  return { metric, window, days: rated.length, ok, low, high, avg: mean(values), avgTarget: mean(targets), ...(direction ? { direction } : {}), pattern };
}

/** "an 6 von 7 erfassten Tagen unter deinem Mindestwert" – the plain count behind a pattern. */
export function trendText(t: MetricTrend): string {
  const n = t.direction === 'high' ? t.high : t.low;
  const where = t.direction === 'high' ? 'über' : 'unter';
  const days = t.window === 7 ? 'der letzten 7 Tage' : `der letzten ${t.window} Tage`;
  return `${METRIC_LABEL[t.metric]} lag an ${n} von ${t.days} erfassten Tagen ${days} ${where} deinem persönlichen Bereich`;
}

/** Calorie swings: are the last 14 days clearly more uneven than the 14 before? */
export function calorieSwing(state: AppState, today: ISODate): { recentSd: number; previousSd: number } | undefined {
  const sd = (days: ISODate[]) => {
    const kcal = days.map((d) => dayTotals(state.logEntries, d).kcal).filter((k) => k > 0);
    if (kcal.length < 7) return undefined;
    const m = kcal.reduce((a, b) => a + b, 0) / kcal.length;
    return Math.sqrt(kcal.reduce((s, k) => s + (k - m) ** 2, 0) / kcal.length);
  };
  const recent = sd(Array.from({ length: 14 }, (_, i) => addDays(today, -1 - i)));
  const previous = sd(Array.from({ length: 14 }, (_, i) => addDays(today, -15 - i)));
  if (recent === undefined || previous === undefined) return undefined;
  if (recent < TREND_RULES.swingMinSd || recent < previous * TREND_RULES.swingIncrease) return undefined;
  return { recentSd: Math.round(recent), previousSd: Math.round(previous) };
}
