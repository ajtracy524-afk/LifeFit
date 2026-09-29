import { describe, expect, it } from 'vitest';
import { isValidGtin } from '../services/barcodeScanner';
import { emptyState } from '../store/persistence';
import { addDays } from './dates';
import { runEngine } from './engine';
import { topicDecision } from './engine/topics';
import { parseServingLabel, productAmountOptions, productPortion } from './foodEntry';
import { dayReview } from './review/dayReview';
import { improvementFor } from './review/improvements';
import { calorieSwing, history, metricTrend } from './review/trends';
import { unusualDay, unusualMeals } from './review/unusualMeals';
import type { AppState, LogEntry, MealSlot, Product } from './types';

/** Phase 1 of the coach: day review, trends, tips with memory, unusual meals, activity, scanner, portions. */

const TODAY = '2026-09-29';
const day = (n: number) => addDays(TODAY, -n); // n days ago
const base = (patch: Partial<AppState> = {}): AppState => ({
  ...emptyState(),
  profile: { name: 'A', sex: 'male', age: 30, heightCm: 180, activity: 'moderate', experience: 'beginner', createdAt: '2026-07-01T08:00:00' },
  goal: { type: 'maintain', startWeightKg: 80, startedAt: '2026-07-01' },
  nutritionProfile: { diet: 'omnivore', excluded: [], slots: ['breakfast', 'lunch', 'dinner'], waterGoalMl: 2000 },
  targets: [{ id: 't', validFrom: '2026-07-01', method: 'formula', kcal: 2500, protein: 150, carbs: 300, fat: 80 }],
  ...patch,
});
let n = 0;
const entry = (date: string, slot: MealSlot, macros: [number, number, number, number], micros: { fiber?: number; sugar?: number; salt?: number } = {}, extra: Partial<LogEntry> = {}): LogEntry => ({
  id: `e${++n}`,
  date,
  slot,
  loggedAt: `${date}T12:00:00`,
  name: extra.name ?? 'Eintrag',
  method: 'quick',
  macros: { kcal: macros[0], protein: macros[1], carbs: macros[2], fat: macros[3] },
  ...(Object.keys(micros).length ? { micros } : {}),
  ...extra,
});
/** A complete, balanced day (in every zone) with an adjustable fiber amount. */
const goodDay = (date: string, fiber = 36, fat = 80) => [entry(date, 'lunch', [2500, 155, 300, fat], { fiber, sugar: 40, salt: 4 })];

describe('trends: single day vs recurring pattern vs 30-day trend – from the same rating as the analysis', () => {
  it('too few days → insufficient; one low day → single; most days low → recurring; 30 days → trend', () => {
    const few = base({ logEntries: [...goodDay(day(1), 10), ...goodDay(day(2))] });
    expect(metricTrend(history(few, TODAY), 'fiber', 7)).toMatchObject({ pattern: 'insufficient', days: 2 });
    const single = base({ logEntries: [1, 2, 3, 4, 5, 6].flatMap((d) => goodDay(day(d), d === 1 ? 10 : 36)) });
    expect(metricTrend(history(single, TODAY), 'fiber', 7)).toMatchObject({ pattern: 'single', low: 1, days: 6 });
    const recurring = base({ logEntries: [1, 2, 3, 4, 5, 6, 7].flatMap((d) => goodDay(day(d), d <= 6 ? 12 : 36)) });
    expect(metricTrend(history(recurring, TODAY), 'fiber', 7)).toMatchObject({ pattern: 'recurring', low: 6, days: 7, direction: 'low' });
    const month = base({ logEntries: Array.from({ length: 30 }, (_, i) => goodDay(day(i + 1), 36, i % 3 ? 50 : 80)).flat() });
    expect(metricTrend(history(month, TODAY), 'fat', 30)).toMatchObject({ pattern: 'trend', low: 20, days: 30 });
  });

  it('unknown is not 0: days without fiber data (or with a protein-less product) are not counted', () => {
    const s = base({ logEntries: [...[1, 2, 3, 4, 5].map((d) => entry(day(d), 'lunch', [2500, 155, 300, 80])), entry(day(6), 'lunch', [2500, 0, 300, 80], {}, { unknown: ['protein'] })] });
    const recs = history(s, TODAY);
    expect(metricTrend(recs, 'fiber', 7)).toMatchObject({ days: 0, pattern: 'insufficient' });
    expect(metricTrend(recs, 'protein', 7).days).toBe(5);
  });

  it('calorie swings only when clearly larger than the 14 days before', () => {
    const steady = Array.from({ length: 28 }, (_, i) => entry(day(i + 1), 'lunch', [2500, 150, 300, 80]));
    expect(calorieSwing(base({ logEntries: steady }), TODAY)).toBeUndefined();
    const swinging = [...Array.from({ length: 14 }, (_, i) => entry(day(i + 1), 'lunch', [i % 2 ? 1600 : 3400, 150, 300, 80])), ...steady.slice(14)];
    expect(calorieSwing(base({ logEntries: swinging }), TODAY)).toMatchObject({ recentSd: 900 });
  });
});

