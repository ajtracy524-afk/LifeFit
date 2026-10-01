import {
  ACTIVITY_FACTOR,
  BMI_CLASSES,
  ENERGY_ROUND_KCAL,
  FFMI,
  KATCH_MCARDLE,
  MEASURED_ACCURACY,
  MIFFLIN,
  NAVY,
  RFM,
  TRAINING_SURCHARGE,
  VISUAL_ACCURACY,
  VISUAL_STAGES,
  WHTR,
} from './constants';
import type { ActivityLevel, Sex } from './types';

/**
 * Body analysis and energy – pure functions, every number from
 * domain/constants.ts (with sources). Results are estimates: the UI shows
 * them rounded and as a range, never with false precision.
 */

export type BodyFatMethod = 'measured' | 'navy' | 'rfm' | 'visual';

export interface BodyFatEstimate {
  method: BodyFatMethod;
  /** Rounded percent. */
  percent: number;
  /** Rounded range [low, high] in percent. */
  range: [number, number];
}

const round = (n: number, step = 1) => Math.round(n / step) * step;
const clampPct = (n: number) => Math.min(70, Math.max(2, n));

// ---------- BMI & WHtR ----------

/** BMI = kg / m². Undefined without plausible input. */
export function bmi(weightKg: number | undefined, heightCm: number | undefined): number | undefined {
  if (!weightKg || !heightCm || weightKg <= 0 || heightCm <= 0) return undefined;
  const m = heightCm / 100;
  return weightKg / (m * m);
}

export function bmiClass(value: number): (typeof BMI_CLASSES)[number] {
  return BMI_CLASSES.find((c) => value < c.max)!;
}

/** Waist-to-height ratio. */
export function whtr(waistCm: number | undefined, heightCm: number | undefined): number | undefined {
  if (!waistCm || !heightCm || waistCm <= 0 || heightCm <= 0) return undefined;
  return waistCm / heightCm;
}

export function whtrClass(value: number): { key: 'below' | 'above' | 'well_above'; label: string } {
  if (value < WHTR.guide) return { key: 'below', label: `Unter dem Richtwert ${String(WHTR.guide).replace('.', ',')}` };
  if (value < WHTR.clearlyAbove) return { key: 'above', label: `Über dem Richtwert ${String(WHTR.guide).replace('.', ',')}` };
  return { key: 'well_above', label: `Deutlich über dem Richtwert ${String(WHTR.guide).replace('.', ',')}` };
}

// ---------- Body fat ----------

interface Circumferences {
  heightCm: number;
  waistCm: number;
  neckCm?: number;
  hipCm?: number;
}

/** US Navy, men. Undefined when the inputs cannot work (waist ≤ neck). */
export function navyMale({ heightCm, waistCm, neckCm }: Circumferences): number | undefined {
  if (!neckCm || waistCm <= neckCm || heightCm <= 0) return undefined;
  const k = NAVY.male;
  return 495 / (k.a - k.b * Math.log10(waistCm - neckCm) + k.c * Math.log10(heightCm)) - 450;
}

/** US Navy, women (needs the hip). */
export function navyFemale({ heightCm, waistCm, neckCm, hipCm }: Circumferences): number | undefined {
  if (!neckCm || !hipCm || waistCm + hipCm <= neckCm || heightCm <= 0) return undefined;
  const k = NAVY.female;
  return 495 / (k.a - k.b * Math.log10(waistCm + hipCm - neckCm) + k.c * Math.log10(heightCm)) - 450;
}

export function rfmMale({ heightCm, waistCm }: Circumferences): number | undefined {
  if (!waistCm || waistCm <= 0) return undefined;
  return RFM.male - RFM.factor * (heightCm / waistCm);
}

export function rfmFemale({ heightCm, waistCm }: Circumferences): number | undefined {
  if (!waistCm || waistCm <= 0) return undefined;
  return RFM.female - RFM.factor * (heightCm / waistCm);
}

/**
 * One estimate from a sex-specific formula. "Keine Angabe": the mean of both
 * formulas, the range spans both results plus the method's accuracy (E2/E3).
 */
function fromFormulas(method: BodyFatMethod, sex: Sex, male: number | undefined, female: number | undefined, accuracy: number): BodyFatEstimate | undefined {
  const values = sex === 'male' ? [male] : sex === 'female' ? [female] : [male, female];
  if (values.some((v) => v === undefined || !Number.isFinite(v))) return undefined;
  const nums = values as number[];
  const mean = clampPct(nums.reduce((a, b) => a + b, 0) / nums.length);
  return {
    method,
    percent: round(mean),
    range: [round(clampPct(Math.min(...nums) - accuracy)), round(clampPct(Math.max(...nums) + accuracy))],
  };
}

