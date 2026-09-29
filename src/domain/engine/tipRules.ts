import { fmt } from '../../lib/format';
import { addDays } from '../dates';
import { topicDecision } from './topics';
import { improvementFor } from '../review/improvements';
import { calorieSwing, enoughData, history, metricTrend, NOT_ENOUGH_DATA, strongestPattern, trendText, type DayRecord, type Metric } from '../review/trends';
import type { EngineContext } from './context';
import type { EngineAction, Recommendation } from './types';

/**
 * "Tipps für dich" – habits, not daily alarms. Each tip needs a pattern in
 * the data (7 / 30 days, see review/trends.ts) and carries the counted facts.
 *
 * Memory per topic (state.coach.topics, written when a tip is on screen):
 *   shown on 7 days and the pattern still holds → pause 14 days, then come
 *     back with another strategy (variant)
 *   the pattern no longer holds after the tip was shown → one "gut umgesetzt"
 *     note, then the topic rests (resolved)
 * So the same tip is never repeated for weeks, and progress is noticed.
 */
export const TIP_RULES = {
  breakfastMinDays: 5,
  breakfastProteinShare: 0.2,
  breakfastMinProtein: 20,
  liquidMinDays: 5,
  liquidMinKcal: 150,
} as const;


const tip = (ctx: EngineContext, topic: string, rec: Omit<Recommendation, 'id' | 'domain' | 'confidence' | 'topic'> & { confidence?: Recommendation['confidence'] }): Recommendation => ({
  id: `${rec.kind}:${topic}:${ctx.date}`,
  domain: 'tips',
  confidence: 'medium',
  topic,
  ...rec,
});

/** Praise once the pattern behind a shown tip is gone. */
function praise(ctx: EngineContext, topic: string, title: string, message: string): Recommendation {
  return tip(ctx, topic, { kind: 'tip_progress', priority: 'low', title, message, reasons: [], facts: { resolved: true }, actions: [] });
}

function metricTip(ctx: EngineContext, records: DayRecord[], metric: Metric, direction: 'low' | 'high', copy: { icon: string; title: string; alt: string; praise: string }): Recommendation[] {
  // The strongest statement the data carries (30 → 14 → 7 days, still visible lately).
  const found = strongestPattern(records, metric);
  const holds = found?.direction === direction;
  const t = holds ? found! : metricTrend(records, metric, 7);
  const topic = `tip:${metric}:${direction}`;
  const d = topicDecision(ctx.state.coach?.topics, topic, holds, ctx.date);
  if (!d.show) return d.praise ? [praise(ctx, topic, `${copy.icon} ${copy.praise}`, 'Das Muster aus den letzten Wochen ist nicht mehr zu sehen – gut umgesetzt. Der Tipp ruht jetzt.')] : [];
  const imp = improvementFor(ctx.state, metric, direction, t.avg !== undefined && t.avgTarget ? t.avgTarget - t.avg : undefined);
  const unit = metric === 'water' ? ' ml' : metric === 'kcal' ? ' kcal' : ' g';
  return [
    tip(ctx, topic, {
      kind: 'tip_habit',
      priority: 'low',
      confidence: t.days >= 10 ? 'high' : 'medium',
      title: `${copy.icon} ${copy.title}`,
      message: d.variant % 2 === 1 ? copy.alt : (imp?.action ?? copy.alt),
      reasons: [`${trendText(t)}.`, ...(t.avg !== undefined && t.avgTarget ? [`Durchschnitt ${fmt.int(t.avg)}${unit} – dein Bereich liegt um ${fmt.int(t.avgTarget)}${unit}.`] : []), ...(imp?.options.map((o) => o.text) ?? [])],
      facts: { metric, direction, days: t.days, deviating: direction === 'low' ? t.low : t.high, window: t.window, variant: d.variant },
      actions: [],
    }),
  ];
}