describe('"Dein gestriger Tag"', () => {
  it('good points first; a single clearly low day is mentioned calmly; the simplest step has real foods', () => {
    const s = base({ logEntries: [...[2, 3, 4, 5, 6].flatMap((d) => goodDay(day(d))), ...goodDay(day(1), 36, 40)], water: { [day(1)]: 2100 } });
    const r = dayReview(s, day(1))!;
    expect(r.good).toEqual(expect.arrayContaining(['Kalorienziel erreicht', 'Protein-Ziel erreicht', 'Wasserziel erreicht', 'Genug Ballaststoffe']));
    expect(r.relevant).toEqual([]);
    expect(r.improve).toEqual(['Fett war gestern etwas niedrig (40 g). Ein einzelner Tag ist kein Problem – nur wenn es häufiger vorkommt, lohnt sich eine Anpassung.']);
    expect(r.simplest!.metric).toBe('fat');
    expect(r.simplest!.options.map((o) => o.foodId)).toEqual(['almonds', 'avocado', 'olive-oil']);
    for (const text of [...r.improve, ...r.why]) expect(text).not.toMatch(/gefährlich|Mangel|musst|schlecht|Warnung/);
  });

  it('a recurring pattern is "relevant" with the counted days as the reason', () => {
    const s = base({ logEntries: [1, 2, 3, 4, 5, 6, 7].flatMap((d) => goodDay(day(d), d <= 6 ? 12 : 36)) });
    const r = dayReview(s, day(1))!;
    expect(r.relevant).toEqual(['Ballaststoffe lag an 6 von 7 erfassten Tagen der letzten 7 Tage unter deinem persönlichen Bereich.']);
    expect(r.improve[0]).toMatch(/nicht nur gestern, sondern häufiger/);
    expect(r.why[0]).toMatch(/^Ballaststoffe lag an 6 von 7 .* \(Ø \d+ g bei einem Bereich um 35 g\)\.$/);
    expect(r.simplest!.action).toMatch(/Gemüse, Obst, Hülsenfrüchte oder Vollkorn/);
  });

  it('small deviations are not commented; nothing logged → no review at all', () => {
    const s = base({ logEntries: [...[2, 3, 4, 5].flatMap((d) => goodDay(day(d))), ...goodDay(day(1), 36, 70)] });
    expect(dayReview(s, day(1))!.improve).toEqual([]); // 70 of 80 g fat: not worth a word
    expect(dayReview(base(), day(1))).toBeUndefined();
  });

  it('unusual meal: only against the own history, transparent – never "Cheat Meal", nothing with too little data', () => {
    const usual = Array.from({ length: 10 }, (_, i) => entry(day(i + 2), 'dinner', [650, 40, 70, 20]));
    const big = entry(day(1), 'dinner', [1900, 60, 180, 90], {}, { name: 'Pizza' });
    const s = base({ logEntries: [...usual, big, entry(day(1), 'lunch', [700, 50, 80, 20])] });
    expect(unusualMeals(s, day(1)).map((u) => u.text)).toEqual(['Abendessen (1.900 kcal) lag deutlich über deiner üblichen Menge (sonst etwa 650 kcal).']);
    expect(dayReview(s, day(1))!.unusual[0]).toMatch(/^Abendessen/);
    expect(JSON.stringify(dayReview(s, day(1)))).not.toMatch(/[Cc]heat/);
    expect(unusualMeals(base({ logEntries: [...usual.slice(0, 5), big] }), day(1))).toEqual([]); // < 8 comparable meals
    expect(unusualDay(base({ logEntries: [...usual.slice(0, 5), big] }), day(1), 2500)).toBeUndefined();
  });
});