export function navyEstimate(sex: Sex, c: Circumferences): BodyFatEstimate | undefined {
  return fromFormulas('navy', sex, navyMale(c), navyFemale(c), NAVY.accuracy);
}

export function rfmEstimate(sex: Sex, c: Circumferences): BodyFatEstimate | undefined {
  return fromFormulas('rfm', sex, rfmMale(c), rfmFemale(c), RFM.accuracy);
}

/** Own measured value (scale, caliper, DXA). */
export function measuredEstimate(percent: number | undefined): BodyFatEstimate | undefined {
  if (!percent || !Number.isFinite(percent) || percent <= 0) return undefined;
  return { method: 'measured', percent: round(percent), range: [round(clampPct(percent - MEASURED_ACCURACY)), round(clampPct(percent + MEASURED_ACCURACY))] };
}

export interface VisualStage {
  from: number;
  to: number;
  features: string;
}

/** The stages to compare with – for "keine Angabe" the user picks the reference figure (male or female). */
export function visualStages(reference: 'male' | 'female'): readonly VisualStage[] {
  return VISUAL_STAGES[reference];
}

export function visualEstimate(stage: { from: number; to: number }): BodyFatEstimate {
  const mid = (stage.from + stage.to) / 2;
  return { method: 'visual', percent: round(mid), range: [round(clampPct(mid - VISUAL_ACCURACY)), round(clampPct(mid + VISUAL_ACCURACY))] };
}

/** "ca. 16 % (14–18 %)" */
export function formatBodyFat(e: Pick<BodyFatEstimate, 'percent' | 'range'>): string {
  return `ca. ${e.percent} % (${e.range[0]}–${e.range[1]} %)`;
}

// ---------- Fat-free mass ----------

export const fatFreeMass = (weightKg: number, bodyFatPct: number) => weightKg * (1 - bodyFatPct / 100);

/** FFMI normalised to 1.80 m (Kouri et al. 1995). */
export function ffmi(weightKg: number, heightCm: number, bodyFatPct: number): { raw: number; normalized: number } {
  const m = heightCm / 100;
  const raw = fatFreeMass(weightKg, bodyFatPct) / (m * m);
  return { raw, normalized: raw + FFMI.normalizeFactor * (FFMI.normalizeHeightM - m) };
}

/** Neutral band of the normalised FFMI. "Keine Angabe": the mean of the male and female bands. */
export function ffmiClass(normalized: number, sex: Sex): string {
  const bands =
    sex === 'unspecified' ? FFMI.bands.male.map((b, i) => (b + FFMI.bands.female[i]!) / 2) : FFMI.bands[sex];
  const i = bands.findIndex((b) => normalized < b);
  return FFMI.labels[i < 0 ? bands.length : i]!;
}

// ---------- Energy ----------

export type BmrFormula = 'mifflin' | 'katch' | 'mean';

export interface EnergyInput {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: ActivityLevel;
  /** Known body fat and how it was obtained (decides the formula). */
  bodyFat?: Pick<BodyFatEstimate, 'method' | 'percent'> & { range?: [number, number] };
  /** Planned strength sessions per week and their length. */
  sessionsPerWeek: number;
  sessionMinutes?: number;
}

const mifflin = (sex: Sex, age: number, heightCm: number, weightKg: number) =>
  MIFFLIN.kg * weightKg + MIFFLIN.cm * heightCm - MIFFLIN.age * age + MIFFLIN[sex];

const katch = (weightKg: number, bodyFatPct: number) => KATCH_MCARDLE.base + KATCH_MCARDLE.perKgFfm * fatFreeMass(weightKg, bodyFatPct);

/**
 * Basal metabolic rate:
 *   no body fat           → Mifflin-St Jeor (−78 for "keine Angabe")
 *   measured or Navy      → Katch-McArdle
 *   RFM or visual         → mean of both (the estimate is less certain)
 */
export function bmrFor(i: Pick<EnergyInput, 'sex' | 'age' | 'heightCm' | 'weightKg' | 'bodyFat'>, pct = i.bodyFat?.percent): { kcal: number; formula: BmrFormula } {
  const m = mifflin(i.sex, i.age, i.heightCm, i.weightKg);
  if (!i.bodyFat || pct === undefined) return { kcal: m, formula: 'mifflin' };
  const k = katch(i.weightKg, pct);
  if (i.bodyFat.method === 'measured' || i.bodyFat.method === 'navy') return { kcal: k, formula: 'katch' };
  return { kcal: (m + k) / 2, formula: 'mean' };
}

