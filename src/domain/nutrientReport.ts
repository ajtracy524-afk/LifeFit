import { NUTRIENTS } from '../data/nutrients';
import { calorieTolerance } from './calorieStatus';
import { daySummary, VITAL_NUTRIENTS, type MicroTotal, type NutritionSummary } from './nutrition';
import type { AppState, ISODate, MicroNutrient, NutritionTarget } from './types';
import { withoutKcal } from './numberFree';
import { waterOn } from './water';
import { dayTargetFor } from './week';

/**
 * Nährstoff-Auswertung – ONE place that decides, per nutrient, which
 * reference applies to THIS person today and how the current value is rated.
 *
 * References (what is personal, and what honestly is not):
 * - Kalorien, Protein, Kohlenhydrate, Fett: the day target – computed from
 *   sex, age, height, weight, activity, training days and goal (see
 *   calculateTargets), shifted on training / rest days (dayTargetFor).
 * - Ballaststoffe: 14 g per 1'000 kcal of the day target (US Institute of
 *   Medicine, adequate intake) – scales with the personal energy need.
 * - Zucker: EU reference intake for total sugars, 90 g at 2'000 kcal
 *   (Reg. 1169/2011, Annex XIII B), scaled to the day target – an upper
 *   orientation, not a "free sugars" limit (those are not in food data).
 * - Salz: 5 g per day (WHO / Swiss nutrition society) – the same for adults.
 * - Wasser: the user's own goal (profile). No goal → no rating.
 * - Vitamins and minerals: the labelling reference (NRV, EU 1169/2011
 *   Annex XIII) – the SAME for everyone. The app has no reliable basis to
 *   personalise them, so it says so ("allgemeiner Referenzwert").
 *   Sodium: WHO upper value of 2'000 mg.
 *
 * Three kinds, three different ratings – not one percentage for all:
 * - min   (protein, fiber, water, vitamins, minerals): below = still open.
 *         More is not "better" – reaching the reference is green, the bar
 *         simply stays full.
 * - range (kcal, carbs, fat): a band around the target – far below or above
 *         leaves the green band.
 * - max   (sugar, salt, sodium): the closer to the limit, the more attention.
 */

export type RefKind = 'min' | 'range' | 'max';
export type Tone = 'green' | 'orange' | 'red' | 'none';
export type ReportKey = 'kcal' | 'protein' | 'carbs' | 'fat' | 'water' | MicroNutrient;

export const REPORT_RULES = {
  fiberPer1000Kcal: 14,
  sugarReferenceG: 90,
  sugarReferenceKcal: 2000,
  saltLimitG: 5,
  sodiumLimitMg: 2000,
  /** min: below this share of the reference on a FINISHED day is red; during the day it is only "noch offen" (orange). */
  minRedShare: 0.5,
  /** max: from this share of the limit on it is "nahe an der Obergrenze" (orange). */
  maxOrangeShare: 0.8,
  /** range (carbs, fat): ± this share of the target is green; beyond twice it is red (only above, or below on a finished day). */
  rangeShare: 0.15,
} as const;

export interface Reference {
  kind: RefKind;
  /** The value the rating is measured against (min: reach it, max: stay below, range: the target). */
  amount: number;
  unit: 'kcal' | 'g' | 'mg' | 'µg' | 'ml';
  /** Band half-width for 'range' (same unit as amount). */
  tolerance?: number;
  personalized: boolean;
  /** One short line: where the value comes from. */
  basis: string;
  /** What the number IS: "Tagesziel", "Zielbereich", "Mindestwert", "Orientierungswert", "Obergrenze", "Referenz (NRV)", "Dein Ziel". */
  role: string;
}

export interface NutrientRow {
  key: ReportKey;
  label: string;
  unit: Reference['unit'];
  /** Undefined = no data for this nutrient (never shown as 0). */
  amount?: number;
  reference?: Reference;
  tone: Tone;
  /** Short, plain words: "Noch 28 g", "Im Zielbereich", "über dem empfohlenen Bereich", "keine Daten". */
  message: string;
  /** Only some entries had a value – the amount is a lower bound. */
  partial: boolean;
  /** 0 … 1.3 for the bar (capped – "more" is not drawn as better). */
  ratio: number;
}