describe('tips with memory (not repeated for weeks, progress acknowledged)', () => {
  const lowFiber = [1, 2, 3, 4, 5, 6, 7].flatMap((d) => goodDay(day(d), d <= 6 ? 12 : 36));
  const tips = (s: AppState) => runEngine(s, { date: TODAY, domains: ['tips'], limit: 10 });

  it('a fiber pattern → one tip with the counted reason and concrete foods', () => {
    const [tip] = tips(base({ logEntries: lowFiber }));
    expect(tip).toMatchObject({ kind: 'tip_habit', topic: 'tip:fiber:low', title: '🥦 Mehr Ballaststoffe' });
    expect(tip!.reasons[0]).toBe('Ballaststoffe lag an 6 von 7 erfassten Tagen der letzten 7 Tage unter deinem persönlichen Bereich.');
    expect(tip!.reasons.filter((r) => / g Ballaststoffe$/.test(r))).toHaveLength(3); // three concrete foods with their amount
  });

  it('shown on 7 days while the pattern holds → pauses 14 days, then returns with another strategy', () => {
    expect(topicDecision({ 'tip:fiber:low': { firstShown: day(10), lastShown: day(1), shownDays: 7, status: 'paused', since: day(1), variant: 1 } }, 'tip:fiber:low', true, TODAY)).toEqual({ show: false });
    const back = topicDecision({ 'tip:fiber:low': { firstShown: day(30), lastShown: day(15), shownDays: 7, status: 'paused', since: day(15), variant: 1 } }, 'tip:fiber:low', true, TODAY);
    expect(back).toEqual({ show: true, variant: 1 });
    const s = base({ logEntries: lowFiber, coach: { dismissed: {}, topics: { 'tip:fiber:low': { firstShown: day(30), lastShown: day(15), shownDays: 7, status: 'paused', since: day(15), variant: 1 } } } });
    expect(tips(s)[0]!.message).toMatch(/^Hülsenfrüchte zweimal pro Woche/); // the other strategy
  });

  it('pattern gone after the tip was shown → one "gut umgesetzt" note, then nothing', () => {
    const fine = base({ logEntries: [1, 2, 3, 4, 5, 6, 7].flatMap((d) => goodDay(day(d))), coach: { dismissed: {}, topics: { 'tip:fiber:low': { firstShown: day(9), lastShown: day(2), shownDays: 4, status: 'active' } } } });
    expect(tips(fine).map((r) => [r.kind, r.title])).toEqual([['tip_progress', '🥦 Ballaststoffe deutlich besser']]);
    const rested = { ...fine, coach: { dismissed: {}, topics: { 'tip:fiber:low': { firstShown: day(9), lastShown: day(1), shownDays: 4, status: 'resolved' as const, since: TODAY } } } };
    expect(tips(rested)).toEqual([]);
  });

  it('recordTopics: once per day, pause after the 7th day, resolved on praise', async () => {
    const store = await import('../store/store');
    const actions = await import('../store/actions');
    store.commit(base());
    actions.recordTopics(TODAY, ['tip:fiber:low'], []);
    actions.recordTopics(TODAY, ['tip:fiber:low'], []);
    expect(store.getState().coach.topics!['tip:fiber:low']).toMatchObject({ shownDays: 1, status: 'active' });
    store.update((s) => void (s.coach.topics!['tip:fiber:low']!.shownDays = 6));
    store.update((s) => void (s.coach.topics!['tip:fiber:low']!.lastShown = day(1)));
    actions.recordTopics(TODAY, ['tip:fiber:low'], []);
    expect(store.getState().coach.topics!['tip:fiber:low']).toMatchObject({ shownDays: 7, status: 'paused', since: TODAY, variant: 1 });
    actions.recordTopics(TODAY, [], ['tip:fiber:low']);
    expect(store.getState().coach.topics!['tip:fiber:low']!.status).toBe('resolved');
    store.commit(emptyState());
  });

  it('breakfast protein and liquid calories come from real entries (and name the drinks)', () => {
    const breakfasts = [1, 2, 3, 4, 5, 6].map((d) => entry(day(d), 'breakfast', [400, 8, 70, 8]));
    const [b] = tips(base({ logEntries: [...breakfasts, ...[1, 2, 3, 4, 5, 6].flatMap((d) => goodDay(day(d)))] })).filter((r) => r.topic === 'tip:breakfast-protein');
    expect(b!.reasons[0]).toBe('Ø 8 g Protein bei 6 erfassten Frühstücken der letzten 14 Tage (Richtwert für dich: etwa 30 g).');
    const cola = [1, 2, 3, 4, 5].map((d) => entry(day(d), 'snack', [210, 0, 53, 0], {}, { name: 'Cola', unit: 'ml', amount: 500 }));
    const fatLoss = base({ goal: { type: 'fat_loss', startWeightKg: 80, startedAt: '2026-07-01' }, logEntries: [...cola, ...[1, 2, 3, 4, 5].flatMap((d) => goodDay(day(d)))] });
    const [l] = tips(fatLoss).filter((r) => r.topic === 'tip:liquid-kcal');
    expect(l!.message).toMatch(/^Über Getränke kommen im Schnitt etwa 210 kcal pro Tag zusammen/);
    expect(l!.reasons).toContain('Cola: 1.050 kcal insgesamt');
    expect(tips(base({ logEntries: fatLoss.logEntries })).some((r) => r.topic === 'tip:liquid-kcal')).toBe(false); // only for fat loss
  });

  it('the tips rule only runs when tips are asked for (it reads 30 days)', () => {
    const s = base({ logEntries: lowFiber });
    expect(runEngine(s, { date: TODAY, domains: ['nutrition'], limit: 10 }).some((r) => r.domain === 'tips')).toBe(false);
  });

  it('improvements respect the diet (vegan: no fish, no dairy in the options)', () => {
    const vegan = base({ nutritionProfile: { diet: 'vegan', excluded: [], slots: ['lunch'] } });
    expect(improvementFor(vegan, 'fat', 'low')!.options.map((o) => o.foodId)).not.toContain('salmon');
    expect(improvementFor(vegan, 'protein', 'low')!.options.map((o) => o.foodId)).not.toEqual(expect.arrayContaining(['skyr']));
  });
});