/** Daily average of the planned strength sessions: (MET − 1) · kg · hours · sessions / 7. */
export function trainingSurcharge(weightKg: number, sessionsPerWeek: number, sessionMinutes: number = TRAINING_SURCHARGE.defaultMinutes): number {
  if (sessionsPerWeek <= 0 || weightKg <= 0) return 0;
  return ((TRAINING_SURCHARGE.strengthMet - 1) * weightKg * (sessionMinutes / 60) * sessionsPerWeek) / 7;
}

export interface EnergyEstimate {
  formula: BmrFormula;
  /** Unrounded values for further calculation. */
  bmr: number;
  activityFactor: number;
  /** Everyday life on top of the basal rate: bmr · (factor − 1). */
  everyday: number;
  training: number;
  tdee: number;
  /** Rounded ranges for display: "keine Angabe" (male/female constants) and the body fat range. */
  bmrRange: [number, number];
  tdeeRange: [number, number];
}

/**
 * Total energy = BMR · everyday factor + training surcharge. The factor
 * covers daily life only (job, steps); the planned sessions are added on top –
 * so training is counted once.
 */
export function energyEstimate(i: EnergyInput): EnergyEstimate {
  const { kcal: bmr, formula } = bmrFor(i);
  const factor = ACTIVITY_FACTOR[i.activity];
  const training = trainingSurcharge(i.weightKg, i.sessionsPerWeek, i.sessionMinutes);
  // Range: both sex constants for "keine Angabe", both ends of the body fat range.
  const sexes: Sex[] = i.sex === 'unspecified' ? ['male', 'female'] : [i.sex];
  const pcts = i.bodyFat ? (i.bodyFat.range ?? [i.bodyFat.percent, i.bodyFat.percent]) : [undefined];
  const variants = sexes.flatMap((sex) => pcts.map((pct) => bmrFor({ ...i, sex }, pct).kcal));
  const r = (n: number) => round(n, ENERGY_ROUND_KCAL);
  const bmrRange: [number, number] = [r(Math.min(...variants)), r(Math.max(...variants))];
  return {
    formula,
    bmr,
    activityFactor: factor,
    everyday: bmr * (factor - 1),
    training,
    tdee: bmr * factor + training,
    bmrRange,
    tdeeRange: [r(Math.min(...variants) * factor + training), r(Math.max(...variants) * factor + training)],
  };
}

/** Age in full years from the birth year (birthday unknown – the year is enough for the formulas). */
export function ageFromBirthYear(birthYear: number, today: string): number {
  return Number(today.slice(0, 4)) - birthYear;
}

/**
 * Options for the daily target from what is stored: the latest body fat entry
 * (a measured value counts like a), an estimate like d)), the planned session
 * length, the pace and target weight of the goal, the training level and
 * pregnancy / breastfeeding (never a deficit). One helper for every place
 * that (re)calculates targets.
 */
export function targetOptionsFor(state: {
  measurements?: Array<{ kind: string; date: string; value: number; method: 'measured' | 'estimate' }>;
  training?: { sessionMinutes?: number } | null;
  profile?: { experience?: 'beginner' | 'intermediate' | 'advanced' } | null;
  goal?: { targetWeightKg?: number } | null;
  onboarding?: { goal: { pace?: { value: 'gentle' | 'normal' | 'brisk' } }; health: { pregnancy?: { value: 'no' | 'pregnant' | 'breastfeeding' } } };
}): {
  bodyFat?: EnergyInput['bodyFat'];
  sessionMinutes?: number;
  pace?: 'gentle' | 'normal' | 'brisk';
  experience?: 'beginner' | 'intermediate' | 'advanced';
  targetWeightKg?: number;
  pregnant?: boolean;
} {
  const fat = [...(state.measurements ?? [])].filter((m) => m.kind === 'body_fat').sort((a, b) => b.date.localeCompare(a.date))[0];
  const pregnancy = state.onboarding?.health.pregnancy?.value;
  return {
    ...(fat ? { bodyFat: { method: fat.method === 'measured' ? 'measured' : 'visual', percent: fat.value } } : {}),
    ...(state.training?.sessionMinutes ? { sessionMinutes: state.training.sessionMinutes } : {}),
    ...(state.onboarding?.goal.pace ? { pace: state.onboarding.goal.pace.value } : {}),
    ...(state.profile?.experience ? { experience: state.profile.experience } : {}),
    ...(state.goal?.targetWeightKg ? { targetWeightKg: state.goal.targetWeightKg } : {}),
    ...(pregnancy === 'pregnant' || pregnancy === 'breastfeeding' ? { pregnant: true } : {}),
  };
}
