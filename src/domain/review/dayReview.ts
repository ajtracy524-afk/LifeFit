import { fmt } from '../../lib/format';
import { addDays } from '../dates';
import { dayGoals } from '../dayGoals';
import { isCompletedOn } from '../training';
import { dayTargetFor } from '../week';
import type { AppState, ISODate } from '../types';
import { improvementFor, type Improvement } from './improvements';
import { history, METRIC_LABEL, metricTrend, trendText, type DayRecord, type Metric, type MetricTrend } from './trends';
import { unusualDay, unusualMeals } from './unusualMeals';

/**
 * "Dein gestriger Tag" – the finished day, told in the coach's order:
 *   1. Was lief gut?          (reached goals, consistent tracking, training)
 *   2. Was ist relevant?      (patterns over 7 / 14 / 30 days – not the single day)
 *   3. Was könnte besser sein? (at most two points, recurring ones first)
 *   4. Die einfachste Verbesserung (one action, concrete foods)
 *   5. Warum?                 (the counted data behind it)
 * A single off day is never a problem: it is only mentioned when clearly
 * off, and then with that sentence. No data → no review (and no guilt).
 */
export interface DayReview {
  date: ISODate;
  good: string[];
  relevant: string[];
  improve: string[];
  simplest?: Improvement & { metric: Metric };
  why: string[];
  /** Transparent notes on unusual meals / an unusual day. */
  unusual: string[];
}

/** Order of relevance when several things deviate. */
const PRIORITY: Metric[] = ['protein', 'kcal', 'fiber', 'fat', 'water', 'carbs', 'sugar', 'salt'];

export function dayReview(state: AppState, date: ISODate): DayReview | undefined {
  const records = history(state, addDays(date, 1), 30);
  const day = records[0];
  if (!day || day.date !== date || !day.tracked) return undefined;

  const good = goodPoints(state, date, day);
  const trends = new Map(PRIORITY.map((m) => [m, { w7: metricTrend(records, m, 7), w30: metricTrend(records, m, 30) }]));

  // What deviates – recurring (7 days) first, then a clear single-day deviation.
  const candidates: Array<{ metric: Metric; direction: 'low' | 'high'; recurring: boolean; trend: MetricTrend }> = [];
  for (const m of PRIORITY) {
    const t = trends.get(m)!;
    const s = day.status[m];
    const recurring = (t.w7.pattern === 'recurring' || t.w30.pattern === 'trend') && !!t.w7.direction;
    if (recurring && (s === t.w7.direction || s === 'unknown' || t.w30.pattern === 'trend')) candidates.push({ metric: m, direction: t.w7.direction!, recurring: true, trend: t.w30.pattern === 'trend' ? t.w30 : t.w7 });
    else if ((s === 'low' || s === 'high') && isClear(day, m)) candidates.push({ metric: m, direction: s, recurring: false, trend: t.w7 });
  }
  const chosen = candidates.sort((a, b) => Number(b.recurring) - Number(a.recurring)).slice(0, 2);

  const relevant = chosen.filter((c) => c.recurring).map((c) => `${trendText(c.trend)}.`);
  const improve = chosen.map((c) => improveText(c.metric, c.direction, c.recurring, day));
  const first = chosen[0];
  const simplest = first ? improvementFor(state, first.metric, first.direction, gapOf(day, first.metric)) : undefined;
  const why = chosen.map((c) => whyText(c.metric, c.trend, day));

  const unusual = unusualMeals(state, date).map((u) => u.text);
  const bigDay = unusualDay(state, date, dayTargetFor(state, date)?.kcal);
  if (bigDay) unusual.push(`Der Tag lag mit ${fmt.kcal(bigDay.kcal)} deutlich über deinem üblichen Tag (sonst etwa ${fmt.kcal(bigDay.usualKcal)}). Einzelne solche Tage gehören dazu.`);

  return { date, good, relevant, improve, ...(simplest && first ? { simplest: { ...simplest, metric: first.metric } } : {}), why, unusual };
}

function goodPoints(state: AppState, date: ISODate, day: DayRecord): string[] {
  const out: string[] = [];
  if (day.status.kcal === 'ok') out.push('Kalorienziel erreicht');
  if (day.status.protein === 'ok') out.push('Protein-Ziel erreicht');
  else if (day.amount.protein !== undefined && day.target.protein && day.amount.protein >= day.target.protein * 0.9) out.push('Protein sehr nah am Ziel');
  if (day.status.water === 'ok') out.push('Wasserziel erreicht');
  if (day.status.fiber === 'ok') out.push('Genug Ballaststoffe');
  const meals = dayGoals(state, date).goals.find((g) => g.key === 'meals');
  if (meals?.done) out.push('Alle geplanten Mahlzeiten erfasst');
  const workout = isCompletedOn(state.workouts, date);
  if (workout) out.push(`Training erledigt: ${workout.name}`);
  const activity = state.activity?.[date];
  if (activity?.steps && activity.steps >= 8000) out.push(`${fmt.int(activity.steps)} Schritte`);
  return out;
}

/** A single day is only worth a word when clearly off (not a few grams). */
function isClear(day: DayRecord, m: Metric): boolean {
  const a = day.amount[m];
  const t = day.target[m];
  if (a === undefined || !t) return false;
  const share = a / t;
  return day.status[m] === 'low' ? share < 0.75 : share > 1.25;
}

const gapOf = (day: DayRecord, m: Metric) => (day.amount[m] !== undefined && day.target[m] ? Math.max(0, day.target[m]! - day.amount[m]!) : undefined);

function improveText(m: Metric, dir: 'low' | 'high', recurring: boolean, day: DayRecord): string {
  const what = `${METRIC_LABEL[m]} ${dir === 'low' ? 'lag unter' : 'lag über'} deinem persönlichen Bereich`;
  if (recurring) return `${what} – nicht nur gestern, sondern häufiger. Hier lohnt sich eine kleine, feste Gewohnheit.`;
  const a = day.amount[m];
  const amount = a !== undefined ? ` (${m === 'water' ? `${fmt.dec(a / 1000)} L` : m === 'kcal' ? fmt.kcal(a) : `${fmt.dec(a)} g`})` : '';
  return `${METRIC_LABEL[m]} war gestern ${dir === 'low' ? 'etwas niedrig' : 'etwas hoch'}${amount}. Ein einzelner Tag ist kein Problem – nur wenn es häufiger vorkommt, lohnt sich eine Anpassung.`;
}

function whyText(m: Metric, t: MetricTrend, day: DayRecord): string {
  const unit = m === 'kcal' ? ' kcal' : m === 'water' ? ' ml' : ' g';
  const avg = t.avg !== undefined && t.avgTarget ? ` (Ø ${fmt.int(t.avg)}${unit} bei einem Bereich um ${fmt.int(t.avgTarget)}${unit})` : '';
  if (t.pattern === 'recurring' || t.pattern === 'trend') return `${trendText(t)}${avg}.`;
  const a = day.amount[m];
  return `Gestern: ${a !== undefined ? `${fmt.int(a)}${unit}` : '–'} bei einem Bereich um ${fmt.int(day.target[m] ?? 0)}${unit}. In den Tagen davor war das ${t.days >= 4 ? 'meist im Bereich' : 'noch nicht oft genug erfasst für einen Trend'}.`;
}