describe('activity (entered, not eaten back)', () => {
  it('stored with its source, bounded, empty removes it; it never changes the day target', async () => {
    const store = await import('../store/store');
    const actions = await import('../store/actions');
    const { dayTargetFor } = await import('./week');
    store.commit(base());
    const before = dayTargetFor(store.getState(), TODAY)!.kcal;
    actions.setActivity(TODAY, { activeKcal: 420, steps: 8400 });
    expect(store.getState().activity[TODAY]).toMatchObject({ activeKcal: 420, steps: 8400, source: 'manual' });
    expect(dayTargetFor(store.getState(), TODAY)!.kcal).toBe(before);
    actions.setActivity(TODAY, { activeKcal: 99999 });
    expect(store.getState().activity[TODAY]!.activeKcal).toBe(5000);
    actions.setActivity(TODAY, {});
    expect(store.getState().activity[TODAY]).toBeUndefined();
    store.commit(emptyState());
  });
});

describe('barcode: check digit for camera reads', () => {
  it('valid GTINs pass, a single wrong digit fails', () => {
    expect(['4012345678901', '7613034626844', '3017624010701', '96385074', '036000291452'].every(isValidGtin)).toBe(true);
    expect(['4012345678902', '76123456', '12345678', '4012345'].some(isValidGtin)).toBe(false);
  });
});

describe('portion intelligence', () => {
  const product = (patch: Partial<Product>): Product => ({ barcode: '4012345678901', name: 'Toast', per100: { kcal: 260, protein: 8, carbs: 48, fat: 3 }, micros100: {}, unit: 'g', source: 'openfoodfacts', fetchedAt: '2026-09-01T00:00:00Z', ...patch });

  it('serving labels become units: "1 slice (25 g)" → 1 Scheibe; "2 Scheiben (50 g)" → 25 g per slice', () => {
    expect(parseServingLabel('1 slice (25 g)', 25)).toEqual({ amount: 25, word: 'Scheibe', plural: 'Scheiben' });
    expect(parseServingLabel('2 Scheiben (50g)', 50)).toEqual({ amount: 25, word: 'Scheibe', plural: 'Scheiben' });
    expect(parseServingLabel('1 pot (125 g)', 125)).toMatchObject({ word: 'Becher' });
    expect(parseServingLabel('30 g', 30)).toBeUndefined(); // no unit word → plain "Portion"
  });

  it('default portion: named serving → piece of the linked food → small single pack → none (100 g stays)', () => {
    expect(productPortion(product({ servingSize: 50, servingLabel: '2 slices (50 g)', packageSize: 500 }))).toMatchObject({ amount: 25, word: 'Scheibe', source: 'serving' });
    expect(productAmountOptions(product({ servingSize: 50, servingLabel: '2 slices (50 g)', packageSize: 500 })).map((o) => o.label)).toEqual(['100 g', '1 Scheibe (25 g)', '1 Portion (50 g)', 'Packung (500 g)']);
    expect(productPortion(product({ packageSize: 600 }), { pieceG: 60, pieceLabel: 'Stück' })).toMatchObject({ amount: 60, word: 'Stück', source: 'piece' });
    expect(productPortion(product({ packageSize: 150 }))).toMatchObject({ amount: 150, word: 'Packung', source: 'package' });
    expect(productPortion(product({ packageSize: 1000 }))).toBeUndefined();
  });
});