export interface NutrientGroup {
  id: 'energy' | 'water' | 'limit' | 'vitamin' | 'mineral';
  label: string;
  rows: NutrientRow[];
}

export interface NutrientReport {
  date: ISODate;
  entries: number;
  finished: boolean;
  groups: NutrientGroup[];
  /** 2–5 short sentences from the real values, most relevant first. */
  summary: string[];
}

const round = (n: number, unit: string) => (unit === 'kcal' || unit === 'ml' || n >= 100 ? Math.round(n) : n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
const num = (n: number, unit: string) => round(n, unit).toLocaleString('de-DE', { maximumFractionDigits: 1 });
const amountText = (n: number, unit: string) => (unit === 'ml' ? `${(n / 1000).toLocaleString('de-DE', { maximumFractionDigits: 2 })} L` : `${num(n, unit)} ${unit}`);

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

export function references(target: NutritionTarget | undefined, waterGoalMl: number | undefined): Partial<Record<ReportKey, Reference>> {
  const R = REPORT_RULES;
  const refs: Partial<Record<ReportKey, Reference>> = {};
  if (target) {
    const personal = 'Dein Tagesziel (aus Körperdaten, Aktivität, Training und Ziel)';
    refs.kcal = { kind: 'range', amount: target.kcal, unit: 'kcal', tolerance: calorieTolerance(target.kcal), personalized: true, basis: personal, role: 'Zielbereich' };
    refs.protein = { kind: 'min', amount: target.protein, unit: 'g', personalized: true, basis: personal, role: 'Tagesziel' };
    refs.carbs = { kind: 'range', amount: target.carbs, unit: 'g', tolerance: Math.round(target.carbs * R.rangeShare), personalized: true, basis: personal, role: 'Zielbereich' };
    refs.fat = { kind: 'range', amount: target.fat, unit: 'g', tolerance: Math.round(target.fat * R.rangeShare), personalized: true, basis: personal, role: 'Zielbereich' };
    refs.fiber = { kind: 'min', amount: Math.round((target.kcal / 1000) * R.fiberPer1000Kcal), unit: 'g', personalized: true, basis: `${R.fiberPer1000Kcal} g pro 1'000 kcal deines Tagesziels`, role: 'Mindestwert' };
    refs.sugar = {
      kind: 'max',
      amount: Math.round((R.sugarReferenceG * target.kcal) / R.sugarReferenceKcal),
      unit: 'g',
      personalized: true,
      basis: `EU-Referenzmenge (90 g bei 2'000 kcal), auf dein Tagesziel umgerechnet`,
      role: 'Orientierungswert',
    };
  }
  refs.salt = { kind: 'max', amount: R.saltLimitG, unit: 'g', personalized: false, basis: 'Empfehlung für Erwachsene (WHO): höchstens 5 g pro Tag', role: 'Obergrenze' };
  if (waterGoalMl) refs.water = { kind: 'min', amount: waterGoalMl, unit: 'ml', personalized: true, basis: 'Dein eigenes Wasserziel', role: 'Dein Ziel' };
  for (const key of VITAL_NUTRIENTS) {
    const info = NUTRIENTS[key];
    if (key === 'sodium') refs.sodium = { kind: 'max', amount: R.sodiumLimitMg, unit: 'mg', personalized: false, basis: 'Obergrenze für Erwachsene (WHO): 2’000 mg', role: 'Obergrenze' };
    else if (info.nrv !== undefined) refs[key] = { kind: 'min', amount: info.nrv, unit: info.unit, personalized: false, basis: 'Allgemeiner Referenzwert (NRV) – für alle gleich, nicht individuell berechnet', role: 'Referenz (NRV)' };
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Rating – one function, three kinds
// ---------------------------------------------------------------------------

export function rate(amount: number | undefined, ref: Reference | undefined, opts: { partial?: boolean; finished?: boolean } = {}): { tone: Tone; message: string; ratio: number } {
  const R = REPORT_RULES;
  if (amount === undefined) return { tone: 'none', message: 'keine Daten', ratio: 0 };
  if (!ref) return { tone: 'none', message: 'kein Referenzwert', ratio: 0 };
  const share = ref.amount > 0 ? amount / ref.amount : 0;
  const ratio = Math.min(1.3, share);
  const unit = ref.unit;

  if (ref.kind === 'min') {
    if (share >= 1) return { tone: 'green', message: 'Im Zielbereich', ratio };
    // A partial sum below the reference says nothing about the real total.
    if (opts.partial) return { tone: 'none', message: `mind. ${amountText(amount, unit)} – Daten unvollständig`, ratio };
    const open = `Noch ${amountText(ref.amount - amount, unit)}`;
    return { tone: opts.finished && share < R.minRedShare ? 'red' : 'orange', message: open, ratio };
  }

  if (ref.kind === 'max') {
    if (share > 1) return { tone: 'red', message: 'über dem empfohlenen Bereich', ratio };
    if (opts.partial) return { tone: 'none', message: 'Daten unvollständig', ratio };
    if (share >= R.maxOrangeShare) return { tone: 'orange', message: `nahe an der Obergrenze · noch ${amountText(ref.amount - amount, unit)}`, ratio };
    return { tone: 'green', message: `im empfohlenen Bereich · noch ${amountText(ref.amount - amount, unit)}`, ratio };
  }

  // range
  const tol = ref.tolerance ?? 0;
  const diff = amount - ref.amount;
  // A lower bound below the range says nothing; inside or above it, it already is at least that much.
  if (opts.partial && diff < -tol) return { tone: 'none', message: `mind. ${amountText(amount, unit)} – Daten unvollständig`, ratio };
  if (Math.abs(diff) <= tol) return { tone: 'green', message: 'Im Zielbereich', ratio };
  if (diff > 0) return { tone: diff > 2 * tol ? 'red' : 'orange', message: `${amountText(diff, unit)} über dem Ziel`, ratio };
  return { tone: opts.finished && -diff > 2 * tol ? 'red' : 'orange', message: `Noch ${amountText(-diff, unit)}`, ratio };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const LABEL: Record<'kcal' | 'protein' | 'carbs' | 'fat' | 'water', string> = { kcal: 'Kalorien', protein: 'Protein', carbs: 'Kohlenhydrate', fat: 'Fett', water: 'Wasser' };

function row(key: ReportKey, amount: number | undefined, ref: Reference | undefined, partial: boolean, finished: boolean, unit: Reference['unit']): NutrientRow {
  const r = rate(amount, ref, { partial, finished });
  const label = key in LABEL ? LABEL[key as keyof typeof LABEL] : NUTRIENTS[key as MicroNutrient].label;
  return { key, label, unit, amount, reference: ref, partial, ...r };
}

function microRow(key: MicroNutrient, s: NutritionSummary, ref: Reference | undefined, finished: boolean): NutrientRow {
  const m: MicroTotal = s.micros[key];
  const unit = NUTRIENTS[key].unit;
  return row(key, m.known > 0 ? m.value : undefined, ref, m.known > 0 && m.known < m.of, finished, unit);
}

export function nutrientReport(state: AppState, date: ISODate, finished: boolean): NutrientReport {
  const s = daySummary(state.logEntries, date).day;
  const refs = references(dayTargetFor(state, date), state.nutritionProfile?.waterGoalMl);
  const m = s.macros;
  const eatenAny = s.entries > 0;
  // Macros are known once something is logged. An entry without a value for a macro (e.g. a product
  // without protein data) makes the day's sum a lower bound – rated like a partial micro sum, never as a shortfall.
  const unknownMacro = (k: 'kcal' | 'protein' | 'carbs' | 'fat') => k !== 'kcal' && state.logEntries.some((e) => e.date === date && e.unknown?.includes(k));
  const macro = (k: 'kcal' | 'protein' | 'carbs' | 'fat') => row(k, eatenAny ? m[k] : undefined, refs[k], unknownMacro(k), finished, refs[k]?.unit ?? (k === 'kcal' ? 'kcal' : 'g'));
  const energy = [macro('kcal'), macro('protein'), macro('carbs'), macro('fat'), microRow('fiber', s, refs.fiber, finished)];
  const water = refs.water ? [row('water', waterOn(state, date), refs.water, false, finished, 'ml')] : [];
  const limits = [microRow('sugar', s, refs.sugar, finished), microRow('salt', s, refs.salt, finished)];
  const vitamins = VITAL_NUTRIENTS.filter((k) => NUTRIENTS[k].group === 'vitamin').map((k) => microRow(k, s, refs[k], finished));
  const minerals = VITAL_NUTRIENTS.filter((k) => NUTRIENTS[k].group === 'mineral').map((k) => microRow(k, s, refs[k], finished));

  const groups: NutrientGroup[] = [
    { id: 'energy', label: 'Energie & Makros', rows: energy },
    ...(water.length ? [{ id: 'water' as const, label: 'Wasser', rows: water }] : []),
    { id: 'limit', label: 'Im Blick behalten', rows: limits },
    { id: 'vitamin', label: 'Vitamine', rows: vitamins },
    { id: 'mineral', label: 'Mineralstoffe', rows: minerals },
  ];
  // Nothing logged yet is not "no data" – it is simply an empty day so far.
  if (!eatenAny) for (const g of groups) for (const r of g.rows) if (r.amount === undefined) r.message = 'noch nichts erfasst';
  return { date, entries: s.entries, finished, groups, summary: summarize(groups, eatenAny) };
}

/** Plain sentences from the rows – the few that matter most, in a fixed order of relevance. */
function summarize(groups: NutrientGroup[], eatenAny: boolean): string[] {
  const all = groups.flatMap((g) => g.rows);
  const get = (k: ReportKey) => all.find((r) => r.key === k);
  const out: string[] = [];
  if (!eatenAny) out.push('Noch nichts erfasst – die Auswertung füllt sich mit jeder Mahlzeit.');
  for (const k of ['salt', 'sugar', 'sodium'] as const) {
    const r = get(k);
    if (r?.tone === 'red') out.push(`${r.label} bereits über dem empfohlenen Bereich.`);
    else if (r?.tone === 'orange') out.push(`${r.label} nahe an der Obergrenze.`);
  }
  const kcal = get('kcal');
  if (eatenAny && kcal?.tone === 'green') out.push('Kalorien im Zielbereich.');
  else if (eatenAny && kcal && kcal.message.includes('über')) out.push(`Kalorien: ${kcal.message}.`);
  const protein = get('protein');
  if (eatenAny && protein?.tone === 'green') out.push('Protein im Zielbereich.');
  else if (eatenAny && protein?.partial && protein.amount !== undefined) out.push(`Protein: mindestens ${amountText(protein.amount, 'g')} – bei einem Eintrag fehlt der Proteinwert.`);
  else if (eatenAny && protein?.reference) out.push(`Protein: ${protein.message.replace(/^Noch/, 'noch')} bis zum Ziel.`);
  const fiber = get('fiber');
  if (fiber?.tone === 'green') out.push('Ballaststoffe im Zielbereich.');
  else if (fiber?.amount !== undefined && !fiber.partial && fiber.reference) out.push(`Ballaststoffe noch etwas niedrig (${fiber.message.replace(/^Noch /, 'noch ')}).`);
  const water = get('water');
  if (water?.tone === 'green') out.push('Wasserziel erreicht.');
  else if (water?.reference && water.amount !== undefined) out.push(water.ratio >= 0.75 ? 'Wasserziel fast erreicht.' : `Wasser: ${water.message.replace(/^Noch/, 'noch')}.`);
  const vitalGreen = all.filter((r) => r.reference && !r.reference.personalized && r.reference.kind === 'min' && r.tone === 'green').length;
  if (vitalGreen) out.push(`${vitalGreen} Vitamin${vitalGreen === 1 ? '' : 'e'}/Mineralstoff${vitalGreen === 1 ? '' : 'e'} haben den Referenzwert erreicht.`);
  return out.slice(0, 5);
}

/**
 * The report in the number-free mode (E14): the energy row is left out (the
 * day's portions are on Heute and Ernährung), kcal numbers leave the texts.
 */
export function numberFreeReport(report: NutrientReport): NutrientReport {
  return {
    ...report,
    groups: report.groups.map((g) => ({
      ...g,
      rows: g.rows.filter((r) => r.unit !== 'kcal').map((r) => ({ ...r, message: withoutKcal(r.message) ?? '' })),
    })),
    summary: report.summary.map(withoutKcal).filter((t): t is string => !!t),
  };
}