export function habitTipsRule(ctx: EngineContext): Recommendation[] {
  const records = history(ctx.state, ctx.date, 30);
  // Too little data: say so once instead of inventing a pattern (nothing at all before the first entry).
  if (!enoughData(records)) {
    if (!records.some((r) => r.tracked)) return [];
    return [
      {
        id: `tip_data:${ctx.date}`,
        kind: 'tip_data',
        domain: 'tips',
        priority: 'low',
        confidence: 'high',
        title: NOT_ENOUGH_DATA,
        message: 'Tipps entstehen aus deinen Einträgen – nach etwa einer Woche mit Einträgen kann LifeFit Muster erkennen.',
        reasons: [`${records.slice(0, 7).filter((r) => r.tracked).length} von 7 Tagen erfasst`],
        facts: { trackedDays: records.slice(0, 7).filter((r) => r.tracked).length },
        actions: [],
      },
    ];
  }
  return [
    ...metricTip(ctx, records, 'fiber', 'low', { icon: '🥦', title: 'Mehr Ballaststoffe', alt: 'Hülsenfrüchte zweimal pro Woche fest einplanen – z. B. Linsen oder Kichererbsen statt einer Beilage.', praise: 'Ballaststoffe deutlich besser' }),
    ...metricTip(ctx, records, 'fat', 'low', { icon: '🥑', title: 'Etwas mehr hochwertige Fette', alt: 'Eine Handvoll Nüsse als Snack oder etwas Olivenöl über Salat und Gemüse.', praise: 'Fettzufuhr jetzt meist im Bereich' }),
    ...metricTip(ctx, records, 'water', 'low', { icon: '💧', title: 'Regelmäßiger trinken', alt: 'Eine Flasche sichtbar an den Arbeitsplatz stellen und am Nachmittag nachfüllen.', praise: 'Wasserziel jetzt meist erreicht' }),
    ...breakfastProteinTip(ctx),
    ...liquidCaloriesTip(ctx),
    ...swingTip(ctx),
  ];
}

/** Breakfast with little protein on most days → the day target is harder to reach. */
function breakfastProteinTip(ctx: EngineContext): Recommendation[] {
  const R = TIP_RULES;
  const t = ctx.target;
  if (!t) return [];
  const days = Array.from({ length: 14 }, (_, i) => addDays(ctx.date, -1 - i));
  const breakfasts = days
    .map((d) => ctx.state.logEntries.filter((e) => e.date === d && e.slot === 'breakfast'))
    .filter((es) => es.length > 0 && !es.some((e) => e.unknown?.includes('protein')));
  const topic = 'tip:breakfast-protein';
  const limit = Math.max(R.breakfastMinProtein, t.protein * R.breakfastProteinShare);
  const avg = breakfasts.length ? breakfasts.reduce((s, es) => s + es.reduce((p, e) => p + e.macros.protein, 0), 0) / breakfasts.length : 0;
  const holds = breakfasts.length >= R.breakfastMinDays && avg < limit;
  const d = topicDecision(ctx.state.coach?.topics, topic, holds, ctx.date);
  if (!d.show) return d.praise ? [praise(ctx, topic, '🍳 Frühstück jetzt proteinreicher', 'Dein Frühstück enthält inzwischen deutlich mehr Protein – gut umgesetzt.')] : [];
  const imp = improvementFor(ctx.state, 'protein', 'low', limit - avg);
  return [
    tip(ctx, topic, {
      kind: 'tip_habit',
      priority: ctx.state.goal?.type === 'muscle_gain' ? 'medium' : 'low',
      title: '🍳 Protein zum Frühstück erhöhen',
      message: d.variant % 2 === 1 ? 'Ein Frühstück, das du oft isst, um eine Eiweißquelle ergänzen – z. B. Skyr, Quark oder Eier – statt alles umzustellen.' : 'Eine proteinreiche Komponente am Morgen macht dein Tagesziel leichter erreichbar.',
      reasons: [`Ø ${fmt.int(avg)} g Protein bei ${breakfasts.length} erfassten Frühstücken der letzten 14 Tage (Richtwert für dich: etwa ${fmt.int(limit)} g).`, ...(imp?.options.map((o) => o.text) ?? [])],
      facts: { avgProtein: Math.round(avg), breakfasts: breakfasts.length, limit: Math.round(limit) },
      actions: [],
    }),
  ];
}

