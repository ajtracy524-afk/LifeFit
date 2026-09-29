import { fmt } from '../../lib/format';
import { addDays } from '../dates';
import { dayGoals } from '../dayGoals';
import { isCompletedOn } from '../training';
import { dayTargetFor } from '../week';
import type { AppState, ISODate } from '../types';
import { improvementFor, type Improvement } from './improvements';
import { enoughData, history, METRIC_LABEL, metricTrend, NOT_ENOUGH_DATA, positiveText, positiveTrend, strongestPattern, trendText, type DayRecord, type Metric, type MetricTrend } from './trends';
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
  /** At most one good habit over 14 / 30 days ("Protein … überwiegend im Bereich"). */
  positive?: string;
  /** Too few days with entries for any pattern – said instead of guessing. */
  dataNote?: string;
  /** Eaten, target and entered activity side by side – never "you may eat X more". */
  energy?: string;
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

  const good = goodPoints(state, date, day).slice(0, MAX_GOOD);
  const enough = enoughData(records);

  // What deviates – a pattern (the longest window that carries it: 30 → 14 → 7 days) first,
  // then a clear single-day deviation. Without enough data there are no patterns, only the day.
  const candidates: Array<{ metric: Metric; direction: 'low' | 'high'; recurring: boolean; trend: MetricTrend }> = [];
  for (const m of PRIORITY) {
    const s = day.status[m];
    const pattern = enough ? strongestPattern(records, m) : undefined;
    if (pattern) candidates.push({ metric: m, direction: pattern.direction!, recurring: true, trend: pattern });
    else if ((s === 'low' || s === 'high') && isClear(day, m)) candidates.push({ metric: m, direction: s, recurring: false, trend: metricTrend(records, m, 7) });
  }
  const chosen = candidates.sort((a, b) => Number(b.recurring) - Number(a.recurring)).slice(0, 2);
  // One good habit, not a list – only for a nutrient that is not a point to improve right now.
  const positive = enough ? PRIORITY.filter((m) => !candidates.some((c) => c.metric === m)).map((m) => positiveTrend(records, m)).find(Boolean) : undefined;

  const relevant = chosen.filter((c) => c.recurring).map((c) => `${trendText(c.trend)}.`);
  const improve = chosen.map((c) => improveText(c.metric, c.direction, c.recurring, day));
  const first = chosen[0];
  const simplest = first ? improvementFor(state, first.metric, first.direction, gapOf(day, first.metric)) : undefined;
  const why = chosen.map((c) => whyText(c.metric, c.trend, day));

  const unusual = unusualMeals(state, date).map((u) => u.text);
  const bigDay = unusualDay(state, date, dayTargetFor(state, date)?.kcal);
  if (bigDay) unusual.push(`Der Tag lag mit ${fmt.kcal(bigDay.kcal)} deutlich über deinem üblichen Tag (sonst etwa ${fmt.kcal(bigDay.usualKcal)}). Einzelne solche Tage gehören dazu.`);

  return {
    date,
    good,
    ...(positive ? { positive: `${positiveText(positive)}.` } : {}),
    ...(!enough ? { dataNote: `${NOT_ENOUGH_DATA} Muster zeigen sich nach etwa einer Woche mit Einträgen.` } : {}),
    ...(energyLine(state, date, day) ? { energy: energyLine(state, date, day) } : {}),
    relevant,
    improve,
    ...(simplest && first ? { simplest: { ...simplest, metric: first.metric } } : {}),
    why,
    unusual,
  };
}

const MAX_GOOD = 4;

/**
 * Nutrition, activity and the target kept apart: what was eaten, the day's
 * target (it already contains the everyday activity of the profile and the
 * training bonus) and the entered active calories as information. Never
 * "you may eat X more".
 */
function energyLine(state: AppState, date: ISODate, day: DayRecord): string | undefined {
  const a = state.activity?.[date];
  if (!a?.activeKcal || day.amount.kcal === undefined || !day.target.kcal) return undefined;
  return `Gegessen ${fmt.kcal(day.amount.kcal)} · Tagesziel ${fmt.kcal(day.target.kcal)} · Aktivität ${fmt.kcal(a.activeKcal)} (eingetragen). Die Aktivität wird nicht zum Ziel addiert – dein Ziel enthält deinen Alltag und das Training bereits.`;
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
  // Activity as context, not as a calorie credit.
  if (activity?.steps && activity.steps >= 8000) out.push(`Aktiver Tag: ${fmt.int(activity.steps)} Schritte`);
  else if (activity?.activeKcal && activity.activeKcal >= 300) out.push(`Aktiver Tag: ${fmt.kcal(activity.activeKcal)} Aktivität`);
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