/** Fat loss: calories from drinks (entries measured in ml) – with the drinks behind it. */
function liquidCaloriesTip(ctx: EngineContext): Recommendation[] {
  const R = TIP_RULES;
  if (ctx.state.goal?.type !== 'fat_loss') return [];
  const days = Array.from({ length: 14 }, (_, i) => addDays(ctx.date, -1 - i));
  const tracked = days.filter((d) => ctx.state.logEntries.some((e) => e.date === d));
  const drinks = ctx.state.logEntries.filter((e) => tracked.includes(e.date) && e.unit === 'ml' && e.macros.kcal > 0);
  const avg = tracked.length ? drinks.reduce((s, e) => s + e.macros.kcal, 0) / tracked.length : 0;
  const topic = 'tip:liquid-kcal';
  const holds = tracked.length >= R.liquidMinDays && avg >= R.liquidMinKcal;
  const d = topicDecision(ctx.state.coach?.topics, topic, holds, ctx.date);
  if (!d.show) return d.praise ? [praise(ctx, topic, '🥤 Weniger flüssige Kalorien', 'Über Getränke kommen inzwischen deutlich weniger Kalorien zusammen.')] : [];
  const byName = new Map<string, number>();
  for (const e of drinks) byName.set(e.name, (byName.get(e.name) ?? 0) + e.macros.kcal);
  const top = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return [
    tip(ctx, topic, {
      kind: 'tip_habit',
      priority: 'medium',
      title: '🥤 Flüssige Kalorien reduzieren',
      message:
        d.variant % 2 === 1
          ? `Mit einem Getränk anfangen: ${top[0]?.[0] ?? 'das häufigste'} durch eine Zero- oder ungesüßte Variante ersetzen – im Schnitt kommen ${fmt.kcal(avg)} pro Tag über Getränke zusammen.`
          : `Über Getränke kommen im Schnitt etwa ${fmt.kcal(avg)} pro Tag zusammen. Wasser, Zero-Getränke oder ungesüßter Tee wären eine einfache Stellschraube.`,
      reasons: [`${tracked.length} erfasste Tage der letzten 14 Tage`, ...top.map(([name, kcal]) => `${name}: ${fmt.kcal(kcal)} insgesamt`)],
      facts: { avgKcal: Math.round(avg), days: tracked.length },
      actions: [],
    }),
  ];
}

/** Calories clearly more uneven than before – information with a calm suggestion, no judgement. */
function swingTip(ctx: EngineContext): Recommendation[] {
  const swing = calorieSwing(ctx.state, ctx.date);
  const topic = 'tip:kcal-swing';
  const d = topicDecision(ctx.state.coach?.topics, topic, !!swing, ctx.date);
  if (!d.show || !swing) return [];
  return [
    tip(ctx, topic, {
      kind: 'tip_habit',
      priority: 'low',
      title: '📊 Kalorien schwanken stärker als zuvor',
      message: 'Regelmäßige Mahlzeiten oder eine grobe Wochenplanung machen die Tage oft gleichmäßiger – ohne einzelne Tage auszugleichen.',
      reasons: [`Schwankung der letzten 14 Tage: ± ${fmt.kcal(swing.recentSd)}; in den 14 Tagen davor: ± ${fmt.kcal(swing.previousSd)}.`],
      facts: { recentSd: swing.recentSd, previousSd: swing.previousSd },
      actions: [{ type: 'open', label: 'Wochenplan ansehen', route: 'nutrition' } as EngineAction],
    }),
  ];
}
